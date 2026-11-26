import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { CredentialTokenHint } from "@jini-ai/core/contracts/site/secrets-credential-token";
import type { AdminExternalMcpServer } from "@jini-ai/core/contracts/site/cms-external-mcp";
import type { Translate } from "@jini-ai/core/text";
import { accessTokenCategoryMatches, type AccessTokenCategoryId } from "../../access-token-categories.js";
import type { OtherCredentialsPort } from "./other-credentials-port.hooks.js";
import * as operations from "./other-credential-store-operations.js";
import type { RawStoreItem, StoreState } from "./other-credential-store-operations.js";

/**
 * @file The Security page's Tier-2 controller — reads all four single-row/per-item credential stores
 * (`rules.ts`'s `OTHER_CREDENTIAL_STORES`) and exposes Replace/Remove for the three that support it
 * (`store.supportsReplace` — see that constant's own doc for why `external-mcp` doesn't). Sibling to `use-access-tokens.hooks.ts` (Tier 1), not a merge with it: the two tiers read
 * from completely different endpoints with completely different wire shapes, and `AccessTokensTab.tsx`
 * is the one place that renders both controllers' `groups` as one visual list — see that file's
 * header for the 2026-08-16 owner ruling this split answers to.
 *
 * ## One `Promise.allSettled` fan-out, not six `useFetchQuery` mounts
 *
 * Every other hook in this app that reads more than one endpoint (`useAccessTokens` itself, two
 * stores) repeats `useFetchQuery` + a one-time `seededRef` per endpoint. Six stores would mean six
 * near-identical copies of that same eight-line shape for no behavioral difference — none of these
 * reads depend on each other, so there is nothing sequencing would buy. This hook fires all six GETs
 * together in one effect and settles them into one `StoreState` map instead; a single store's own
 * failure is captured on ITS OWN entry (`error`) rather than failing every store's read, which one
 * shared `useFetchQuery` call could not have done without inventing its own multi-key error shape.
 *
 * ## `query`/`category` are OWNED by `useAccessTokens`, not this hook
 *
 * The search box and category filter are one control each across both tiers (`AccessTokensTab.tsx`'s
 * own single list) — duplicating that state here would let Tier 1 and Tier 2 drift out of sync the
 * moment a caller forgot to keep two `query` values equal. This hook takes `filter` as a parameter
 * instead of owning `useState` for either value, the same "controlled from outside" shape a plain
 * `<input value onChange>` uses.
 */

export interface OtherCredentialStoreInfo {
  readonly id: "site-assistant" | "admin-byok" | "media-provider" | "external-mcp";
  readonly label: string; readonly category: Exclude<AccessTokenCategoryId, "all">; readonly purposeLabel: string;
  readonly supportsReplace: boolean; readonly screenLabel: string; readonly screenPath: string;
}

export interface OtherCredentialRowState {
  /** `${storeId}:${itemId}` — stable across re-renders, and unique even though `media-provider`/
   *  `external-mcp` can each hold more than one item. */
  readonly key: string;
  readonly store: OtherCredentialStoreInfo;
  /** The specific item within a multi-item store (a provider id or server id) — equal
   *  to `store.id` itself for the three single-scope stores, which only ever have one possible item. */
  readonly itemId: string;
  /** This row's own display name — the store's generic label for a single-scope store, or the
   *  item's own name (a media provider's catalog label, an MCP server's own label) for a multi-item one. */
  readonly name: string;
  /** What `§10`'s "never a reveal control" ceiling actually allows showing — a masked tail or an
   *  environment-variable-name count. See `rules.ts`'s `maskedTailFact`/`envNamesFact`. */
  readonly valueFact: string;
  readonly updatedAt: string | null;
  readonly token: string;
  readonly saving: boolean;
  readonly error: string | null;
}

export interface OtherCredentialGroupState {
  readonly store: OtherCredentialStoreInfo;
  /** Already filtered against the active search query — mirrors
   *  `AccessTokenProviderGroupState.rows`'s exact contract in `use-access-tokens.hooks.ts`. */
  readonly rows: readonly OtherCredentialRowState[];
}

export interface OtherCredentialsController {
  /** One entry per {@link OTHER_CREDENTIAL_STORES} store whose category matches the active filter, in
   *  that fixed order — `undefined` until every store's first read has settled (success OR failure). */
  groups: readonly OtherCredentialGroupState[] | undefined;
  loadError: string | null;
  /** Configured items across all six stores, regardless of query or category — pairs with
   *  `AccessTokensController.totalCount` so `AccessTokensTab.tsx` can report one combined count. */
  totalCount: number;
  /** Configured items across all six stores that match the active search query, regardless of
   *  category — pairs with `AccessTokensController.matchCount` the same way. */
  matchCount: number;

  setDraftToken: (required: { key: string; value: string }, optional?: Record<string, never>) => void;
  replace: (row: OtherCredentialRowState) => Promise<void>;
  remove: (row: OtherCredentialRowState) => Promise<void>;

