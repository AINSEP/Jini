import type { Translate } from "@jini-ai/core/text";

/**
 * The two fields of the host's toolbar-overflow controller this button reads. The host's measuring
 * hook owns the rest (toolbar ref, ranked slots) and passes its whole controller; structural typing
 * keeps this package free of that hook module. `tb-btn`/`tb-more` stay host classes: the host hook
 * queries `.tb-more` to measure the phone row, so renaming it here would break the fit.
 */
export interface ToolbarOverflowState {
  open: boolean;
  toggle: () => void;
}

/* Phone overflow (owner, 2026-10-15: the wrapped toolbar was "so messed up, janky"). At phone
    width only the `data-tb="primary"` controls show, in one row; this toggles the rest in
    below them. Hidden by CSS on wider panes, where every control already shows. Which ranked
    controls (`overflow.slot`) are primary is measured so this button never wraps (2026-10-15). */
export function ToolbarOverflowMenu({ overflow, t }: { overflow: ToolbarOverflowState; t: Translate }) {
  // `tb-more` is not a style hook: the host's toolbar-fit measurement queries `.tb-more` to size the
  // wrapped row, so it stays until that host hook is extracted; the styling class is the jini one.
  return (
    <button
      className="jini-post-toolbar__btn tb-more"
      title={t("More formatting")}
      aria-label={t("More formatting")}
      aria-expanded={overflow.open}
      onClick={overflow.toggle}
    >
      <svg viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
        <circle cx="4" cy="9" r="1.4" /><circle cx="9" cy="9" r="1.4" /><circle cx="14" cy="9" r="1.4" />
      </svg>
    </button>
  );
}
