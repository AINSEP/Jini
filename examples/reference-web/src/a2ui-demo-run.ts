import { createLabCatalog, parseAgentToRendererMessage, type AgentToRendererMessage, type RendererToAgentMessage } from '@jini-ai/agentic/a2ui';
import type { RunLifecycle } from '@jini-ai/daemon';
import type { RunAgentPayload } from '@jini-ai/protocol';

type DemoLifecycle = Pick<RunLifecycle, 'onCancelRequested' | 'emit' | 'finish'>;
interface DemoPorts {
  delay(milliseconds: number): Promise<void>;
  now(): number;
  waitForAction(runId: string, isCanceled: () => boolean): Promise<RendererToAgentMessage | null>;
  clearActionWaiters(runId: string): void;
}

/** Drives the lab's existing lifecycle with host-owned timing and action delivery. */
export async function driveA2uiDemoRun({ runId, lifecycle, ports }: { runId: string; lifecycle: DemoLifecycle; ports: DemoPorts }, _options = {}): Promise<void> {
  let canceled = false;
  lifecycle.onCancelRequested({ runId, listener: () => {
    canceled = true;
  } });
  const emitAgent = (data: RunAgentPayload) => lifecycle.emit({ runId, input: { event: 'agent', data } });
  /**
   * Validates every outgoing message against `@jini-ai/agentic/a2ui`'s own `parseAgentToRendererMessage`
   * before it goes out over the wire — this demo dogfoods the same schema the browser-side
   * interpreter enforces, so a typo in one of the literal messages below fails loudly here
   * instead of silently reaching the renderer as a message it then has to reject.
   */
  const emitA2ui = (message: AgentToRendererMessage) => {
    const validated = parseAgentToRendererMessage({ raw: message });
    if (!validated.ok) {
      throw new Error(`[A2UI Lab] refusing to emit a message that fails its own schema: ${validated.message}`);
    }
    emitAgent({ type: 'a2ui', message: validated.message });
  };

  const catalog = createLabCatalog({});
  const surfaceId = `${runId}-surface`;

  await emitAgent({ type: 'status', label: 'Building an A2UI surface', detail: catalog.catalogId });
  await ports.delay(200);
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
  await ports.delay(150);

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
  const startedAt = ports.now();
  for (;;) {
    if (canceled || ports.now() - startedAt > IDLE_TIMEOUT_MS) break;
    const received = await ports.waitForAction(runId, () => canceled);
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
    await ports.delay(60);
    emitA2ui({ version: 'v1.0', updateDataModel: { surfaceId, path: '/clicks', value: clicks } });
  }

  ports.clearActionWaiters(runId);
  await finishA2uiDemo({ runId, lifecycle, canceled });
}

async function finishA2uiDemo({ runId, lifecycle, canceled }: { runId: string; lifecycle: DemoLifecycle; canceled: boolean }): Promise<void> {
  await lifecycle.finish({ runId, status: canceled ? 'cancelled' : 'succeeded', code: canceled ? null : 0, signal: null, resumable: false });
}