  t: Translate;
}

  // Initial reads and copy refreshes share the existing readers and write lane. A late initial
  // read cannot replace the inventory reloaded after copy; this fixed store set is one fan-out.

export function useOtherCredentials({ port, t, locale, filter, hooks, deps }: {
  port: OtherCredentialsPort; t: Translate; locale: string; filter: { query: string; category: AccessTokenCategoryId };
  hooks: {
    useSerialWrites: () => { run: <T>(required: { task: () => Promise<T> }, optional?: { key?: string }) => Promise<T> };
    useContentRefreshSubscription: (required: { resource: string; onRefresh: () => void }) => void;
  };
  deps: {
    stores: readonly OtherCredentialStoreInfo[]; resource: string;
    formatCredentialHint: (required: { hint: CredentialTokenHint | null | undefined; locale: string }) => string;
    formatCredentialHints: (required: { hints: AdminExternalMcpServer["envTokenHints"]; locale: string }) => string;
    translateCredentialMessage: (required: { message: string; locale: string }) => string;
    credentialDraftError: (required: { value: string }, optional: { locale: string }) => string | null;
    envNamesFact: (required: { envNames: readonly string[] }, optional: { t: Translate }) => string;
    maskedTailFact: (required: { tail: string }) => string;
    mediaProviderCatalogFrom: (required: { body: { providers?: unknown } | null | undefined }) => readonly { id: string; label: string }[];
    mediaProviderLabel: (required: { providerId: string; catalog: readonly { id: string; label: string }[] }) => string;
    otherCredentialMatchesQuery: (required: { store: OtherCredentialStoreInfo; itemName: string | undefined; query: string }) => boolean;
    describeApiError: (required: { e: unknown; fallback: string }) => string;
    accessTokensLoadErrorMessage: (required: { locale: string; error: string }) => string;
    accessTokenSaveErrorMessage: (required: { locale: string; error: string }) => string;
  };
}, _optional = {}): OtherCredentialsController {
  const [storeStates, setStoreStates] = useState<Record<string, StoreState>>(() =>
    Object.fromEntries(deps.stores.map((store) => [store.id, operations.idleStoreState()]))
  );
  const [drafts, setDrafts] = useState<Record<string, { token: string; saving: boolean; error: string | null }>>({});

  const writes = hooks.useSerialWrites();
  const reloadStores = useCallback(() => {
    void writes.run({ task: () => Promise.all(deps.stores.map(store =>
      operations.refetchOneOrRecordFailure({ port, store, setStoreStates, t, locale, deps })
    )) });
  }, [writes, port, t, locale]);
  const fetchedRef = useRef(false);
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    reloadStores();
  }, [reloadStores]);
  hooks.useContentRefreshSubscription({ resource: deps.resource, onRefresh: reloadStores });

  const allSettled = deps.stores.every((store) => storeStates[store.id]?.items !== undefined);
  const firstLoadError = deps.stores.map((store) => storeStates[store.id]?.loadError).find((error) => error) ?? null;

  const groups: readonly OtherCredentialGroupState[] | undefined = allSettled
    ? deps.stores.filter((store) => accessTokenCategoryMatches({ rowCategory: store.category, activeCategory: filter.category })).map((store) => {
        // `allSettled` above already proved every store's `items` is defined.
        const items = storeStates[store.id]?.items;
        if (!items) throw new Error(`credential store ${store.id} has no loaded items`);
        return buildGroup({ store, items, drafts, query: filter.query, deps });
      })
    : undefined;

  const totalCount = deps.stores.reduce((sum, store) => sum + (storeStates[store.id]?.items?.length ?? 0), 0);
  const matchCount = deps.stores.reduce((sum, store) => {
    const items = storeStates[store.id]?.items ?? [];
    return sum + items.filter((item) => deps.otherCredentialMatchesQuery({ store, itemName: item.name, query: filter.query })).length;
  }, 0);

  return { groups, loadError: firstLoadError, totalCount, matchCount,
    setDraftToken: input => setDraftToken({ ...input, setDrafts, locale, deps }),
    replace: row => writes.run({ task: () => replaceNow({ row, drafts, setDrafts, port, setStoreStates, t, locale, deps }) }),
    remove: row => writes.run({ task: () => removeNow({ row, setDrafts, port, setStoreStates, t, locale, deps }) }), t };
}

  // One lane for every Tier-2 write from this controller. Media writes now name exactly one provider
  // (PATCH/DELETE on its own row), so they no longer rebuild a shared map; the lane still keeps one
  // write and its refetch settled before the next starts, so the rows shown never interleave two
  // in-flight writes' results. Cross-session conflicts are the server's per-row writes' concern.

  function setDraftToken({ key, value, setDrafts, locale, deps }: { key: string; value: string; setDrafts: Dispatch<SetStateAction<Record<string, { token: string; saving: boolean; error: string | null }>>>; locale: string; deps: Parameters<typeof useOtherCredentials>[0]["deps"] }, _optional: Record<string, never> = {}): void {
    setDrafts((prev) => ({ ...prev, [key]: { token: value, saving: prev[key]?.saving ?? false, error: deps.credentialDraftError({ value }, { locale }) } }));
  }

  async function replaceNow({ row, drafts, setDrafts, port, setStoreStates, t, locale, deps }: Pick<Parameters<typeof useOtherCredentials>[0], "port" | "t" | "locale" | "deps"> & {
    row: OtherCredentialRowState;
    setDrafts: Dispatch<SetStateAction<Record<string, { token: string; saving: boolean; error: string | null }>>>;
    setStoreStates: Dispatch<SetStateAction<Record<string, operations.StoreState>>>;
  } & { drafts: Record<string, { token: string; saving: boolean; error: string | null }> }, _optional = {}): Promise<void> {
    const draft = drafts[row.key];
    const token = draft?.token ?? "";
    if (token === "" || !row.store.supportsReplace) return;
    const error = deps.credentialDraftError({ value: token }, { locale });
    if (error) { setDrafts(prev => ({ ...prev, [row.key]: { token, saving: false, error } })); return; }
    setDrafts((prev) => ({ ...prev, [row.key]: { token, saving: true, error: null } }));
    try {
      await operations.writeReplace({ port, storeId: row.store.id, itemId: row.itemId, apiKey: token });
      await operations.refetchOne({ port, store: row.store, setStoreStates, t, locale, deps });
      setDrafts((prev) => ({ ...prev, [row.key]: { token: "", saving: false, error: null } }));
    } catch (err) {
      setDrafts((prev) => ({ ...prev, [row.key]: { token, saving: false, error: operations.otherCredentialSaveErrorMessage({ err, t, locale, deps }) } }));
    }
  }

  async function removeNow({ row, setDrafts, port, setStoreStates, t, locale, deps }: Pick<Parameters<typeof useOtherCredentials>[0], "port" | "t" | "locale" | "deps"> & {
    row: OtherCredentialRowState;
    setDrafts: Dispatch<SetStateAction<Record<string, { token: string; saving: boolean; error: string | null }>>>;
    setStoreStates: Dispatch<SetStateAction<Record<string, operations.StoreState>>>;
  }, _optional = {}): Promise<void> {
    try {
      await operations.writeRemove({ port, storeId: row.store.id, itemId: row.itemId });
      await operations.refetchOne({ port, store: row.store, setStoreStates, t, locale, deps });
    } catch (err) {
      setDrafts((prev) => ({ ...prev, [row.key]: { token: prev[row.key]?.token ?? "", saving: false, error: operations.otherCredentialSaveErrorMessage({ err, t, locale, deps }) } }));
    }
  }

