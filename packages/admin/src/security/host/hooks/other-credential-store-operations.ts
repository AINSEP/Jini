import type { AdminMediaProviderMap } from "../../../screens/media/api/media-api.js";
import type { Translate } from "@jini-ai/core/text";
import type { OtherCredentialsPort } from "./other-credentials-port.hooks.js";
import type { OtherCredentialStoreInfo, useOtherCredentials } from "./use-other-credentials.hooks.js";

/** One store's raw read result — `items` is `undefined` until this SPECIFIC store's read settles
 *  (independent of every other store's), so a slow media-provider call never blocks a fast BYOK one from
 *  rendering. `loadError` is this store's own failure, kept apart from every other store's so one
 *  down store never hides the rest. */
export interface RawStoreItem {
  readonly itemId: string;
  readonly name: string;
  readonly valueFact: string;
  readonly updatedAt: string | null;
}
export interface StoreState {
  readonly items: readonly RawStoreItem[] | undefined;
  readonly loadError: string | null;
}
export function idleStoreState(): StoreState {
  return { items: undefined, loadError: null };
}

/** Reads one single-`apiKey` store's current value into its (0 or 1) row — `site-assistant`/
 *  `admin-byok` share this exact "isSet, plus a server hint" shape; only the two GET calls' own field
 *  names differ, which the two small readers below normalize before this shared mapper ever runs. @complexity O(1). */
function singleKeyItems(
  { store, isSet, valueFact, updatedAt }: {
    store: OtherCredentialStoreInfo;
    isSet: boolean;
    valueFact: string;
    updatedAt: string | null;
  },
  _optional: Record<string, never> = {},
): RawStoreItem[] {
  if (!isSet) return [];
  return [{ itemId: store.id, name: store.label, valueFact, updatedAt }];
}

async function readSiteAssistant({ port, store, locale, deps }: { port: OtherCredentialsPort; store: OtherCredentialStoreInfo; locale: string; deps: Parameters<typeof useOtherCredentials>[0]["deps"] }, _optional: Record<string, never> = {}): Promise<RawStoreItem[]> {
  const { data } = await port.getSiteAssistantCredential();
  return singleKeyItems({ store, isSet: data.isSet, valueFact: deps.formatCredentialHint({ hint: data.tokenHint, locale }) || deps.maskedTailFact({ tail: data.masked?.replace(/^••••/, "") ?? "" }), updatedAt: data.updatedAt });
}
async function readAdminByok({ port, store, locale, deps }: { port: OtherCredentialsPort; store: OtherCredentialStoreInfo; locale: string; deps: Parameters<typeof useOtherCredentials>[0]["deps"] }, _optional: Record<string, never> = {}): Promise<RawStoreItem[]> {
  const { data } = await port.getAdminByokCredential();
  return singleKeyItems({ store, isSet: data.isSet, valueFact: deps.formatCredentialHint({ hint: data.tokenHint, locale }) || deps.maskedTailFact({ tail: data.masked?.replace(/^••••/, "") ?? "" }), updatedAt: data.updatedAt });
}
/** Every configured media-provider key — one row per provider whose `apiKeyConfigured` is true, not
 *  one row for the whole store (the owner's own mock names a SPECIFIC provider, "Cloudinary (media)",
 *  as its own row — see `rules.ts`'s `OtherCredentialStoreInfo.label` doc for the placeholder-vs-item
 *  heading split this produces). @complexity O(p) in this workspace's own (small) configured-provider
 *  count. */
