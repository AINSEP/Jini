import { useMemo, type ForwardedRef, type RefObject } from "react";
import type { AccessTokenRow } from "../access-token-rows.js";
import { customCredentialReadyToSave, isValidHttpUrl } from "../custom-credential-forms.js";
import { accessTokenProviderMatchesQuery } from "../access-token-rows.js";
import { sortAccessTokenGroups, type AccessTokenGroupSortInput, type AccessTokenCategoryInfo } from "../access-token-categories.js";
import type { AccessTokensController, AccessTokenProviderGroupState } from "./hooks/use-access-tokens.hooks.js";
import type { OtherCredentialStoreInfo, OtherCredentialGroupState, OtherCredentialRowState, OtherCredentialsController } from "./hooks/use-other-credentials.hooks.js";

/**
 * @file `AccessTokensTab.tsx`'s two `forwardRef` `<dialog>` sub-components' own state and
 * handlers — `RemoveConfirmDialog`'s close/confirm, and `AddCustomCredentialDialog`'s show/hide
 * toggle, ready-to-save/base-URL validity, and close/save — split out per the
 * `<Name>.tsx`/`<Name>.hooks.tsx` extraction pattern (admin TSX-logic-sweep: deferred 2026-09-03,
 * fixed 2026-09-05). Also home to {@link useMergedSecretsOrder} (2026-09-21 round 2 of the owner's
 * ordering ruling), this page's other non-`.tsx` logic (house rule: no functions in a `.tsx`
 * component body).
 *
 * Each dialog receives its `ref` FROM `forwardRef` (the parent calls `ref.current?.showModal()`
 * imperatively) rather than owning one via its own `useRef` — these hooks take that same forwarded
 * ref as a parameter and cast it the same way the original inline code did
 * (`(ref as RefObject<HTMLDialogElement>).current`), rather than restructuring either dialog into
 * the controlled `open`-prop shape `ConfirmDialog`/`ImagePreviewModal` use elsewhere. That would
 * change this file's public dialog API — a rewrite, not the pure relocation this pass does.
 */

export interface RemoveConfirmDialogActions {
  close: () => void;
  confirm: () => void;
}

/**
 * `RemoveConfirmDialog`'s close/confirm — extracted verbatim, same two calls, same order.
 *
 * @param required - The dialog and controller inputs.
 * @param required.ref - The forwarded ref `RemoveConfirmDialog` receives from its caller.
 * @param required.row - The token row this confirm dialog is for.
 * @param required.controller - `AccessTokensController.removeToken` is the one call this hook makes.
 * @returns `close`/`confirm`, wired directly to the dialog's Cancel/"Remove from the host" buttons.
 * @complexity O(1).
 */
export function useRemoveConfirmDialog(
  { ref, row, controller }: {
    ref: ForwardedRef<HTMLDialogElement>;
    row: AccessTokenRow;
    controller: { removeToken: (row: AccessTokenRow) => Promise<unknown> };
  },
  _optional: Record<string, never> = {},
): RemoveConfirmDialogActions {
  function close(): void {
    (ref as RefObject<HTMLDialogElement>).current?.close();
  }
  function confirm(): void {
    close();
    void controller.removeToken(row);
  }
  return { close, confirm };
}

export interface AddCustomCredentialDialogState {
  readyToSave: boolean;
  baseUrlInvalid: boolean;
  close: () => void;
  save: () => Promise<void>;
}

/**
 * `AddCustomCredentialDialog`'s two save-readiness checks and its close/save handlers. The token
 * field's show/hide lives in the shared `SecretInput`, which re-hides once the form resets.
 *
 * @param ref - The forwarded ref `AddCustomCredentialDialog` receives from its caller.
 * @param controller - Reads `controller.customAddForm`; calls `resetCustomAddForm`/
 *   `createCustomCredential`.
 * @returns `readyToSave`/`baseUrlInvalid` for the form's own validity checks, and `close`/`save`.
 * @complexity O(1).
 */
export function useAddCustomCredentialDialog(
  { ref, controller }: { ref: ForwardedRef<HTMLDialogElement>; controller: { customAddForm: Parameters<typeof customCredentialReadyToSave>[0]; resetCustomAddForm: () => void; createCustomCredential: () => Promise<boolean> } },
  _optional: Record<string, never> = {},
): AddCustomCredentialDialogState {
  const form = controller.customAddForm;
  const readyToSave = customCredentialReadyToSave(form);
  const baseUrlInvalid = form.baseUrl.trim() !== "" && !isValidHttpUrl({ value: form.baseUrl.trim() });

  function close(): void {
    (ref as RefObject<HTMLDialogElement>).current?.close();
    controller.resetCustomAddForm();
  }
  async function save(): Promise<void> {
    const ok = await controller.createCustomCredential();
    if (ok) (ref as RefObject<HTMLDialogElement>).current?.close();
  }

  return { readyToSave, baseUrlInvalid, close, save };
}

