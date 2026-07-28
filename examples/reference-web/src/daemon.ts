import { existsSync, mkdirSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, resolve } from 'node:path';
import {
  createLabCatalog,
  parseAgentToRendererMessage,
  parseRendererToAgentMessage,
  type AgentToRendererMessage,
  type RendererToAgentMessage,
} from '@jini-ai/agentic/a2ui';
import { createAguiEncoder } from '@jini-ai/agentic';
import { createAgentExecutor } from '@jini-ai/daemon';
import type { ToolRegistration } from '@jini-ai/core';
import { registerMediaRoutes, registerMemoryRoutes, registerRunStreamRoute } from '@jini-ai/http';
import { createMediaDispatchEngine, createSqliteMediaTaskStore } from '@jini-ai/media';
import { createExtractionLog, createNoteStore, createVerifyLog } from '@jini-ai/memory';
import { createFrontendControl, createLocalNodeDaemon } from '@jini-ai/node-host';
import { CHAT_CAPABILITIES } from '@jini-ai/chat-core';
import { PAGE_CAPABILITIES } from '@jini-ai/agentic';
import type { RunAgentPayload } from '@jini-ai/protocol';
import { WEBMCP_LAB_CAPABILITIES } from './webmcp-lab-capabilities.js';
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
/**
 * The A2UI Lab action relay's own port — deliberately a second, dedicated `node:http` server, not
 * a route bolted onto the daemon's own Express app. See `startA2uiActionRelay`'s doc for why.
 */
const A2UI_ACTION_PORT = 4318;
const A2UI_DEMO_AGENT_ID = 'a2ui-demo';
const PROJECTS = new Set(['starter-site', 'bug-hunt']);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const dataDir = resolve(repoRoot, '.jini/playground');
const uploadDir = resolve(dataDir, 'uploads');
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_CONCURRENT_UPLOADS = 4;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

const MCPUI_LAB_RESOURCE_URI = 'ui://mcpui-lab/counter-widget';
const MCPUI_LAB_RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app';
const MCPUI_LAB_VIEW_ROUTE = '/mcpui-lab/view';
/**
 * Built by `vite build --config vite.mcpui-view.config.ts` (`pnpm build`/`pnpm build:mcpui-view`)
 * from `mcpui-view-src/mcp-app.ts` — the real `@modelcontextprotocol/ext-apps` `App` SDK, not a
 * hand-rolled reimplementation (see that file's module doc). `vite-plugin-singlefile` inlines the
 * View's JS/CSS into one HTML document; the path below is where that plugin actually places it
 * (it preserves the entry's relative path under `outDir`, verified against a real build rather
 * than assumed).
 */
const MCPUI_LAB_VIEW_BUILD_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../dist-mcpui-view/mcpui-view-src/mcp-app.html',
);
/** No-store: this is a live fixture edited during the stress-test session, not a cacheable asset. */
const MCPUI_LAB_VIEW_CSP =
  "default-src 'none'; base-uri 'none'; form-action 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'";

/**
 * `show_mcpui_widget` — a real Jini-registered tool, automatically seeded into the searchable
 * tool catalog `createLocalNodeDaemon` builds from every `toolRegistrations` entry (see
 * `packages/node-host/src/create-local-node-daemon.ts`'s `reseedToolCatalog` call), so a spawned
 * CLI agent can find it via `search_tools`/`describe_tool` and invoke it via
 * `execute_delegated_tool` — the exact same `ToolExecutor`-gated path `AgentLab`'s page.* verbs
 * already prove end-to-end, no new authorization mechanism.
 *
 * Its result carries a `ui://` resource id (the MCP Apps naming convention — see
 * `apps.mdx`'s "UI Resource Format") that `McpUiLabHost.tsx`'s `registerToolRenderer` card
 * resolves directly to this daemon's own `/mcpui-lab/view` endpoint, rather than through a real
 * `resources/read` round-trip against an MCP server. That is this fixture's one deliberate
 * simplification of the spec: the handshake, the message envelope, and the teardown
 * request/response are all real; server-side resource discovery/resolution is not reimplemented.
 */