async function readMediaProviders({ port, deps }: { port: OtherCredentialsPort; deps: Parameters<typeof useOtherCredentials>[0]["deps"] }, { locale = 'en' }: { locale?: string } = {}): Promise<RawStoreItem[]> {
  // A catalog that cannot be read only costs the human labels (rows fall back to raw ids); it must
  // never hide a stored credential, so its failure is not the store's failure.
  const [map, catalogBody]: [AdminMediaProviderMap, { providers?: unknown } | null | undefined] = await Promise.all([
    port.getMediaProviders(), port.getMediaProviderCatalog().catch(() => null),
  ]);
  const catalog = deps.mediaProviderCatalogFrom({ body: catalogBody });
  return Object.entries(map)
    .filter(([, credentials]) => credentials.apiKeyConfigured)
    .map(([providerId, credentials]) => ({
      itemId: providerId,
      name: deps.mediaProviderLabel({ providerId, catalog }),
      valueFact: deps.formatCredentialHint({ hint: credentials.apiKeyHint, locale }) || deps.maskedTailFact({ tail: credentials.apiKeyTail ?? "" }),
      updatedAt: null,
    }));
}
/** Every configured external MCP server — @complexity O(s) in this workspace's own (small) server
 *  count. */
async function readExternalMcpServers({ port, t, deps }: { port: OtherCredentialsPort; t: Translate; deps: Parameters<typeof useOtherCredentials>[0]["deps"] }, { locale = 'en' }: { locale?: string } = {}): Promise<RawStoreItem[]> {
  const { servers } = await port.listExternalMcpServers();
  return servers.filter(server => !server.builtIn).map((server) => ({
    itemId: server.serverId,
    name: server.label || server.serverId,
    valueFact: deps.formatCredentialHint({ hint: server.accessTokenHint, locale }) || deps.formatCredentialHints({ hints: server.envTokenHints, locale }) || deps.envNamesFact({ envNames: server.envNames }, { t }),
    updatedAt: null,
  }));
}

/** Dispatches one store's read by id — the one place `OtherCredentialStoreId` is switched over for
 *  reads, mirroring `rules.ts`'s `buildAccessTokenConnectionInput` dispatch-by-kind pattern.
 *  @complexity O(1) plus whichever reader's own complexity. */
type StoreReader = (required: { port: OtherCredentialsPort; store: OtherCredentialStoreInfo; t: Translate; locale: string; deps: Parameters<typeof useOtherCredentials>[0]["deps"] }, optional?: Record<string, never>) => Promise<RawStoreItem[]>;

const STORE_READERS: Record<OtherCredentialStoreInfo["id"], StoreReader> = {
  "site-assistant": ({ port, store, locale, deps }, _optional = {}) => readSiteAssistant({ port, store, locale, deps }),
  "admin-byok": ({ port, store, locale, deps }, _optional = {}) => readAdminByok({ port, store, locale, deps }),
  "media-provider": ({ port, locale, deps }, _optional = {}) => readMediaProviders({ port, deps }, { locale }),
  "external-mcp": ({ port, t, locale, deps }, _optional = {}) => readExternalMcpServers({ port, t, deps }, { locale }),
};

function readStore({ port, store, t, deps }: { port: OtherCredentialsPort; store: OtherCredentialStoreInfo; t: Translate; deps: Parameters<typeof useOtherCredentials>[0]["deps"] }, { locale = 'en' }: { locale?: string } = {}): Promise<RawStoreItem[]> {
  return STORE_READERS[store.id]({ port, store, t, locale, deps });
}

/** Translates a rejected Tier-2 write into the same save-error string Tier 1 uses — no
 *  duplicate-label case here (nothing on this tier is named), so this is the plain
 *  `describeApiError`-wrapped base case only. @complexity O(1). */
export function otherCredentialSaveErrorMessage({ err, t, locale, deps }: { err: unknown; t: Translate; locale: string; deps: Parameters<typeof useOtherCredentials>[0]["deps"] }, _optional: Record<string, never> = {}): string {
  return deps.accessTokenSaveErrorMessage({ locale, error: deps.translateCredentialMessage({ message: deps.describeApiError({ e: err, fallback: t("unknown error") }), locale }) });
}

/** Re-reads one store after a successful write — Tier 2 has the same "a write can change more than
 *  the one field the form touched" reasoning `use-access-tokens.hooks.ts`'s own `removeToken`/
 *  `makeDefault` document for Tier 1, and every write here is already a full round trip (there is no
 *  optimistic splice to do instead — the media-provider list, for instance, can hold providers another
 *  window saved since this page loaded, which only the server's answer shows).
 *  @complexity O(1) plus whichever reader's own complexity. */
