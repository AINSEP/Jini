import { type Translate } from '@jini-ai/core/text';
import type { AdminCustomCredentialCategoryId as AccessTokenRowCategoryId } from "@jini-ai/core/contracts/site/api-security-api-types";
/** A stable id for one of the four Tier-2 credential stores — `AccessTokenRow.id`'s counterpart for
 *  the stores this page reads through a completely different set of endpoints (see
 *  `@jini-ai/admin/security/host/hooks/other-credentials-port.hooks`). This id names the ROW this page renders, not the table. */
export type OtherCredentialStoreId = "site-assistant" | "admin-byok" | "media-provider" | "external-mcp";

/**
 * One Tier-2 credential store — single connection per scope, or per-provider/per-server, but never
 * *named* the way Tier 1 is (no operator-typed label, so no Name field and no `[+ Add]` — see
 * `Security.tsx`'s own header for why Create stays on each store's OWN screen). Read + Replace +
 * Remove + a deep link is the 2026-08-16 owner ruling for every row this produces
 * (`ACCESS-TOKENS-VISUAL-SPEC.md`'s "OWNER RULING" section) — `supportsReplace` narrows that for the
 * one store where "replace" has no honest single-field meaning:
 *
 * - `external-mcp`: a multi-field server config (transport, command, args, allowed tools), not a
 *   single token — a real "Replace" would have to reproduce that whole form, which is exactly the
 *   second-entry-point risk the session-6 handoff warns against for a cross-cutting page. Remove
 *   (`deleteExternalMcpServer`) still applies; editing the rest stays on Settings → External MCP.
 *
 * The other three (`site-assistant`, `admin-byok`, `media-provider`) are all a
 * single `apiKey` field end to end — `supportsReplace: true`, wired through the same
 * retype-and-save shape Tier 1's own Replace already uses.
 */
export interface OtherCredentialStoreInfo {
  readonly id: OtherCredentialStoreId;
  /** The store's own generic label — shown as a row's heading only when the store has nothing
   *  configured yet (a "— none —" placeholder needs SOME name to search on); a configured row is
   *  headed by its OWN item name instead (a media provider's catalog label, an MCP server's own
   *  label) — see `use-other-credentials.hooks.ts` for where that split happens. */
  readonly label: string;
  /** The category-filter bucket this store's rows land in — see {@link ACCESS_TOKEN_CATEGORIES}. */
  readonly category: AccessTokenRowCategoryId;
  /** Shown next to a row's name the same way Tier 1's `purposeLabel` is (`" · {purposeLabel}"`) — the
   *  human-readable form of {@link category}, e.g. "Media", "AI", "Ops". */
  readonly purposeLabel: string;
  readonly supportsReplace: boolean;
  /** Deep-link text, e.g. "Manage on AI Assistant". */
  readonly screenLabel: string;
  /** In-app route for the deep link (`lib/router.ts`'s route-path shape, e.g. `/ai-assistant`) —
   *  always this store's OWN screen, since Create/the full field set lives there and nowhere else. */
  readonly screenPath: string;
}

/** Looks up one store's registry entry, falling back to the first — same "the row list can never
 *  render something absent from its own table" guarantee {@link accessTokenProviderInfo} gives Tier 1.
 *  @complexity O(1) — the array has exactly four entries. */
export function otherCredentialStoreInfo({ id, stores }: { id: OtherCredentialStoreId; stores: readonly OtherCredentialStoreInfo[] }, _optional: Record<string, never> = {}): OtherCredentialStoreInfo {
  return stores.find((store) => store.id === id) ?? stores[0]!;
}

/** Whether a Tier-2 store (or, for a multi-item store, one of its own item names) matches an active
 *  search `query` — mirrors {@link accessTokenProviderMatchesQuery} exactly: the store's generic
 *  label, its purpose subtitle, or (when given) the specific configured item's own name.
 *  @complexity O(1). */
export function otherCredentialMatchesQuery(
  { store, itemName, query }: {
    store: OtherCredentialStoreInfo;
    itemName: string | undefined;
    query: string;
  },
  _options = {},
): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  if (store.label.toLowerCase().includes(q) || store.purposeLabel.toLowerCase().includes(q)) return true;
  return itemName !== undefined && itemName.toLowerCase().includes(q);
}