const showMcpUiWidgetTool: ToolRegistration = {
  descriptor: {
    id: 'show_mcpui_widget',
    description:
      'Open an interactive MCP Apps demo widget (a small counter) for the user, rendered in a real '
      + 'sandboxed cross-origin iframe using the MCP-UI/MCP-Apps JSON-RPC handshake (ui/initialize, '
      + 'ui/notifications/initialized, ui/resource-teardown). Use this when the user asks to see, open, '
      + 'show, launch, or demo the MCP UI / MCP Apps widget, panel, or sandboxed iframe.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Optional display title for the widget panel.' },
      },
      additionalProperties: false,
    },
  },
  policy: { authorize: () => 'allow' },
  handler: async (ctx) => {
    const input = (ctx.input ?? {}) as { title?: unknown };
    const title =
      typeof input.title === 'string' && input.title.trim().length > 0 ? input.title.trim() : 'MCP Apps demo widget';
    return {
      uri: MCPUI_LAB_RESOURCE_URI,
      mimeType: MCPUI_LAB_RESOURCE_MIME_TYPE,
      title,
    };
  },
};

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
    '\n\nThis response used a durable run, replayable SSE events, and the shared `@jini-ai/chat-react` renderer.',
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
      `[Jini Playground] @jini-ai/mcp is not built (${resolution.missingPath} is missing), so agent runs `
        + 'start without the jini MCP bridge and no agent can call execute_delegated_tool. '
        + 'Run `pnpm --filter @jini-ai/mcp build`.',
    );
    return undefined;
  }
  return resolution.injection;
}

// ---------------------------------------------------------------------------------------------
// A2UI Lab demo: a real agent-driven surface (createSurface -> updateComponents -> updateDataModel)
// streamed through the same RunLifecycle every other playground demo uses, plus a real renderer ->
// agent `action` round trip when the fixture's button is clicked. See `A2uiLab.tsx` for the
// browser-side interpreter/renderer this drives, and `../../../packages/a2ui/source-map.md` for
// what this port of the spec does and does not implement.
// ---------------------------------------------------------------------------------------------

/**
 * One resolver queue per in-flight A2UI run, fed by `startA2uiActionRelay` below and drained by
 * `waitForA2uiAction`. A queue (not a single slot) so more than one click queued up faster than
 * the demo consumes them is never silently dropped — `deliverA2uiAction` always hands the message
 * to the *oldest* still-waiting call.
 */
const a2uiActionQueues = new Map<string, Array<(message: RendererToAgentMessage) => void>>();

function registerA2uiActionWaiter(runId: string, resolve: (message: RendererToAgentMessage) => void): void {
  const queue = a2uiActionQueues.get(runId) ?? [];
  queue.push(resolve);
  a2uiActionQueues.set(runId, queue);
}

/** @returns `true` if a waiting call actually received this message, `false` if nothing was waiting (e.g. a stray/late POST after the demo already finished). */
function deliverA2uiAction(runId: string, message: RendererToAgentMessage): boolean {
  const queue = a2uiActionQueues.get(runId);
  const resolveNext = queue?.shift();
  if (!resolveNext) return false;
  resolveNext(message);
  return true;
}

function clearA2uiActionWaiters(runId: string): void {
  a2uiActionQueues.delete(runId);
}

/**
 * Waits for the next renderer -> agent action on `runId`, or `null` if `isCanceled` flips true
 * first. Polls the cancellation flag on a short interval rather than a proper cancelable-promise
 * primitive — a deliberate, documented simplification for a lab demo, not production run-control
 * code (`@jini-ai/daemon`'s own `RunLifecycle` has no "cancel a pending await" primitive to hook into
 * here; building one was out of scope for this task).
 */
function waitForA2uiAction(runId: string, isCanceled: () => boolean): Promise<RendererToAgentMessage | null> {
  return new Promise((settle) => {
    let done = false;
    const pollTimer = setInterval(() => {
      if (!done && isCanceled()) {
        done = true;
        clearInterval(pollTimer);
        settle(null);
      }
    }, 200);
    registerA2uiActionWaiter(runId, (message) => {
      if (done) return;
      done = true;
      clearInterval(pollTimer);
      settle(message);
    });
  });
}