export async function refetchOne(
  { port, store, setStoreStates, t, locale, deps }: {
    deps: Parameters<typeof useOtherCredentials>[0]["deps"];
    port: OtherCredentialsPort;
    store: OtherCredentialStoreInfo;
    setStoreStates: (updater: (prev: Record<string, StoreState>) => Record<string, StoreState>) => void;
    t: Translate;
    locale: string;
  },
  _optional: Record<string, never> = {},
): Promise<void> {
  const items = await readStore({ port, store, t, deps }, { locale });
  setStoreStates((prev) => ({ ...prev, [store.id]: { items, loadError: null } }));
}

/** {@link refetchOne}, recording a failed read as that store's load error instead of rejecting. */
export async function refetchOneOrRecordFailure(
  { port, store, setStoreStates, t, locale, deps }: {
    deps: Parameters<typeof useOtherCredentials>[0]["deps"];
    port: OtherCredentialsPort;
    store: OtherCredentialStoreInfo;
    setStoreStates: (updater: (prev: Record<string, StoreState>) => Record<string, StoreState>) => void;
    t: Translate;
    locale: string;
  },
  _optional: Record<string, never> = {},
): Promise<void> {
  try {
    await refetchOne({ port, store, setStoreStates, t, locale, deps });
  } catch (err: unknown) {
    const loadError = deps.accessTokensLoadErrorMessage({ locale, error: deps.translateCredentialMessage({ message: deps.describeApiError({ e: err, fallback: t("unknown error") }), locale }) });
    setStoreStates((prev) => ({ ...prev, [store.id]: { items: [], loadError } }));
  }
}

/** Dispatches one store's Replace write — the one place `OtherCredentialStoreId` is switched over
 *  for writes. Every supported store is a direct single-item write: `media-provider` patches ONLY the
 *  named provider with ONLY the typed key, never a map rebuilt from this page's snapshot — that would
 *  re-send every other provider as it was at load (undoing a newer save from another window) and the
 *  server merges the target's own `baseUrl`/`model` against its CURRENT row, so echoing them from a
 *  stale view could only overwrite something newer. `external-mcp` never reaches here (`replace`
 *  checks `supportsReplace` first). @complexity O(1). */
export async function writeReplace(
  { port, storeId, itemId, apiKey }: {
    port: OtherCredentialsPort;
    storeId: OtherCredentialStoreInfo["id"];
    itemId: string;
    apiKey: string;
  },
  _optional: Record<string, never> = {},
): Promise<void> {
  if (storeId === "site-assistant") {
    await port.setSiteAssistantCredential({ apiKey });
    return;
  }
  if (storeId === "admin-byok") {
    await port.setAdminByokCredential({ apiKey });
    return;
  }
  if (storeId === "media-provider") {
    await port.patchMediaProvider({ providerId: itemId, fields: { apiKey } });
  }
}

/** Dispatches one store's Remove write — mirrors {@link writeReplace}'s dispatch, but every store
 *  here DOES support Remove (unlike Replace, §8/the owner ruling never narrows Remove to a subset).
 *  `media-provider` deletes exactly the named provider: deletion is never inferred from a provider
 *  missing in a map, which is how the old whole-map write deleted keys saved in another window.
 *  @complexity O(1). */
export async function writeRemove(
  { port, storeId, itemId }: {
    port: OtherCredentialsPort;
    storeId: OtherCredentialStoreInfo["id"];
    itemId: string;
  },
  _optional: Record<string, never> = {},
): Promise<void> {
  if (storeId === "site-assistant") {
    await port.deleteSiteAssistantCredential();
    return;
  }
  if (storeId === "admin-byok") {
    await port.deleteAdminByokCredential();
    return;
  }
  if (storeId === "media-provider") {
    await port.removeMediaProvider({ providerId: itemId });
    return;
  }
  await port.deleteExternalMcpServer({ serverId: itemId });
}

