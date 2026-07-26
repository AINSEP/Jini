import { existsSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, resolve } from 'node:path';
import { createAguiEncoder } from '@jini/agui';
import { createAgentExecutor } from '@jini/daemon';
import { registerMediaRoutes, registerMemoryRoutes, registerRunStreamRoute } from '@jini/http';
import { createMediaDispatchEngine, createSqliteMediaTaskStore } from '@jini/media';
import { createExtractionLog, createNoteStore, createVerifyLog } from '@jini/memory';
import { createFrontendControl, createLocalNodeDaemon } from '@jini/node-host';
import { CHAT_CAPABILITIES, PAGE_CAPABILITIES } from '@jini/chat-core';
import type { RunAgentPayload } from '@jini/protocol';
import {
  createPlaygroundRuntimeEnvironment,
  decodePlaygroundRunRequest,
  failPlaygroundRunBeforeExecutor,
  promptWithPlaygroundAttachments,
  sanitizePlaygroundAttachmentName,
  writeBoundedAttachmentBody,
} from './playground-request.js';
import {
  createPlaygroundAttachmentRegistry,
  detectPlaygroundAttachmentKind,
} from './playground-attachment-registry.js';
import {
  createPlaygroundWorkingDirectoryAuthority,
  isLoopbackAddress,
} from './working-directory-authority.js';
import { resolveJiniMcpBridge, type JiniMcpBridgeInjection } from './mcp-bridge.js';

const PLAYGROUND_PREFIX = 'playground:';
const PLAYGROUND_PORT = 4317;
const PROJECTS = new Set(['starter-site', 'bug-hunt']);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const dataDir = resolve(repoRoot, '.jini/playground');
const uploadDir = resolve(dataDir, 'uploads');
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_CONCURRENT_UPLOADS = 4;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function runDemo(
  runId: string,
  prompt: string,
  project: string,
  lifecycle: Parameters<NonNullable<Parameters<typeof createLocalNodeDaemon>[0]['onRunStarted']>>[0]['lifecycle'],
): Promise<void> {
  let canceled = false;
  lifecycle.onCancelRequested(runId, () => {
    canceled = true;
  });

  const emitAgent = (data: RunAgentPayload) => lifecycle.emit(runId, { event: 'agent', data });
  const stopIfCanceled = async (): Promise<boolean> => {
    if (!canceled) return false;
    await lifecycle.finish({ runId, status: 'cancelled', code: null, signal: null, resumable: false });
    return true;
  };

  await emitAgent({ type: 'status', label: 'Inspecting workspace', detail: `examples/sample-projects/${project}` });
  await delay(260);
  if (await stopIfCanceled()) return;

  await emitAgent({ type: 'tool_use', id: `${runId}-inspect`, name: 'workspace.inspect', input: { project } });
  await delay(320);
  if (await stopIfCanceled()) return;

  const inspectedFiles =
    project === 'starter-site'
      ? ['index.html', 'styles.css', 'app.js', 'README.md']
      : ['src/cart.js', 'test/cart.test.js', 'README.md'];
  await emitAgent({
    type: 'tool_result',
    toolUseId: `${runId}-inspect`,
    content: `Found ${inspectedFiles.length} files: ${inspectedFiles.join(', ')}`,
    isError: false,
  });

  const response = [
    `I inspected **${project}** through the Jini daemon and received your request:\n\n> ${prompt.trim()}\n\n`,
    project === 'bug-hunt'
      ? 'The sample has an intentional cart-total defect and a focused Node test that exposes it. A good first live-agent task is: **“run the tests, explain the failure, and fix only the bug.”**'
      : 'This is a zero-dependency browser project. A good first live-agent task is: **“add a filter for completed items while preserving the existing visual style.”**',
    '\n\nThis response used a durable run, replayable SSE events, and the shared `@jini/chat-react` renderer.',
  ];

  for (const chunk of response) {
    await delay(220);
    if (await stopIfCanceled()) return;
    await emitAgent({ type: 'text_delta', delta: chunk });
  }
  await emitAgent({ type: 'usage', usage: { input_tokens: 34, output_tokens: 118 }, durationMs: 1_230 });
  await lifecycle.finish({ runId, status: 'succeeded', code: 0, signal: null, resumable: false });
}

/**
 * Resolves the `jini-mcp` bridge injected into MCP-capable agent runs, reporting a missing build
 * as a startup warning rather than a boot failure: the demo agent and every non-MCP runtime run
 * fine without it, so refusing to start would break more than it protects.
 */
function resolvePlaygroundMcpBridge(): JiniMcpBridgeInjection | undefined {
  const resolution = resolveJiniMcpBridge({
    repoRoot,
    daemonUrl: `http://127.0.0.1:${PLAYGROUND_PORT}`,
    nodePath: process.execPath,
    fileExists: existsSync,
    join,
  });
  if (!resolution.ok) {
    console.warn(
      `[Jini Playground] @jini/mcp is not built (${resolution.missingPath} is missing), so agent runs `
        + 'start without the jini MCP bridge and no agent can call execute_delegated_tool. '
        + 'Run `pnpm --filter @jini/mcp build`.',
    );
    return undefined;
  }
  return resolution.injection;
}

