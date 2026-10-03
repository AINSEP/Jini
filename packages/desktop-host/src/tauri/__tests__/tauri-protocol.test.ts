import { describe, expect, it } from 'vitest';
import { createTauriProtocolHandlerPort } from '../tauri-protocol.js';
import { NotImplementedError } from '../not-implemented.js';

describe('createTauriProtocolHandlerPort', () => {
  it('throws NotImplementedError — custom scheme registration has no JS-callable Tauri equivalent', () => {
    const port = createTauriProtocolHandlerPort({});
    expect(() => port.registerSchemeProxy({ scheme: 'jini', targetBaseUrl: 'http://127.0.0.1:0' })).toThrow(NotImplementedError);
  });
});
