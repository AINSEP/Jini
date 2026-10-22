import { describe, expect, it } from 'vitest';
import { createElectronProtocolHandlerPort } from '../electron-protocol.js';
import { createFakeElectronProtocol } from '../testing.js';

describe('createElectronProtocolHandlerPort', () => {
  it('registers the scheme and proxies requests through it to the target base url', async () => {
    const protocol = createFakeElectronProtocol({});
    const port = createElectronProtocolHandlerPort({ electronProtocol: protocol });
    const registration = port.registerSchemeProxy({ scheme: 'jini', targetBaseUrl: 'http://127.0.0.1:4000/' });
    expect(registration).toEqual({ scheme: 'jini', entryUrl: 'jini://app/' });

    const handler = protocol.handlers.get('jini');
    expect(handler).toBeTypeOf('function');
    const response = await handler!({ request: new Request('jini://app/hello') });
    expect(response.status).toBe(502);
  });
});