async function runA2uiDemo(
  runId: string,
  lifecycle: Parameters<NonNullable<Parameters<typeof createLocalNodeDaemon>[0]['onRunStarted']>>[0]['lifecycle'],
): Promise<void> {
  let canceled = false;
  lifecycle.onCancelRequested(runId, () => {
    canceled = true;
  });
  const emitAgent = (data: RunAgentPayload) => lifecycle.emit(runId, { event: 'agent', data });
  /**
   * Validates every outgoing message against `@jini-ai/agentic/a2ui`'s own `parseAgentToRendererMessage`
   * before it goes out over the wire — this demo dogfoods the same schema the browser-side
   * interpreter enforces, so a typo in one of the literal messages below fails loudly here
   * instead of silently reaching the renderer as a message it then has to reject.
   */
  const emitA2ui = (message: AgentToRendererMessage) => {
    const validated = parseAgentToRendererMessage(message);
    if (!validated.ok) {
      throw new Error(`[A2UI Lab] refusing to emit a message that fails its own schema: ${validated.message}`);
    }
    emitAgent({ type: 'a2ui', message: validated.message });
  };

  const catalog = createLabCatalog();
  const surfaceId = `${runId}-surface`;

  await emitAgent({ type: 'status', label: 'Building an A2UI surface', detail: catalog.catalogId });
  await delay(200);
  if (canceled) {
    await lifecycle.finish({ runId, status: 'cancelled', code: null, signal: null, resumable: false });
    return;
  }

  emitA2ui({
    version: 'v1.0',
    createSurface: {
      surfaceId,
      catalogId: catalog.catalogId,
      dataModel: { message: 'Click the button below — the click really round-trips through the daemon.', clicks: 0 },
    },
  });
  await delay(150);

  emitA2ui({
    version: 'v1.0',
    updateComponents: {
      surfaceId,
      components: [
        { id: 'root', component: 'Column', children: ['title', 'status', 'greetButton'] },
        { id: 'title', component: 'Text', text: 'A2UI Lab', variant: 'body' },
        { id: 'status', component: 'Text', text: { path: '/message' } },
        {
          id: 'greetButton',
          component: 'Button',
          child: 'greetLabel',
          variant: 'primary',
          action: { event: { name: 'sayHello', context: { source: 'a2ui-lab-button' } } },
        },
        { id: 'greetLabel', component: 'Text', text: 'Say hello' },
      ],
    },
  });

  const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
  let clicks = 0;
  const startedAt = Date.now();
  for (;;) {
    if (canceled || Date.now() - startedAt > IDLE_TIMEOUT_MS) break;
    const received = await waitForA2uiAction(runId, () => canceled);
    if (!received || canceled) break;
    if (!('action' in received) || received.action.name !== 'sayHello') continue;

    clicks += 1;
    emitA2ui({
      version: 'v1.0',
      updateDataModel: {
        surfaceId,
        path: '/message',
        value: `Hello! This is click #${clicks}, acknowledged by the real daemon at ${received.action.timestamp}.`,
      },
    });
    await delay(60);
    emitA2ui({ version: 'v1.0', updateDataModel: { surfaceId, path: '/clicks', value: clicks } });
  }

  clearA2uiActionWaiters(runId);
  await lifecycle.finish({
    runId,
    status: canceled ? 'cancelled' : 'succeeded',
    code: canceled ? null : 0,
    signal: null,
    resumable: false,
  });
}

/**
 * A small, dedicated `POST /a2ui-action` relay for the A2UI Lab's browser -> daemon round trip —
 * deliberately its own `node:http` server on its own port, not a second route added to the
 * daemon's already-listening Express `Server`. Node's `http.Server` fires *every* registered
 * 'request' listener for *every* request (unlike a DOM event, there is no stopPropagation), so
 * adding a second listener to intercept just this one path would still leave Express's own
 * listener trying to handle (and 404, after this listener already wrote a response) the exact
 * same request — `ERR_HTTP_HEADERS_SENT` territory. A separate server sidesteps that entirely;
 * `vite.config.ts` proxies `/a2ui-action` to it so the browser still only ever talks to one origin.
 */
