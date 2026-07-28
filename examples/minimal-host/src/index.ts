/**
 * @module minimal-host entry point
 *
 * The neutrality-proof entry point (README.md; foundry/docs/jini-port/extraction-plan.md §2.4/§7):
 * imports ONLY `@jini-ai/*` packages, boots a real `createLocalNodeDaemon` daemon (the "host
 * preset" — zero product concepts, zero interfaces implemented) with no feature packs, then
 * exercises its complete run vertical slice over real HTTP: create, stream, reconnect with a
 * cursor, cancel, restart and replay. `scripts/health-boot.ts` runs this file from a scratch copy
 * of this package installed from packed `@jini-ai/*` tarballs (never a workspace link) as the actual
 * proof that the engine works outside this monorepo's source tree.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentExecutor } from '@jini-ai/daemon';
import type { AgentLaunchResolution, RuntimeAgentDef } from '@jini-ai/agent-runtime';
import { createLocalNodeDaemon } from '@jini-ai/node-host';

interface DaemonStatusBody {
  ok?: boolean;
  version?: string;
}

interface RunResponse {
  run?: { id?: string; state?: string };
  started?: boolean;
}

/**
 * A portable ACP subprocess fixture. It requires no vendor binary or account,
 * but exercises the real Node spawn + ACP handshake + permission path used by
 * registered ACP agents in the engine.
 */
const ACP_FIXTURE = String.raw`
let buffered = '';
function send(frame) { process.stdout.write(JSON.stringify(frame) + '\n'); }
function handle(frame) {
  if (frame.method === 'initialize') {
    send({ jsonrpc: '2.0', id: frame.id, result: {} });
    return;
  }
  if (frame.method === 'session/new') {
    send({ jsonrpc: '2.0', id: frame.id, result: { sessionId: 'minimal-host-acp' } });
    return;
  }
  if (frame.method === 'session/prompt') {
    send({
      jsonrpc: '2.0', id: 91, method: 'session/request_permission',
      params: {
        sessionId: 'minimal-host-acp',
        toolCall: { toolCallId: 'minimal-host-call', title: 'fixture operation' },
        options: [{ optionId: 'allow', kind: 'allow_once' }]
      }
    });
    return;
  }
  if (frame.id === 91 && frame.result && frame.result.outcome && frame.result.outcome.optionId === 'allow') {
    send({
      jsonrpc: '2.0', method: 'session/update',
      params: { update: { sessionUpdate: 'agent_message_chunk', text: 'minimal-host ACP completed run' } }
    });
    send({ jsonrpc: '2.0', id: 3, result: {} });
  }
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffered += chunk;
  for (;;) {
    const newline = buffered.indexOf('\n');
    if (newline < 0) return;
    const line = buffered.slice(0, newline);
    buffered = buffered.slice(newline + 1);
    if (line) handle(JSON.parse(line));
  }
});
process.stdin.on('end', () => process.exit(0));
`;

function acpFixtureDef(): RuntimeAgentDef {
  return {
    id: 'acp-fixture',
    name: 'ACP Fixture',
    bin: process.execPath,
    versionArgs: ['--version'],
    fallbackModels: [],
    buildArgs: () => ['-e', ACP_FIXTURE],
    streamFormat: 'acp-json-rpc',
  };
}

function assertOk(response: Response, operation: string): Promise<Response> {
  if (response.ok) return Promise.resolve(response);
  return response.text().then((body) => {
    throw new Error(`minimal-host: ${operation} returned HTTP ${response.status}: ${body}`);
  });
}

function sseEventIds(body: string): string[] {
  return [...body.matchAll(/^id: (.+)$/gm)].map((match) => match[1] ?? '');
}

