import { handleProtocolProxyRequest, schemeEntryUrl, type ProtocolHandlerPort, type ProtocolSchemeRegistration } from '../protocol.js';
import type { ElectronProtocolLike } from './electron-surfaces.js';

export function createElectronProtocolHandlerPort({ electronProtocol }: { electronProtocol: ElectronProtocolLike }): ProtocolHandlerPort {
  return {
    registerSchemeProxy({ scheme, targetBaseUrl }: { scheme: string; targetBaseUrl: string }): ProtocolSchemeRegistration {
      electronProtocol.registerSchemesAsPrivileged({ schemes: [
        { scheme, privileges: { standard: true, secure: true, corsEnabled: true, supportFetchAPI: true, stream: true } },
      ] });
      electronProtocol.handle({ scheme, handler: async ({ request }) => handleProtocolProxyRequest({ request, targetBaseUrl }) });
      return { scheme, entryUrl: schemeEntryUrl({ scheme }) };
    },
  };
}
