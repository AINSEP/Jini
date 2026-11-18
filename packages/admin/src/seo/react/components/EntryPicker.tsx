import { agentHandle } from "@jini-ai/core/agent-handles";
import { WidgetSelect as Select } from "../../../react/kit.js";
import { useSeoCopy } from "../hooks/SeoPorts.hooks.js";
import { useWiredEntryPicker } from "../hooks/use-entry-picker.hooks.js";

export interface EntryPickerProps {
  locale: string;
  entryId: string;
  onChange: (entryId: string) => void;
  /** Dependency injection seam for tests — the same convention `@jini-ai/ui`'s `CustomSelect` uses
   *  for `useCustomSelect`. */
  useEntryPickerHook?: typeof useWiredEntryPicker;
  useSeoCopyHook?: typeof useSeoCopy;
}

/** Searchable picker over every page + post, sourced from the already-existing `listPosts`/`listPages`
 * routes (REQ-06). It was a native `<select>`; with a few dozen entries that opened as one tall OS
 * list with "(published)" after every row (owner, 2026-10-15: "we have a searchable dropdown
 * right?"). The shared admin-widgets `Select` already types-to-filter and handles the keyboard, so
 * rows are just grouped Pages/Posts with a pill only for the non-published exceptions
 * (`entryPickerOptions` in `rules.ts`). */
export function EntryPicker({ locale, entryId, onChange, useEntryPickerHook = useWiredEntryPicker, useSeoCopyHook = useSeoCopy }: EntryPickerProps) {
  const t = useSeoCopyHook();
  const { entries, options, error } = useEntryPickerHook();

  if (error) return <div className="jini-notice jini-notice-error">{error}</div>;
  if (!entries) return <div className="jini-notice">{t({ locale: locale, key: "Loading entries…" })}</div>;

  /* The "Entry" caption is no longer painted (owner, 2026-09-06: "you can actually just get rid of
     'Entry'") — the placeholder already says "Choose an entry…", so the visible word was saying it
     twice. It stays the control's accessible name (now `aria-label` on the combobox trigger) rather
     than leaving a placeholder-only control with no name at all. The i18n key is unchanged. */
  return (
    <div className="jini-seo-entry-picker">
      <Select
        value={entryId}
        onChange={onChange}
        options={options ?? []}
        placeholder={t({ locale: locale, key: "Choose an entry…" })}
        aria-label={t({ locale: locale, key: "Entry" })}
        agentHandle="seo-entry-picker"
        translate={(key) => t({ locale, key })}
      />
    </div>
  );
}