async function main(): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), 'jini-minimal-host-'));
  const cancellationCompletions = new Map<string, Promise<unknown>>();
  const startDaemon = () =>
    createLocalNodeDaemon({
      dataDir,
      packs: [],
      onRunStarted: async ({ request, run, lifecycle }) => {
        if (request.agentId === 'wait-for-cancel') {
          lifecycle.onCancelRequested(run.id, () => {
            cancellationCompletions.set(
              run.id,
              lifecycle.finish({ runId: run.id, status: 'cancelled', code: null, signal: null, resumable: false }),
            );
          });
          return;
        }

        if (request.agentId === 'acp-fixture') {
          const executor = createAgentExecutor({
            lifecycle,
            getAgentDef: (agentId) => (agentId === 'acp-fixture' ? acpFixtureDef() : null),
            resolveAgentLaunch: () =>
              ({
                selectedPath: process.execPath,
                pathResolvedPath: process.execPath,
                configuredOverridePath: null,
                launchPath: process.execPath,
                launchKind: 'selected',
                childPathPrepend: [],
                diagnostic: null,
              }) as AgentLaunchResolution,
            applyAgentLaunchEnv: (env) => env,
            acpPermissionHandler: () => ({ outcome: 'selected', optionId: 'allow' }),
          });
          await executor.run({
            runId: run.id,
            agentId: 'acp-fixture',
            prompt: 'complete the minimal-host ACP fixture',
            cwd: process.cwd(),
          });
          return;
        }

        await lifecycle.emit(run.id, { event: 'stdout', data: { chunk: 'minimal-host completed run' } });
        await lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });
      },
    });

  let daemon = await startDaemon();
  try {
    // A genuine exercise of packed dependencies, not a no-op: this begins with a daemon-status
    // request and then uses the real HTTP run endpoints that are also exposed to consumers.
    const response = await assertOk(await fetch(`${daemon.url}/api/daemon/status`), 'GET /api/daemon/status');
    const body = (await response.json()) as DaemonStatusBody;
    if (body.ok !== true) {
      throw new Error(`minimal-host: unexpected /api/daemon/status body: ${JSON.stringify(body)}`);
    }

    const create = await assertOk(
      await fetch(`${daemon.url}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contextRef: 'minimal-host-complete', idempotencyKey: 'complete-once' }),
      }),
      'POST /api/runs',
    );
    const created = (await create.json()) as RunResponse;
    const completedRunId = created.run?.id;
    if (created.run?.state !== 'succeeded' || typeof completedRunId !== 'string') {
      throw new Error(`minimal-host: completed run did not reach succeeded: ${JSON.stringify(created)}`);
    }

    const firstStream = await assertOk(
      await fetch(`${daemon.url}/api/runs/${encodeURIComponent(completedRunId)}/events`),
      'GET /api/runs/:id/events',
    );
    const firstStreamBody = await firstStream.text();
    const firstCursors = sseEventIds(firstStreamBody);
    if (firstCursors.length < 3) {
      throw new Error(`minimal-host: initial stream missed durable events: ${firstStreamBody}`);
    }

    const reconnected = await assertOk(
      await fetch(`${daemon.url}/api/runs/${encodeURIComponent(completedRunId)}/events`, {
        headers: { 'last-event-id': firstCursors[0] ?? '' },
      }),
      'GET /api/runs/:id/events reconnect',
    );
    const reconnectedBody = await reconnected.text();
    if (!reconnectedBody.includes('event: stdout') || !reconnectedBody.includes('event: end')) {
      throw new Error(`minimal-host: reconnect did not replay remaining events: ${reconnectedBody}`);
    }

    const acp = await assertOk(
      await fetch(`${daemon.url}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contextRef: 'minimal-host-acp', agentId: 'acp-fixture' }),
      }),
      'POST /api/runs ACP fixture',
    );
    const acpBody = (await acp.json()) as RunResponse;
    const acpRunId = acpBody.run?.id;
    if (typeof acpRunId !== 'string') {
      throw new Error(`minimal-host: ACP fixture did not create a run: ${JSON.stringify(acpBody)}`);
    }
    const acpStream = await assertOk(
      await fetch(`${daemon.url}/api/runs/${encodeURIComponent(acpRunId)}/events`),
      'GET /api/runs/:id/events ACP fixture',
    );
    const acpStreamBody = await acpStream.text();
    if (!acpStreamBody.includes('minimal-host ACP completed run') || !acpStreamBody.includes('event: end')) {
      throw new Error(`minimal-host: ACP fixture did not stream to completion: ${acpStreamBody}`);
    }

    const waiting = await assertOk(
      await fetch(`${daemon.url}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contextRef: 'minimal-host-cancel', agentId: 'wait-for-cancel' }),
      }),
      'POST /api/runs waiting',
    );
    const waitingBody = (await waiting.json()) as RunResponse;
    const waitingRunId = waitingBody.run?.id;
    if (waitingBody.run?.state !== 'running' || typeof waitingRunId !== 'string') {
      throw new Error(`minimal-host: waiting run did not start: ${JSON.stringify(waitingBody)}`);
    }
    await assertOk(
      await fetch(`${daemon.url}/api/runs/${encodeURIComponent(waitingRunId)}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'minimal-host cancellation check' }),
      }),
      'POST /api/runs/:id/cancel',
    );
    const cancellation = cancellationCompletions.get(waitingRunId);
    if (cancellation === undefined) throw new Error('minimal-host: cancellation driver was not invoked');
    await cancellation;

    // New process, same SQLite database: the lifecycle must rebuild its status index and stream
    // the old events. This is the restart/replay proof, not merely a second in-process lookup.
    await daemon.stop();
    daemon = await startDaemon();
    const restored = await assertOk(
      await fetch(`${daemon.url}/api/runs/${encodeURIComponent(completedRunId)}`),
      'GET /api/runs/:id after restart',
    );
    const restoredBody = (await restored.json()) as RunResponse;
    if (restoredBody.run?.state !== 'succeeded') {
      throw new Error(`minimal-host: durable state was not restored: ${JSON.stringify(restoredBody)}`);
    }
    const replayed = await assertOk(
      await fetch(`${daemon.url}/api/runs/${encodeURIComponent(completedRunId)}/events`),
      'GET /api/runs/:id/events after restart',
    );
    if (!(await replayed.text()).includes('event: end')) {
      throw new Error('minimal-host: durable event replay missed terminal event after restart');
    }
  } finally {
    await daemon.stop();
    rmSync(dataDir, { recursive: true, force: true });
  }
  // eslint-disable-next-line no-console
  console.log('MINIMAL_HOST_BOOT_OK');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
