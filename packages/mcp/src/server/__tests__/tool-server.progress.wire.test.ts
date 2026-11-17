import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { onTestFinished, describe, expect, it } from 'vitest';

import { adaptSdkTransport } from '../sdk-transport.js';
import type { McpToolDef } from '../tool-protocol.js';
import { createMcpToolServer } from '../tool-server.js';
import { createFakeScheduler } from './call-progress.fixture.js';

/** Real SDK Server and Client over the SDK's own in-memory transport; only the timer is a fake. */

const settle = () => new Promise<void>(resolve => { setTimeout(resolve, 5); });

describe('progress frames on the wire', () => {
  it('a slow local tool yields progress frames for a client that sent a token, and no frame after the response', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const slow: McpToolDef = {
      name: 'slow', description: 'waits', inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => { await gate; return 'finished'; },
    };
    const clock = createFakeScheduler();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createMcpToolServer(
      { name: 'wire-progress-server', version: '0.0.0', tools: [slow], resolveBaseUrl: () => 'http://d.example' },
      { progressScheduler: clock.scheduler },
    ).run({ transport: adaptSdkTransport({ transport: serverTransport }) });
    const client = new Client({ name: 'wire-progress-client', version: '0.0.0' });
    await client.connect(clientTransport);
    onTestFinished(async () => { await client.close(); });

    const inbound: Array<{ method?: string; id?: unknown }> = [];
    const clientOnMessage = clientTransport.onmessage;
    clientTransport.onmessage = (message, extra) => { inbound.push(message as { method?: string; id?: unknown }); clientOnMessage?.(message, extra); };
    const seen: Array<{ progress: number; message?: string | undefined }> = [];
    const pending = client.callTool({ name: 'slow', arguments: {} }, undefined, { onprogress: ({ progress, message }) => { seen.push({ progress, message }); } });

    await settle();
    clock.advance({ ms: 75_000 });
    await settle();
    expect(seen).toEqual([1, 2, 3].map(progress => ({ progress, message: 'waiting' })));
    release();
    const result = await pending;
    expect(result.content).toEqual([{ type: 'text', text: 'finished' }]);

    const framesAtResponse = inbound.length;
    clock.advance({ ms: 300_000 });
    await settle();
    expect(inbound).toHaveLength(framesAtResponse);
    expect(inbound.map(message => message.method ?? 'response')).toEqual(['notifications/progress', 'notifications/progress', 'notifications/progress', 'response']);
  });
});