/** A media provider's human catalog label (e.g. `"grok"` → `"xAI Grok Imagine"`) — same
 *  `MEDIA_PROVIDER_CATALOG` lookup `Media.tsx` itself uses, so a media-provider row on this page
 *  reads with the identical name an operator already sees on the Media → External Providers tab. Falls
 *  back to the raw provider id for one this workspace has a stored key under but the catalog no
 *  longer lists (a removed vendor) — a stale id is still a fact worth showing, not a reason to hide
 *  the row. @complexity O(n) in the catalog's own (small, fixed) size. */
export function mediaProviderLabel({ providerId, catalog }: { providerId: string; catalog: readonly MediaProviderCatalogEntry[] }, _options = {}): string {
  // The LIVE catalog, not the static one: providers such as grok are contributed at runtime by plugins.
  return catalog.find((provider) => provider.id === providerId)?.label ?? providerId;
}

/** One live-catalog card as far as a label lookup needs it. */
export interface MediaProviderCatalogEntry { readonly id: string; readonly label: string }

/** The cards of a `GET …/media/providers/catalog` body whose id and label are strings; anything else
 *  (or an unreadable body) yields `[]`, so rows fall back to raw ids. @complexity O(p). */
export function mediaProviderCatalogFrom({ body }: { body: { providers?: unknown } | null | undefined }, _options = {}): readonly MediaProviderCatalogEntry[] {
  const providers: unknown = body?.providers;
  if (!Array.isArray(providers)) return [];
  return providers.filter((card): card is MediaProviderCatalogEntry => typeof card?.id === "string" && typeof card?.label === "string");
}

/** The masked-tail value fact for a configured single-`apiKey` row (`site-assistant`/`admin-byok`/
 *  `media-provider` — the three stores whose GET response carries a precomputed last-4, per the
 *  visual spec §10: "that's ALL they ever return"). `tail` is already the last 4 characters with no
 *  leading `••••` — those API shapes agree on the bare-tail contract, so this is the one place
 *  that prefix gets added. @complexity O(1). */
export function maskedTailFact({ tail }: { tail: string }, _options = {}): string {
  return `••••${tail}`;
}

/** The value fact for an `external-mcp` row — there is no single token to characterize (§10: "no
 *  per-field tail"), so this reports how many environment variable NAMES are set instead (`envNames`,
 *  already plaintext — see `AdminExternalMcpServer.envNames`'s own doc in `lib/api.ts`). Zero reads as
 *  a fact, not an error: an MCP server can be fully configured with no secrets at all (a local stdio
 *  tool needing no credentials). @complexity O(1). */
export function envNamesFact({ envNames }: { envNames: readonly string[] }, { t = (key) => key }: { t?: Translate } = {}): string {
  if (envNames.length === 0) return t("No environment variables set");
  if (envNames.length === 1) return t("1 environment variable set");
  return t("{count} environment variables set").replace("{count}", String(envNames.length));
}

/** `AccessTokensSearch`'s own count line (the search box's `role="status"` caption) — whole-sentence
 *  templates keyed by the plural of `totalCount`, not string-fragment concatenation. Gluing
 *  translated words in English order (`"${count} ${tokenWord} ${translate("saved")}"`) can't read
 *  naturally in a language that puts the verb, the count, or the quoted query somewhere else in the
 *  sentence (ja/ko/zh/th all reorder this), so each plural form is one full translated sentence
 *  instead. The plural is chosen by `totalCount` alone (never `matchCount`) — see this file's own
 *  callers for why the visible noun stays anchored to the total, not the filtered subset. `query` is
 *  interpolated raw (not trimmed) to match the box's own display of what was typed.
 *  @complexity O(1). */
export function accessTokensCountText(
  { totalCount, matchCount, query }: {
    totalCount: number;
    matchCount: number;
    query: string;
  },
  { t = (key) => key }: { t?: Translate } = {},
): string {
  if (query.trim() === "") {
    return t(totalCount === 1 ? "{count} token saved" : "{count} tokens saved").replace("{count}", String(totalCount));
  }
  return t(totalCount === 1 ? "{matched} of {count} token matching “{query}”" : "{matched} of {count} tokens matching “{query}”")
    .replace("{matched}", String(matchCount))
    .replace("{count}", String(totalCount))
    .replace("{query}", () => query);
}
