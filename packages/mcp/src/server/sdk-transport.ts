import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpTransportLike } from './ports.js';

const sdkTransports = new WeakMap<McpTransportLike, Transport>();

/** Internal boundary adapter; SDK callbacks keep their native signature behind the port. */
export function adaptSdkTransport({ transport: sdk }: { transport: Transport }): McpTransportLike {
  const transport: McpTransportLike = {
    get onmessage(): McpTransportLike['onmessage'] {
      const handler = sdk.onmessage;
      return handler ? ({ message }) => handler(message as Parameters<NonNullable<typeof handler>>[0]) : undefined;
    },
    set onmessage(handler) {
      if (handler) sdk.onmessage = (message) => handler({ message });
      else delete sdk.onmessage;
    },
    get onclose() { return sdk.onclose; },
    set onclose(handler) {
      if (handler) sdk.onclose = handler;
      else delete sdk.onclose;
    },
    close: (_required) => sdk.close(),
  };
  sdkTransports.set(transport, sdk);
  return transport;
}

/** Resolves adapters to the underlying SDK transport; host ports stay structurally usable. */
export function resolveSdkTransport({ transport }: { transport: McpTransportLike }): Transport {
  return (sdkTransports.get(transport) ?? transport) as Transport;
}