/**
 * One sortable unit in {@link useMergedSecretsOrder}'s merged list — a whole Tier-1 provider group
 * (`kind: "provider"`, one heading, possibly several named tokens underneath — `ProviderGroup`'s own
 * shape, unchanged) or one Tier-2 top-level entry (`kind: "other"`, one heading, zero or one row —
 * `OtherCredentialEntry`'s own shape). Both variants also carry `info`/`rows` so the union itself
 * satisfies `rules.ts`'s `AccessTokenGroupSortInput` structurally — {@link sortAccessTokenGroups} reads
 * only those two fields and returns whatever concrete type it was given, so the `kind`/`group`/
 * `store`/`row` fields ride along untouched.
 */
export type MergedSecretsEntry =
  | ({
      readonly kind: "provider";
      readonly key: string;
      readonly group: AccessTokenProviderGroupState;
    } & AccessTokenGroupSortInput)
  | ({
      readonly kind: "other";
      readonly key: string;
      readonly store: OtherCredentialStoreInfo;
      /** `undefined` for the store's own "Not configured" placeholder — mirrors
       *  `OtherCredentialEntry`'s own `row` prop exactly. */
      readonly row: OtherCredentialRowState | undefined;
    } & AccessTokenGroupSortInput);

/** One Tier-2 store's own sortable entries — a store with no configured items explodes into exactly
 *  one placeholder entry (`row: undefined`), a configured multi-item store (e.g. `media-provider`
 *  holding both Cloudinary and xAI Grok) explodes into one entry PER item, each ranked by its own
 *  item name rather than the store's generic label — same explosion `OtherCredentialGroup` used to do
 *  before this pass folded it into the merge step. @complexity O(n) in this store's own item count. */
function otherCredentialGroupEntries(group: OtherCredentialGroupState): MergedSecretsEntry[] {
  if (group.rows.length === 0) {
    return [
      {
        kind: "other",
        key: `${group.store.id}:none`,
        store: group.store,
        row: undefined,
        info: { category: group.store.category, label: group.store.label },
        rows: [],
      },
    ];
  }
  return group.rows.map((row) => ({
    kind: "other",
    key: `${group.store.id}:${row.itemId}`,
    store: group.store,
    row,
    info: { category: group.store.category, label: row.name },
    rows: [row],
  }));
}

/**
 * The Secrets page's ONE merged row order — owner's 2026-09-21 round-2 ruling: every row kind on the
 * page (a Tier-1 catalog/custom provider group, a Tier-2 configured item, a Tier-2 "Not configured"
 * placeholder) sorted together through the SAME {@link sortAccessTokenGroups} rule round 1 already
 * certified (saved-before-unsaved, then category-chip order, then alphabetical by label), instead of
 * round 1's "Tier 1 sorted, Tier 2 always appended after all of it" shape — both tiers must share one ordering.
 *
 * Visibility is resolved HERE, once, for both tiers — folding in what `MaybeProviderGroup`/
 * `MaybeOtherCredentialGroup` used to check independently (a group's own info matching the query, OR
 * it already has at least one query-matched row) — so a caller gets back exactly the entries that
 * should render, already in final order, with no separate visibility pass needed downstream.
 *
 * `query` is taken as an explicit parameter (rather than read off `controller.query` internally) so
 * this hook's own dependency array stays honest about what it actually reads — `AccessTokensTab.tsx`
 * passes `controller.query` at the call site, the same single search box both tiers already share.
 *
 * @complexity Time O(n log n) in the combined provider-group-plus-other-item count (small — same
 * bound {@link sortAccessTokenGroups} itself documents), space O(n) for the built entry list.
 */
export function useMergedSecretsOrder(
  { controller, otherController, query, deps }: {
    controller: Pick<AccessTokensController, "groups">;
    otherController: Pick<OtherCredentialsController, "groups">;
    query: string;
    deps: { ACCESS_TOKEN_CATEGORIES: readonly AccessTokenCategoryInfo[]; otherCredentialMatchesQuery: (required: { store: OtherCredentialStoreInfo; itemName: string | undefined; query: string }) => boolean };
  },
  _optional: Record<string, never> = {},
): readonly MergedSecretsEntry[] {
  const { ACCESS_TOKEN_CATEGORIES, otherCredentialMatchesQuery } = deps;
  const providerGroups = controller.groups;
  const otherGroups = otherController.groups;
  return useMemo(() => {
    const visibleProviders = (providerGroups ?? []).filter(
      (group) => accessTokenProviderMatchesQuery({ info: group.info, query }) || group.rows.length > 0
    );
    const visibleOther = (otherGroups ?? []).filter(
      (group) => otherCredentialMatchesQuery({ store: group.store, itemName: undefined, query }) || group.rows.length > 0
    );
    const providerEntries: MergedSecretsEntry[] = visibleProviders.map((group) => ({
      kind: "provider",
      key: `${group.info.kind}:${group.info.providerId}`,
      group,
      info: { category: group.info.category, label: group.info.label },
      rows: group.rows,
    }));
    const otherEntries: MergedSecretsEntry[] = visibleOther.flatMap(otherCredentialGroupEntries);
    return sortAccessTokenGroups({ groups: [...providerEntries, ...otherEntries], categories: ACCESS_TOKEN_CATEGORIES });
  }, [providerGroups, otherGroups, query]);
}
