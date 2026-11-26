import {
  asApiConnectionHooksModule, checkApiConnectionClientNamespace, parseApiConnectionsFile as parseApiConnectionDeclarations,
  type ApiConnectionDeclaration, type ApiConnectionHooksModule,
} from './declarations.js';
import { parseApiConnectionDescriptor, type ApiConnectionCallbackFieldRules } from './descriptor.js';
import type { ClientNamespaceFor } from '@jini-ai/core/contracts/site/integrations-api-connections';
import type { DeclaredApiConnection } from './host-ports.js';

/**
 * @file Loads the OAuth API connections Agent Plugins declare in {@link API_CONNECTIONS_FILENAME}:
 * the provider descriptor Jini's api-connections service runs, the plugin's hooks module (scope
 * sets, account identity, revocation) and the names of the host config that holds its client ids.
 *
 * TRUST RULE: hooks are plugin code running in this process, so they load through the lifecycle's
 * one executable gate (ACTIVE plugin, bundled digest, contained `.mjs`), like mail adapters. The
 * descriptor is untrusted until Jini's `parseApiConnectionDescriptor` accepts it. Client config is
 * only ever NAMED by the plugin: names must sit in the host client namespace and the full plugin-id namespace, so a plugin can point
 * at its own `…_CLIENT_ID` / `…_CLIENT_SECRET` and never at another secret of this host. Request
 * budgets (`budgets`) are clamped to the host's maxima by `budgets.ts` and never reach the descriptor;
 * nor do `scopeSets` (the plugin's scope-set ids, for status), `apiOrigins` (the https origins its
 * API calls reach, for form delivery's host allowlist) and `byoClient` (whether a workspace admin may
 * use their own OAuth client, `byo-client.ts`), which only the host reads.
 */

export const API_CONNECTIONS_FILENAME = 'jini-connections.json';

/** The first `_`-ended segment of the first declared client id setting (`VENDOR_` in `VENDOR_ACME_OAUTH_WEB_CLIENT_ID`), if the file names one. @complexity O(1). */
function declaredNamespace({ raw }: { readonly raw: string }, _optional: Record<string, never> = {}): string | undefined {
  try {
    const first = (JSON.parse(raw) as { connections?: readonly { clients?: Record<string, { clientIdEnv?: unknown } | undefined> }[] }).connections?.[0]?.clients;
    const id = Object.values(first ?? {})[0]?.clientIdEnv;
    return typeof id === "string" ? /^[A-Z][A-Z0-9]*_/.exec(id)?.[0] : undefined;
  } catch { return undefined; }
}

/**
 * Every trusted API connection the workspace's active plugins declare, plus log-safe refusals.
 * A descriptor Jini refuses drops only that connection.
 * @complexity O(p + c) plugins and connections, one contained import per connection.
 */
export async function loadDeclaredApiConnections(required: {
  readonly workspaceId: string; readonly clientNamespace: string; readonly callbackFieldRules: ApiConnectionCallbackFieldRules;
  readonly loadContributions: (input: { readonly workspaceId: string; readonly definition: {
    readonly filename: string; readonly contribution: string;
    readonly parse: (input: { raw: string }) => ReturnType<typeof parseApiConnectionDeclarations>;
    readonly modulePath: (input: { descriptor: ApiConnectionDeclaration }) => string;
    readonly validate: (input: { exported: unknown }) => ApiConnectionHooksModule | string;
    readonly refusal: (input: { plugin: { pluginId: string }; descriptor: ApiConnectionDeclaration; reason: string }) => string;
  }; readonly onReadError: (input: { error: unknown }) => readonly string[] | undefined }, options: { orderByPluginId: boolean }) => Promise<{
    readonly items: readonly { readonly pluginId: string; readonly descriptor: ApiConnectionDeclaration; readonly module: ApiConnectionHooksModule }[];
    readonly refusals: readonly string[];
  }>;
}, optional: { readonly clientNamespaceFor?: ClientNamespaceFor } = {}): Promise<{ readonly connections: readonly DeclaredApiConnection[]; readonly refusals: readonly string[] }> {
  const CLIENT_NAMESPACE = required.clientNamespace;
  const connectionContribution = {
    filename: API_CONNECTIONS_FILENAME, contribution: "API connections",
    parse: ({ raw }: { raw: string }) => {
      const parsed = parseApiConnectionDeclarations({ raw, clientNamespace: CLIENT_NAMESPACE });
      if (parsed.ok) return parsed;
      // Shape only: a plugin may name settings under the prefix its manifest declares. Who may use which
      // name is decided per plugin, by `checkApiConnectionClientNamespace` in the loader below.
      const declared = declaredNamespace({ raw });
      const alternate = declared === undefined ? parsed : parseApiConnectionDeclarations({ raw, clientNamespace: declared });
      return alternate.ok ? alternate : parsed;
    }, modulePath: ({ descriptor }: { descriptor: ApiConnectionDeclaration }) => descriptor.module,
    validate: ({ exported }: { exported: unknown }) => asApiConnectionHooksModule({ exported }),
    refusal: ({ plugin, descriptor, reason }: { plugin: { pluginId: string }; descriptor: ApiConnectionDeclaration; reason: string }) => `API connection '${descriptor.id}' from '${plugin.pluginId}' was not loaded: ${reason}`,
  };
  const load = await required.loadContributions({ workspaceId: required.workspaceId, definition: connectionContribution,
    onReadError: ({ error }) => ((error as NodeJS.ErrnoException)?.code === "ENOENT" ? [] : undefined) }, { orderByPluginId: true });
  const connections: DeclaredApiConnection[] = [];
  const refusals = [...load.refusals];
  for (const item of load.items) {
    try {
      checkApiConnectionClientNamespace({ pluginId: item.pluginId, clients: item.descriptor.clients, clientNamespace: (await optional.clientNamespaceFor?.({ pluginId: item.pluginId })) ?? CLIENT_NAMESPACE });
      const descriptor = parseApiConnectionDescriptor({ callbackFieldRules: required.callbackFieldRules, value: { ...item.descriptor.descriptor, pluginId: item.pluginId, connectionId: item.descriptor.id } });
      const { clients, budgets, scopeSets, apiOrigins, byoClient } = item.descriptor;
      connections.push({ pluginId: item.pluginId, descriptor, clients, budgets, scopeSets, apiOrigins, byoClient, module: item.module });
    } catch (error) {
      refusals.push(`API connection '${item.descriptor.id}' from '${item.pluginId}' was not loaded: ${error instanceof Error ? error.message : "invalid descriptor"}`);
    }
  }
  return { connections, refusals };
}
