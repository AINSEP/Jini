import { useMemo } from "react";
import { accessTokenCategoryMatches, sortAccessTokenGroups } from "../../access-token-categories.js";
import { accessTokenRowMatchesQuery, accessTokenRowsForProvider } from "../../access-token-rows.js";
import { accessTokenProvidersWithSavedRows, accessTokenRowProviderInfo } from "../../access-token-providers.js";
import type { AccessTokenProviderGroupState } from "./use-access-tokens.hooks.js";
import type { AccessTokenActionContext } from "./access-token-actions.js";
import { addFormKey, existingRowState, addFormState } from "./access-token-state.hooks.js";

export function useAccessTokenGroups({ context }: { context: AccessTokenActionContext }, _optional = {}) {
  const deps = context.args.deps;
  const { ACCESS_TOKEN_PROVIDER_COPY, ACCESS_TOKEN_CATEGORIES } = deps;
  const { providers } = context.queries;
  const { rows } = context;
  const { existingDrafts, existingBusy, addForms, query, category } = context.drafts;
  /** One singleton group per saved custom row — no shared catalog entry to group under (this file's
   *  own header), so each row IS its own group. `addForm` is always the inert blank state: creation
   *  happens through the standalone dialog (`customAddForm` below), never through a per-group
   *  `[+ Add another]` affordance — `AccessTokensTab.tsx`'s `ProviderGroup` skips rendering that
   *  affordance for `kind: "custom"` groups for the identical reason. */
  const customGroups = useMemo<readonly AccessTokenProviderGroupState[]>(() => {
    if (rows === undefined) return [];
    return rows
      .filter((row) => row.kind === "custom" && accessTokenCategoryMatches({ rowCategory: row.category ?? "general", activeCategory: category }) && accessTokenRowMatchesQuery({ row, info: accessTokenRowProviderInfo({ providers, copy: ACCESS_TOKEN_PROVIDER_COPY, row }), query }))
      .map((row) => {
        const info = accessTokenRowProviderInfo({ providers, copy: ACCESS_TOKEN_PROVIDER_COPY, row });
        return { info, rows: [existingRowState({ deps, row, draft: existingDrafts[row.id], busy: existingBusy[row.id], info })], addForm: addFormState({ deps, entry: undefined, info }) };
      });
  }, [rows, existingDrafts, existingBusy, query, category, providers]);

  const groups = useMemo<readonly AccessTokenProviderGroupState[] | undefined>(() => {
    if (rows === undefined) return undefined;
    // A provider outside the active category is dropped here, before the query filter ever runs —
    // see this file's header for why that keeps `totalCount`/`matchCount` a global fact instead.
    // A saved row whose provider is not listed still gets its group, so it can be removed.
    const catalogGroups = accessTokenProvidersWithSavedRows({ providers, copy: ACCESS_TOKEN_PROVIDER_COPY, rows }).filter((info) => accessTokenCategoryMatches({ rowCategory: info.category, activeCategory: category })).map((info) => {
      const providerRows = accessTokenRowsForProvider({ rows, ref: info }).filter((row) => accessTokenRowMatchesQuery({ row, info, query }));
      return {
        info,
        rows: providerRows.map((row) => existingRowState({ deps, row, draft: existingDrafts[row.id], busy: existingBusy[row.id], info })),
        addForm: addFormState({ deps, entry: addForms[addFormKey(info)], info }),
      };
    });
    // Saved-before-unsaved, then category-chip order, then alphabetical by label — the owner's
    // 2026-09-21 ordering ruling (`rules.ts`'s `sortAccessTokenGroups` doc). Applied to the
    // already-category-and-query-filtered list above, so it holds for the "All" chip, any single
    // category chip, and an active search query alike.
    return sortAccessTokenGroups({ groups: [...catalogGroups, ...customGroups], categories: ACCESS_TOKEN_CATEGORIES });
  }, [rows, existingDrafts, existingBusy, addForms, query, category, customGroups, providers]);

  const totalCount = rows?.length ?? 0;
  const matchCount = rows === undefined ? 0 : rows.filter((row) => accessTokenRowMatchesQuery({ row, info: accessTokenRowProviderInfo({ providers, copy: ACCESS_TOKEN_PROVIDER_COPY, row }), query })).length;
  return { groups, totalCount, matchCount };
}
