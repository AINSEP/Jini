/** Host-port fakes for the ported resolver suites; no vault, plugin loader or network is needed. */
import type { HttpClientPort } from "@jini-ai/core/primitives";
import type { MailAdapterCredential } from "../adapter-module.js";
import { createConsoleMailProvider } from "../builtin-providers.js";
import type { MailCredentialFact, MailProviderCatalog, MailProviderConfigurationReport } from "../engine-contracts.js";
import type { MailerPort } from "../ports.js";
import { createMailProviderRegistry, type MailProviderModule, type MailProviderSetting } from "../provider.js";
import { createResolvedMailer, type ResolveMailerDeps, type ResolveMailerOptions } from "../resolve-mailer.js";
import type { MailerSendResult } from "../types.js";

export const WS = "ws-mail";
export const LABEL = "Mail API key";
export const MESSAGE = { workspaceId: WS, to: { email: "a@example.com" }, from: { email: "b@example.com" }, subject: "hi", text: "hi" };
export const DELIVERY = { idempotencyKey: "k1", workspaceId: WS, sourceContext: { module: "test" } };
export const SEND = { ...DELIVERY, message: MESSAGE };
export const BATCH = { ...DELIVERY, messages: [MESSAGE, MESSAGE] };
export const ACCEPTED: MailerSendResult = { ok: true, providerMessageId: "fake-1", acceptedAt: "2026-10-22T00:00:00.000Z" };
export const FAILED: MailerSendResult = { ok: false, retryable: false, errorCode: "AUTH", message: "the provider rejected the key" };

/** Deterministic promise gates expose races without sleeps or polling. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Mutable persisted selection, including the never-stored null state. */
export function memorySetting(initial: MailProviderSetting | null = null) {
  const port = {
    value: initial, writes: [] as MailProviderSetting[],
    read: async () => port.value,
    write: async ({ setting }: { setting: MailProviderSetting }) => { port.writes.push(setting); port.value = setting; },
  };
  return port;
}

/** Synthetic provider factory records constructed and actually used credentials independently. */
function fixtureProvider(required: { keys: string[]; sends: string[]; result: () => MailerSendResult; batch: () => readonly MailerSendResult[] }): MailProviderModule {
  return {
    id: "api", label: "Mail API", credentialKeys: ["token"], capabilities: { hosted: true, feedback: false, domainVerification: false },
    create: ({ credential }): MailerPort => {
      required.keys.push(credential.token);
      return {
        capabilities: () => ({ driver: "api", supportsIdempotencyKey: false, supportsWebhookFeedback: false, maxBatchSize: 1, supportsAttachments: false }),
        send: async () => { required.sends.push(credential.token); return required.result(); },
        sendBatch: async () => { required.sends.push(credential.token); return required.batch(); },
      };
    },
  };
}

/** Safe projection stands in for the host DTO owner; the resolver only supplies facts and selection. */
function describe(required: Parameters<ResolveMailerDeps["describeProviders"]>[0]): MailProviderConfigurationReport {
  const { catalog, records, setting } = required;
  return { setting, refusals: catalog.refusals, providers: catalog.registry.list().map(entry => {
    const { id, provider } = entry;
    const label = catalog.credentialLabelFor({ id });
    const fact = records.find(row => row.label === label);
    return {
      id, label: provider.label, origin: "core", hosted: provider.capabilities.hosted,
      lanes: (["transactional", "bulk"] as const).filter(lane => setting[lane] === id), capabilities: provider.capabilities,
      credential: { required: label !== undefined, saved: fact !== undefined, ...(label === undefined ? {} : { label }), ...(fact ? { credentialId: fact.id, updatedAt: fact.updatedAt } : {}) },
      selectable: provider.capabilities.hosted && (label === undefined || fact !== undefined), setup: catalog.setupFor({ id }),
    };
  }) };
}

