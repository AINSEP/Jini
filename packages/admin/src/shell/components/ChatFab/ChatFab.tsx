import { agentHandle } from "@jini-ai/core/agent-handles";
import { useFabPosition } from "./ChatFab.hooks.js";

import { interpolate, localeEntry } from '@jini-ai/core/text';
/** The locale every un-parameterized call gets. */
const DEFAULT_LOCALE = "en";

interface ChatFabProps {
  open: boolean;
  onToggle: () => void;
  label?: string;
  /**
   * `useAdminLocale()`'s current value, threaded from the caller (`App.tsx`) rather than read here
   * directly — this component has no other data-dependent hook today, and the existing unit tests
   * render it with no locale at all, so `DEFAULT_LOCALE` ("en") is what every un-parameterized call
   * — tests included — keeps getting. Only the "Open"/"Close" verb template is this component's own
   * to translate; `label` itself is the caller's word (see `App.tsx`'s `dockT({ key: "assistant" })`).
   */
  locale?: string;
  /**
   * Bottom clearance (px) to hold above while `open` — the mobile sheet's current rendered
   * height, or `0` at desktop, where the assistant docks to the *side* of `.admin-content`
   * rather than below it, so there is nothing at the bottom edge to avoid. See `App.tsx`, which
   * measures the actual sheet element rather than assuming a fixed height.
   */
  avoidBottomPx: number;
  /**
   * Right clearance (px) to hold left of while `open` — the DESKTOP dock's current rendered width,
   * or `0` in sheet mode where the sheet spans the full width and `avoidBottomPx` is the axis that
   * matters. Without this the FAB sits on top of the dock's own composer send button and eats its
   * clicks; see `useFabPosition`'s `avoidRightPx` doc for the full history.
   */
  avoidRightPx: number;
  /**
   * Where the dragged FAB position lives in `localStorage`. Host-owned (the hook takes it as a
   * required option); changing it would silently reset every saved position.
   */
  positionStorageKey: string;
  ref?: React.Ref<HTMLButtonElement>;
  /**
   * Injectable seam for the drag/position hook. Defaults to the real {@link useFabPosition}
   * (MSG-01, 2026-08-06, owner directive — `useFabPosition` was named as the strongest case in the
   * pass): that hook attaches document-level `pointermove`/`pointerup`/`pointercancel` listeners,
   * calls `setPointerCapture`, reads/writes `localStorage`, and reads `window.innerWidth`/
   * `innerHeight` on every render. A test can pass a fake here to assert this component's markup/
   * aria/class-name behavior without driving any of that — the drag physics themselves stay
   * covered by `ChatFab.hooks.unit.test.tsx` against the real hook. Named `useFab`, shortening
   * `useFabPosition` the same way Jini's `ConfirmDialog` shortens `useConfirmDialog` to `useDialog`.
   */
  useFab?: typeof useFabPosition;
  /** Publishes the FAB itself as agent-addressable via `agentHandle()` (`@jini-ai/agentic`). Omit
   *  to leave it untagged — every existing render then stays byte-identical. */
  agentHandle?: string;
}

const FAB_ACTION_TEMPLATE: Record<string, { open: string; close: string }> = {
  en: { open: "Open {label}", close: "Close {label}" },
  es: { open: "Abrir {label}", close: "Cerrar {label}" },
  id: { open: "Buka {label}", close: "Tutup {label}" },
  de: { open: "{label} öffnen", close: "{label} schließen" },
  "zh-CN": { open: "打开{label}", close: "关闭{label}" },
  "zh-TW": { open: "開啟{label}", close: "關閉{label}" },
  "pt-BR": { open: "Abrir {label}", close: "Fechar {label}" },
  ru: { open: "Открыть {label}", close: "Закрыть {label}" },
  fa: { open: "باز کردن {label}", close: "بستن {label}" },
  ar: { open: "فتح {label}", close: "إغلاق {label}" },
  ja: { open: "{label}を開く", close: "{label}を閉じる" },
  ko: { open: "{label} 열기", close: "{label} 닫기" },
  pl: { open: "Otwórz {label}", close: "Zamknij {label}" },
  hu: { open: "{label} megnyitása", close: "{label} bezárása" },
  fr: { open: "Ouvrir {label}", close: "Fermer {label}" },
  uk: { open: "Відкрити {label}", close: "Закрити {label}" },
  tr: { open: "{label} aç", close: "{label} kapat" },
  th: { open: "เปิด {label}", close: "ปิด {label}" },
  it: { open: "Apri {label}", close: "Chiudi {label}" },
  hi: { open: "{label} खोलें", close: "{label} बंद करें" },
  ur: { open: "{label} کھولیں", close: "{label} بند کریں" },
  bn: { open: "{label} খুলুন", close: "{label} বন্ধ করুন" },
};

/** "Open {label}"/"Close {label}" in the caller's locale — `label` itself is already translated
 *  (by the caller; see `App.tsx`'s `dockT({ key: "assistant" })`) by the time it reaches this component. */
function fabActionLabel({ locale, action, label }: { locale: string; action: "open" | "close"; label: string }, _options: Record<string, never> = {}): string {
  const forms = localeEntry({ table: FAB_ACTION_TEMPLATE, locale });
  return interpolate({ template: forms[action], vars: { label } });
}

/**
 * Floating toggle for the global assistant dock (ADR-049), and — per MSG-09 — draggable to
 * wherever the operator wants it out of the way. A fixed-position
 * button that opens/closes the docked chat pane without ever unmounting it — see
 * `AssistantDock.tsx`'s module doc for why the dock itself uses `hidden`, not conditional render.
 *
 * The drag itself is `useFabPosition`'s job entirely (injectable via the `useFab` prop, defaulted
 * to the real implementation); this component only wires its `style`/`onPointerDown` onto the
 * button in both states (the visible open-state button can also be deliberately repositioned;
 * the composer footer reserves room for its default spot) and guards
 * `onClick` with `consumeDragFlag()` so a drag's release does not also fire a
 * toggle (see that function's own doc for why a plain `isDragging` check at this call site would
 * be timing-unsafe).
 */
export function ChatFab({
  open,
  onToggle,
  label = "assistant",
  avoidBottomPx,
  avoidRightPx,
  positionStorageKey,
  ref,
  useFab = useFabPosition,
  locale = DEFAULT_LOCALE,
  agentHandle: handle,
}: ChatFabProps) {
  const fab = useFab({ dockOpen: open, avoidBottomPx, avoidRightPx, storageKey: positionStorageKey });
  const actionLabel = fabActionLabel({ locale, action: open ? "close" : "open", label });

  return (
    <button
      ref={ref}
      type="button"
      className={`chat-fab${open ? " chat-fab-dock-open" : ""}${fab.isDragging ? " chat-fab-dragging" : ""}`}
      style={fab.style}
      onPointerDown={fab.onPointerDown}
      onClick={() => {
        if (fab.consumeDragFlag()) return;
        onToggle();
      }}
      aria-expanded={open}
      aria-label={actionLabel}
      title={actionLabel}
      {...(handle ? agentHandle({ handle }, { role: "button", label: "Toggle the assistant dock" }) : {})}
    >
      {open ? (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M5 5 15 15M15 5 5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M9 1.8 10.6 6 15 7.2 10.6 8.4 9 12.6 7.4 8.4 3 7.2 7.4 6Z" fill="currentColor" />
          <circle cx="14" cy="13.5" r="1.7" fill="currentColor" />
        </svg>
      )}
    </button>
  );
}
