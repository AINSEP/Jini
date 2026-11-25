/** Setup registers the xAI route contribution; the host owns mounting it and supplies the OAuth, clock and URL-guard ports.
 * The grok media contribution is added beside this one under `./media/`. */
import type { PluginSdk } from '@jini-ai/core/contracts/plugin-sdk';
import { xaiRoutes } from './routes.js';
import { XAI_OAUTH_PROVIDER_CONFIG, xaiOAuthRedirectUri } from './preset.js';

/** Builds a stateless resource: the route builder and the preset. Opens no listener and reads no credential; every effect arrives through `xaiRoutes`' injected deps. */
export function createXaiRoutesProvider(_required: Readonly<Record<string, unknown>>, _optional: Readonly<Record<string, unknown>> = {}) {
  return { port: { routes: xaiRoutes, providerConfig: XAI_OAUTH_PROVIDER_CONFIG, redirectUri: xaiOAuthRedirectUri }, dispose: (_required: Record<string, never>, _optional: Record<string, never> = {}) => {} };
}

export default {
  definition: {
    setup(sdk: PluginSdk): void {
      sdk.providers.register({ contract: 'xai-routes', id: 'xai', contractVersion: 1, factory: createXaiRoutesProvider });
    },
  },
};