function startA2uiActionRelay(port: number): HttpServer {
  const server = createHttpServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/a2ui-action') {
      res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'not found' }));
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      let body: { runId?: unknown; message?: unknown };
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { runId?: unknown; message?: unknown };
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'malformed JSON body' }));
        return;
      }
      if (typeof body.runId !== 'string' || body.runId.length === 0) {
        res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'runId is required' }));
        return;
      }
      // Real spec-conformance enforcement, not a rubber stamp: an envelope that fails
      // `@jini-ai/agentic/a2ui`'s own renderer -> agent schema (missing version, malformed action shape, ...)
      // is refused here at the network boundary, before it can ever reach `runA2uiDemo`.
      const parsed = parseRendererToAgentMessage(body.message);
      if (!parsed.ok) {
        res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: parsed.reason }));
        return;
      }
      const delivered = deliverA2uiAction(body.runId, parsed.message);
      if (!delivered) {
        res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'no A2UI run is currently waiting for an action on this runId' }));
        return;
      }
      res.writeHead(202, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }));
    });
  });
  server.listen(port, '127.0.0.1');
  return server;
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
    capabilities: [...PAGE_CAPABILITIES, ...CHAT_CAPABILITIES, ...WEBMCP_LAB_CAPABILITIES],
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
      toolRegistrations: [...frontendControl.toolRegistrations, showMcpUiWidgetTool],
      httpExtensions: [
        frontendControl.httpExtension,
        (app) => {
          // Served from THIS daemon's own origin — a genuinely different port than the Vite dev
          // server hosting `McpUiLab.tsx` — because the MCP Apps spec requires the View to be a
          // different origin from the Host, and that's what makes
          // `sandbox="allow-scripts allow-same-origin"` safe to use on the embedding iframe
          // (`MCP_UI_SANDBOX_NOTE`). Deliberately NOT added to `vite.config.ts`'s `/api` proxy —
          // proxying it would put it on the Vite origin instead, defeating the whole point.
          app.get(MCPUI_LAB_VIEW_ROUTE, (_request, response) => {
            // Read fresh per-request (not cached at startup) so rebuilding the View during a
            // live session — `pnpm build:mcpui-view` — shows up on the next iframe load without
            // restarting the daemon, matching `vite.config.ts`'s starter-preview precedent.
            readFile(MCPUI_LAB_VIEW_BUILD_PATH, 'utf8')
              .then((html) => {
                response.status(200);
                response.setHeader('Content-Type', 'text/html; charset=utf-8');
                response.setHeader('Content-Security-Policy', MCPUI_LAB_VIEW_CSP);
                response.setHeader('X-Content-Type-Options', 'nosniff');
                response.setHeader('Cache-Control', 'no-store');
                response.end(html);
              })
              .catch(() => {
                response.status(503).json({
                  message:
                    `${MCPUI_LAB_VIEW_BUILD_PATH} is missing — run `
                    + '`pnpm --filter @jini-app/reference-web run build:mcpui-view` to build the MCP Apps View.',
                });
              });
          });
        },
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
        // Checked before decodePlaygroundRunRequest: the A2UI Lab's contextRef is not shaped like a
        // playground sample-project request (no prompt/project — it is a standalone UI demo, not a
        // workspace inspection), so it must never reach that playground-specific decoder.
        if (request.agentId === A2UI_DEMO_AGENT_ID) {
          void runA2uiDemo(run.id, lifecycle).catch((error: unknown) => {
            console.error('[A2UI Lab] demo run failed', error);
          });
          return;
        }
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

  const a2uiActionRelay = startA2uiActionRelay(A2UI_ACTION_PORT);

  console.log(`[Jini Playground] daemon ready at ${daemon.url}`);
  console.log(`[A2UI Lab] action relay ready at http://127.0.0.1:${A2UI_ACTION_PORT}`);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    a2uiActionRelay.close();
    void daemon.stop().finally(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

void main().catch((error: unknown) => {
  console.error('[Jini Playground] daemon failed to start', error);
  process.exitCode = 1;
});
