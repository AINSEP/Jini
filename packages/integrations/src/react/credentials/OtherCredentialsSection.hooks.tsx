import { agentHandleSegment } from "@jini-ai/core/agent-handles";
import type { ForwardedRef, RefObject } from "react";

import type { OtherCredentialStoreInfo } from "./other-credential-stores.js";

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

/**
 * @file `OtherCredentialsSection.tsx`'s `forwardRef` `<dialog>` sub-component's own handlers —
 * `OtherCredentialRemoveDialog`'s close/confirm — split out per the
 * `<Name>.tsx`/`<Name>.hooks.tsx` extraction pattern (admin TSX-logic-sweep: deferred 2026-09-03,
 * fixed 2026-09-05). Mirrors `AccessTokensTab.hooks.tsx`'s `useRemoveConfirmDialog` exactly, for
 * Tier 2's own row shape — see that file's header for why this takes the forwarded ref as a
 * parameter rather than restructuring the dialog into a controlled `open`-prop shape.
 */

export interface OtherCredentialRemoveDialogActions {
  close: () => void;
  confirm: () => void;
}

/**
 * `OtherCredentialRemoveDialog`'s close/confirm — extracted verbatim, same two calls, same order.
 *
 * @param required - The dialog and controller inputs.
 * @param required.ref - The forwarded ref `OtherCredentialRemoveDialog` receives from its caller.
 * @param required.row - The credential row this confirm dialog is for.
 * @param required.controller - `OtherCredentialsController.remove` is the one call this hook makes.
 * @returns `close`/`confirm`, wired directly to the dialog's Cancel/"Remove from Tovu" buttons.
 * @complexity O(1).
 */
export function useOtherCredentialRemoveDialog(
  { ref, row, controller }: {
    ref: ForwardedRef<HTMLDialogElement>;
    row: OtherCredentialRowState;
    controller: { remove: (row: OtherCredentialRowState) => Promise<void> };
  },
  _optional: Record<string, never> = {},
): OtherCredentialRemoveDialogActions {
  function close(): void {
    (ref as RefObject<HTMLDialogElement>).current?.close();
  }
  function confirm(): void {
    close();
    void controller.remove(row);
  }
  return { close, confirm };
}

/** Display-only ids for Tier 2 controls; raw item ids remain storage/draft keys. O(n) in id characters. */
export function rowHandleBase({ row }: { row: OtherCredentialRowState }, _optional: Record<string, never> = {}): string {
  return `${row.store.id}-${agentHandleSegment({ value: row.itemId })}`;
}