async function main(): Promise<void> {
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(uploadDir, { recursive: true });
  // Writes a merged `.mcp.json` into each run's cwd at spawn — for a granted working directory
  // that is the user's own folder, which is exactly why the grant is an explicit, secret-gated act.
  const mcpBridge = resolvePlaygroundMcpBridge();
  process.env.JINI_DISABLE_API_AUTH = '1';
  process.env.JINI_ALLOWED_ORIGINS = 'http://127.0.0.1:4173,http://localhost:4173';
  const env: NodeJS.ProcessEnv = {
    ...process.env,
  };
  const mediaTaskStore = createSqliteMediaTaskStore(resolve(dataDir, 'media-tasks.db'));
  const memoryRoutesDeps = {
    notes: createNoteStore({ validTypes: ['note'], defaultType: 'note' }),
    extractions: createExtractionLog(),
    verifications: createVerifyLog(),
    dataDir,
  };
  const workingDirectoryAuthority = await createPlaygroundWorkingDirectoryAuthority({
    repoRoot,
    projects: PROJECTS,
    grantSecret: process.env.JINI_PLAYGROUND_GRANT_SECRET,
  });
  const attachmentRegistry = await createPlaygroundAttachmentRegistry({
    uploadDirectory: uploadDir,
  });
  const attachmentPruneTimer = setInterval(() => {
    void attachmentRegistry.pruneExpired().catch((error: unknown) => {
      console.error('[Jini Playground] attachment retention cleanup failed', error);
    });
  }, 5 * 60 * 1_000);
  attachmentPruneTimer.unref();
  let activeUploadCount = 0;

  /**
   * Agent-driven frontend control. The playground allows every capability outright because it is a
   * demo on loopback; a real product supplies a policy that consults its own roles.
   */
  const frontendControl = createFrontendControl({
    capabilities: [...PAGE_CAPABILITIES, ...CHAT_CAPABILITIES],
    policy: { authorize: () => 'allow' },
    resolveBindToken: (request) => {
      try {
        return decodePlaygroundRunRequest({
          contextRef: request.contextRef,
          allowedProjects: PROJECTS,
          prefix: PLAYGROUND_PREFIX,
        }).frontendBindToken;
      } catch {
        // A run whose context this host cannot read is not this seam's problem to report — the
        // run-start path already fails it with a real message.
        return undefined;
      }
    },
  });

  let daemon: Awaited<ReturnType<typeof createLocalNodeDaemon>>;
  try {
    daemon = await createLocalNodeDaemon({
      dataDir,
      port: PLAYGROUND_PORT,
      packs: [],
      env,
      resolveWorkspaceRoot: ({ resourceRef }) =>
        PROJECTS.has(resourceRef) ? resolve(repoRoot, 'examples/sample-projects', resourceRef) : undefined,
      toolRegistrations: frontendControl.toolRegistrations,
      httpExtensions: [
        frontendControl.httpExtension,
        (app) => {
          app.post('/api/playground/working-directory-grants', async (request, response) => {
            if (!isLoopbackAddress(request.socket.remoteAddress)) {
              response.status(403).json({ message: 'Working-directory grant denied' });
              return;
            }
            try {
              const body = request.body as { directory?: unknown } | undefined;
              const directory = await workingDirectoryAuthority.grant(
                body?.directory,
                request.get('x-jini-grant-secret'),
              );
              response.status(201).json({ directory });
            } catch {
              response.status(403).json({ message: 'Working-directory grant denied' });
            }
          });
        },
        (app) => {
          app.post('/api/playground/attachments', async (request, response) => {
            if (activeUploadCount >= MAX_CONCURRENT_UPLOADS) {
              response.status(429).json({ message: 'Too many attachment uploads are in progress' });
              return;
            }
            const name = sanitizePlaygroundAttachmentName(request.query.name);
            const batchId = typeof request.query.batch === 'string' ? request.query.batch : '';
            activeUploadCount += 1;
            try {
              await attachmentRegistry.pruneExpired();
              const batchDirectory = await attachmentRegistry.createBatchDirectory(batchId);
              const suffix = extname(name).slice(0, 12);
              const path = resolve(batchDirectory, `${randomUUID()}${suffix}`);
              const upload = await writeBoundedAttachmentBody({
                request,
                filePath: path,
                maxBytes: MAX_ATTACHMENT_BYTES,
              });
              if (upload.size === 0) {
                await rm(path, { force: true });
                response.status(400).json({ message: 'Attachment is empty' });
                return;
              }
              const attachment = await attachmentRegistry.register({
                batchId,
                path,
                name,
                kind: detectPlaygroundAttachmentKind(upload.signature),
                size: upload.size,
              });
              response.status(201).json({
                attachment,
              });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              const status = message.includes('20 MB')
                || message.includes('limited to')
                || message.includes('too large')
                || message.includes('storage is full')
                ? 413
                : message.includes('Invalid attachment batch')
                  ? 400
                  : 500;
              response.status(status).json({
                message: status === 500 ? 'Attachment upload failed' : message,
              });
            } finally {
              activeUploadCount -= 1;
              await attachmentRegistry.deleteUnclaimed(batchId, []).catch(() => undefined);
            }
          });
          app.delete('/api/playground/attachments', async (request, response) => {
            try {
              const body = request.body as {
                batchId?: unknown;
                paths?: unknown;
              } | undefined;
              if (
                typeof body?.batchId !== 'string'
                || !Array.isArray(body.paths)
                || body.paths.length > 10
                || !body.paths.every((path) => typeof path === 'string')
              ) {
                response.status(400).json({ message: 'Invalid attachment cleanup request' });
                return;
              }
              await attachmentRegistry.deleteUnclaimed(body.batchId, body.paths);
              response.status(204).end();
            } catch {
              response.status(400).json({ message: 'Invalid attachment cleanup request' });
            }
          });
        },
        (app, { lifecycle }) =>
          registerRunStreamRoute(app, { lifecycle, encoder: createAguiEncoder() }),
        (app, { adapter }) => registerMemoryRoutes(app, memoryRoutesDeps, adapter),
        (app, { adapter }) =>
          registerMediaRoutes(
            app,
            {
              engine: createMediaDispatchEngine({ credentials: {} }),
              taskStore: mediaTaskStore,
            },
            adapter,
          ),
      ],
      onShutdown: async () => {
        clearInterval(attachmentPruneTimer);
        await attachmentRegistry.dispose();
        await mediaTaskStore.close();
      },
      onRunStarted: (context) => {
        // Bind first: the run must be reachable from its own tab before the agent starts asking.
        frontendControl.bindOnStarted(context);
        const { request, run, lifecycle } = context;
        void (async () => {
          try {
            const decoded = decodePlaygroundRunRequest({
              contextRef: request.contextRef,
              allowedProjects: PROJECTS,
              prefix: PLAYGROUND_PREFIX,
            });
            const claimed = await attachmentRegistry.claim(
              decoded.attachments ?? [],
              run.id,
            );
            const {
              attachments: _untrustedAttachments,
              ...decodedWithoutAttachments
            } = decoded;
            const trustedRequest = {
              ...decodedWithoutAttachments,
              ...(claimed.attachments.length > 0
                ? { attachments: claimed.attachments }
                : {}),
            };
            if (request.agentId === undefined || request.agentId === 'playground-demo') {
              await runDemo(
                run.id,
                promptWithPlaygroundAttachments(trustedRequest),
                decoded.project,
                lifecycle,
              );
              return;
            }

            const cwd = await workingDirectoryAuthority.resolveForRun(
              decoded.workingDirectory,
              decoded.project,
            );
            const executor = createAgentExecutor({
              lifecycle,
              // Gives the spawned CLI `execute_delegated_tool`, the agent-native route into the
              // same `ToolExecutor` gate `frontendControl` registers its capabilities behind.
              ...(mcpBridge !== undefined ? { mcpJsonInjection: mcpBridge } : {}),
            });
            await executor.run({
              runId: run.id,
              agentId: request.agentId,
              prompt: promptWithPlaygroundAttachments(trustedRequest),
              cwd,
              env: createPlaygroundRuntimeEnvironment(process.env),
              ...(decoded.model !== undefined ? { model: decoded.model } : {}),
              ...(decoded.reasoning !== undefined ? { reasoning: decoded.reasoning } : {}),
              ...(claimed.attachments.length > 0 && claimed.batchDirectory
                ? {
                    imagePaths: claimed.attachments
                      .filter((attachment) => attachment.kind === 'image')
                      .map((attachment) => attachment.path),
                    extraAllowedDirs: [claimed.batchDirectory],
                    uploadRoot: claimed.batchDirectory,
                  }
                : {}),
            });
            await lifecycle.waitForTerminal(run.id);
          } catch (error: unknown) {
            console.error(`[Jini Playground] ${request.agentId} run failed`, error);
            await failPlaygroundRunBeforeExecutor({
              lifecycle,
              runId: run.id,
            });
          } finally {
            await attachmentRegistry.cleanupRun(run.id);
          }
        })();
      },
    });
  } catch (error) {
    clearInterval(attachmentPruneTimer);
    await attachmentRegistry.dispose();
    await mediaTaskStore.close();
    throw error;
  }

  console.log(`[Jini Playground] daemon ready at ${daemon.url}`);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void daemon.stop().finally(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

void main().catch((error: unknown) => {
  console.error('[Jini Playground] daemon failed to start', error);
  process.exitCode = 1;
});
