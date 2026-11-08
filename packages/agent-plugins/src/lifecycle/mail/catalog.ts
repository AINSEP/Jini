import type { MailAdapterCredential, MailProviderModule, MailProviderRegistry, MailProviderSetup } from "@jini-ai/core/contracts/mail";
import type { PluginCredentialCard } from "@jini-ai/core/contracts/credentials";
import type { MailAdapterRegistry } from "./contribution.js";
export interface MailCatalogDeps {
 loadMailAdapters: () => Promise<MailAdapterRegistry>;
 createSmtpTransport: (config: { host: string; port: number; secure: boolean; auth: { user: string; pass: string } }) => { sendMail(mail: SmtpPayload): Promise<{ messageId: string }> };
 log?: ((line: string) => void) | undefined;
 resolvePluginAccountToken?: ((required: { pluginId: string; serverId: string }) => Promise<string | null>) | undefined;
}
interface SmtpPayload {
 from: { name?: string; address: string }; to: { name?: string; address: string }; replyTo?: { name?: string; address: string };
 subject: string; html?: string; text?: string; headers?: Readonly<Record<string,string>>;
 attachments?: { filename: string; content: string; encoding: "base64"; contentType: string }[];
}
type Clock = { nowMs(): number };
export interface MailProviderCatalog {
  readonly registry: MailProviderRegistry;
  /** Plugin provider ids in registry order (plugin id, then declaration order). */
  readonly pluginIds: readonly string[];
  /** Saved-credential label per provider; undefined for a provider that needs none (console, or a
   *  plugin declaring no credential keys) and for an id that is not registered. */
  credentialLabelFor(required: { id: string }): string | undefined;
  /** Plugin adapters/providers that were not loaded, and why (log-safe). */
  readonly refusals: readonly string[];
  /** The provider's declarative setup form; no fields for one that needs no saved key. */
  setupFor(required: { id: string }): MailProviderSetup;
}

/** @agent-note The host supplies mail engine effects and exact product text; no platform runtime is imported. */
export function createMailCatalog(requiredHost: {
 mailEngine: { createRegistry: (required: Record<string,never>, optional: { builtins: readonly MailProviderModule[] }) => MailProviderRegistry;
 builtins: { console: (required: { clock: Clock }, optional?: { log?: (line:string)=>void }) => MailProviderModule;
 smtp: (required: { clock: Clock; createTransport: (config: Parameters<MailCatalogDeps["createSmtpTransport"]>[0]) => { sendMail(required: { mail: SmtpPayload }): Promise<{ messageId: string }> } }) => MailProviderModule } };
 mailHostText: { smtpCredentialLabel: string; smtpSetup: MailProviderSetup; credentialCategory: PluginCredentialCard["category"] };
 defaultSetup: (required: { credentialKeys: readonly string[] }) => MailProviderSetup;
 contributeMailProviders: (required: { registry: MailProviderRegistry; adapters: MailAdapterRegistry }) => { accepted: readonly string[]; refusals: readonly string[] };
}, _optional: Record<string,never> = {}) {

function builtins(deps: MailCatalogDeps): MailProviderModule[] {
  const clock = { nowMs: () => Date.now() };
  const createTransport = deps.createSmtpTransport;
  // The host's transport takes the payload positionally; Jini's SMTP adapter calls it with `{mail}`.
  const smtp = requiredHost.mailEngine.builtins.smtp({ clock, createTransport: (config) => {
    const transport = createTransport(config);
    return { sendMail: ({ mail }) => transport.sendMail(mail) };
  } });
  return [smtp, requiredHost.mailEngine.builtins.console({ clock }, deps.log ? { log: deps.log } : {})];
}

/** Plugin registry, or an empty one plus the reason it could not be read. */
async function loadAdapters(deps: Pick<MailCatalogDeps, "loadMailAdapters">): Promise<MailAdapterRegistry> {
  try {
    return await deps.loadMailAdapters();
  } catch (err) {
    return { list: () => [], refusals: [`the plugin mail adapters could not be listed (${err instanceof Error ? err.message : String(err)})`] };
  }
}

/**
 * Builds the catalog fresh (plugins can be installed after boot). Never throws for a plugin fault.
 * @complexity O(a) plugin adapters.
 */
async function loadMailProviderCatalog(deps: MailCatalogDeps, _optional: Record<string, never> = {}): Promise<MailProviderCatalog> {
  const registry = requiredHost.mailEngine.createRegistry({}, { builtins: builtins(deps) });
  const adapters = await loadAdapters(deps);
  const { accepted, refusals } = requiredHost.contributeMailProviders({ registry, adapters });
  const labels = new Map<string, string>([["smtp", requiredHost.mailHostText.smtpCredentialLabel]]);
  const setups = new Map<string, MailProviderSetup>([["smtp", requiredHost.mailHostText.smtpSetup]]);
  for (const adapter of adapters.list()) {
    // Only providers that read a credential get a label; label presence is "needs a saved key".
    const keys = adapter.descriptor.credentialKeys ?? ["token"];
    if (!accepted.includes(adapter.descriptor.id) || keys.length === 0) continue;
    labels.set(adapter.descriptor.id, adapter.descriptor.credentialLabel);
    setups.set(adapter.descriptor.id, adapter.descriptor.setup ?? requiredHost.defaultSetup({ credentialKeys: keys }));
  }
  return { registry, pluginIds: accepted, refusals, credentialLabelFor: ({ id }) => labels.get(id), setupFor: ({ id }) => setups.get(id) ?? { fields: [] } };
}

/**
 * The key cards mail plugins declare (`credentialCard` in their descriptor), each filed under the
 * adapter's own credential label and the mail category, so `credential_save` `{kind:"plugin-provider"}`
 * saves the key exactly where the adapter reads it. Never throws: an unreadable list has no cards.
 * @complexity O(a) plugin adapters.
 */
async function loadMailCredentialCards(
  required: Pick<MailCatalogDeps, "loadMailAdapters">,
  _optional: Record<string, never> = {}
): Promise<readonly PluginCredentialCard[]> {
  return (await loadAdapters(required)).list().flatMap(({ descriptor, pluginId }) => descriptor.credentialCard
    ? [{ pluginId, providerId: descriptor.id, label: descriptor.credentialLabel, category: requiredHost.mailHostText.credentialCategory, ...descriptor.credentialCard }]
    : []);
}

/** Resolve a trusted plugin's domain-read key without changing its sending credential.
 * @complexity O(a) loaded adapters, one account lookup and at most one decrypt. */
async function resolveMailDomainReadCredential(
  required: { deps: MailCatalogDeps; id: string },
  _options: Record<string, never> = {},
): Promise<MailAdapterCredential | null> {
  const { deps, id } = required;
  const owner = (await loadMailProviderCatalog(deps)).registry.get({ id })?.pluginId;
  if (!owner) return null;
  const adapter = (await loadAdapters(deps)).list().find(item => item.descriptor.id === id && item.pluginId === owner);
  const connection = adapter?.module.domainReadConnection;
  if (!adapter || !connection || !deps.resolvePluginAccountToken) return null;
  // The account key goes only to the plugin-declared API, never a sending key's custom base URL.
  if (new URL(connection.baseUrl).protocol !== "https:") return null;
  const token = await deps.resolvePluginAccountToken({ pluginId: adapter.pluginId, serverId: connection.serverId });
  return token ? { token, baseUrl: connection.baseUrl } : null;
}


return { loadMailProviderCatalog, loadMailCredentialCards, resolveMailDomainReadCredential };
}