/** Builds one store's group — filters its raw items by the active search query, same
 *  `otherCredentialMatchesQuery` contract `AccessTokensTab.tsx`'s own visibility check applies to the
 *  (possibly still-empty) result. Pulled out of {@link useOtherCredentials} purely for the complexity
 *  gate. @complexity O(n) in this store's own (small) item count. */
function buildGroup(
  { store, items, drafts, query, deps }: {
    deps: Parameters<typeof useOtherCredentials>[0]["deps"];
    store: OtherCredentialStoreInfo;
    items: readonly RawStoreItem[];
    drafts: Record<string, { token: string; saving: boolean; error: string | null }>;
    query: string;
  },
  _optional: Record<string, never> = {},
): OtherCredentialGroupState {
  const rows = items
    .filter((item) => deps.otherCredentialMatchesQuery({ store, itemName: item.name, query }))
    .map((item): OtherCredentialRowState => {
      const key = `${store.id}:${item.itemId}`;
      const draft = drafts[key];
      return {
        key,
        store,
        itemId: item.itemId,
        name: item.name,
        valueFact: item.valueFact,
        updatedAt: item.updatedAt,
        token: draft?.token ?? "",
        saving: draft?.saving ?? false,
        error: draft?.error ?? null,
      };
    });
  return { store, rows };
}

export function bindOtherCredentials({ hooks, deps }: {
  hooks: Parameters<typeof useOtherCredentials>[0]["hooks"] & { useLocaleHook: () => string };
  deps: Parameters<typeof useOtherCredentials>[0]["deps"] & {
    port: OtherCredentialsPort; translate: (required: { locale: string; key: string }) => string;
  };
}, _optional = {}) {
  return function useBoundOtherCredentials(filter: Parameters<typeof useOtherCredentials>[0]["filter"], _optional = {}): OtherCredentialsController {
    const locale = hooks.useLocaleHook();
    const t = (key: string): string => deps.translate({ locale: locale, key: key });
    return useOtherCredentials({ port: deps.port, t, locale, filter, hooks, deps });
  };
}