/** Build the same catalog/credential/settings seams the real host will bind in the adoption shard. */
export function fixture(optional: { setting?: MailProviderSetting | null; saved?: boolean; keyless?: boolean; mode?: "local" | "production" } = {}) {
  const setting = memorySetting(optional.setting === undefined ? { transactional: "api", bulk: "api" } : optional.setting);
  const keys: string[] = [], sends: string[] = [], warnings: string[] = [], logs: string[] = [], effects: string[] = [];
  const rows = new Map<string, { fact: MailCredentialFact; credential: MailAdapterCredential }>();
  let revision = 0;
  const save = (token: string, label = LABEL): void => {
    revision++;
    rows.set(label, { fact: { id: "credential-1", label, vaultRevision: revision, updatedAt: "2026-10-22T00:00:00.000Z" }, credential: { token, baseUrl: "https://api.mail.example" } });
  };
  if (optional.saved !== false) save("key-one");
  const answers: { single: MailerSendResult; batch: readonly MailerSendResult[] } = { single: ACCEPTED, batch: [ACCEPTED, ACCEPTED] };
  const provider = fixtureProvider({ keys, sends, result: () => answers.single, batch: () => answers.batch });
  if (optional.keyless) Object.assign(provider, { credentialKeys: [] });
  const clock = { nowMs: () => Date.parse("2026-10-22T10:00:00.000Z") };
  const consoleProvider = createConsoleMailProvider({ clock }, { log: line => logs.push(line) });
  const registry = createMailProviderRegistry({}, { builtins: [provider, consoleProvider] });
  const catalog: MailProviderCatalog = {
    registry, pluginIds: [], refusals: [],
    credentialLabelFor: ({ id }) => id === "api" && !optional.keyless ? LABEL : undefined,
    setupFor: ({ id }) => id === "api" && !optional.keyless ? { fields: [{ key: "token", label: "API key", type: "secret", required: true }] } : { fields: [] },
  };
  const deps: ResolveMailerDeps = {
    workspaceId: WS, mode: optional.mode ?? "production", providerSetting: setting,
    credentials: {
      readFact: async ({ label }) => { effects.push("metadata"); return rows.get(label)?.fact; },
      resolve: async ({ catalog, id }) => {
        effects.push("decrypt");
        const label = catalog.credentialLabelFor({ id });
        return label === undefined ? null : rows.get(label)?.credential ?? null;
      },
    },
    listCredentialFacts: async () => [...rows.values()].map(row => row.fact),
    loadCatalog: async () => catalog,
    httpClient: { send: async () => { throw new Error("the resolver must only pass HTTP through"); } } as HttpClientPort,
    createProviderMailer: ({ provider, credential }) => provider.create({ credential, kit: { httpClient: deps.httpClient } }),
    describeProviders: describe,
    unconfiguredMessage: ({ lane }) => `[mail] no ${lane} mail provider is configured; choose a provider and save its key.`,
    missingCredentialReason: ({ label }) => `has no saved credential "${label}" under Access Tokens (category "ops")`,
    credentialFailureReason: ({ label }) => `the "${label}" credential could not be read`,
  };
  const options: ResolveMailerOptions = { clock, warn: message => warnings.push(message) };
  return { deps, options, setting, rows, save, keys, sends, warnings, logs, effects, provider, catalog, answers,
    create: (overrides: ResolveMailerOptions = {}) => createResolvedMailer(deps, { ...options, ...overrides }) };
}

/** Enable genuine provider contract methods after construction, before resolver boot begins. */
export function domainProvider(required: { provider: MailProviderModule; status?: NonNullable<MailProviderModule["domainStatus"]>; requirements?: NonNullable<MailProviderModule["domainRequirements"]> }): void {
  Object.assign(required.provider, { capabilities: { hosted: true, feedback: false, domainVerification: true } });
  required.provider.domainStatus = required.status ?? (async (_ctx, { domain }) => ({ status: "ok", value: { domain, state: "verified" } }));
  required.provider.domainRequirements = required.requirements ?? (async (_ctx, { domain }) => ({ status: "ok", value: { purpose: "mail", domain, providerId: "api", records: [] } }));
}
