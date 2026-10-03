import { createPortal } from "react-dom";
import { agentHandle } from "@jini-ai/agentic";
import { buildAgentListHandles } from "@jini-ai/agentic";
import type { Translate } from "../../../i18n/dictionary-translator.js";
import { useSelectDropdown, type PanelPosition, type SelectOption } from "./Select.hooks.js";

export type { SelectOption };
/** Use this custom listbox when in-panel search is needed: a native OS option list cannot host it.
 * Native selects otherwise avoid the accessibility/behavior tradeoffs of a simulated listbox.
 * JSX stays separate from dropdown state/DOM effects so injected useDropdown can render against a
 * fake without geometry or listeners. The body portal escapes clipping/stacking ancestors.
 * Agent selection uses trigger/option clicks rather than native select_option; the -option namespace
 * keeps caller values from colliding with literal segments. Explicit base handles are not silently
 * sanitized: invalid caller choices should fail rather than publish a different handle. */

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string | undefined;
  id?: string | undefined;
  "aria-label"?: string | undefined;
  "aria-labelledby"?: string | undefined;
  disabled?: boolean | undefined;
  /** Injectable state/effect seam; rendering tests need not drive portal positioning or listeners. */
  useDropdown?: typeof useSelectDropdown | undefined;
  agentHandle?: string | undefined;

  /** Caller-bound translation function; source copy is the default. */
  translate?: Translate | undefined;
  /** Legacy alias for callers porting the original select. */
  t?: Translate | undefined;
}

function SelectOptionRow({
  option,
  index,
  isSelected,
  isHighlighted,
  optionId,
  setOptionRef,
  onHighlight,
  onSelect,
  agentHandle: optionHandle,
}: {
  option: SelectOption;
  index: number;
  isSelected: boolean;
  isHighlighted: boolean;
  optionId: string;
  setOptionRef: (index: number, el: HTMLLIElement | null) => void;
  onHighlight: (index: number) => void;
  onSelect: (option: SelectOption) => void;
  agentHandle?: string | undefined;
}) {
  return (
    <li
      ref={(el) => setOptionRef(index, el)}
      id={optionId}
      role="option"
      aria-selected={isSelected}
      className={`select-option${isSelected ? " is-selected" : ""}${isHighlighted ? " is-highlighted" : ""}`}
      onMouseEnter={() => onHighlight(index)}
      onClick={() => onSelect(option)}
      {...(optionHandle ? agentHandle({ handle: optionHandle }, { role: "button", label: option.label }) : {})}
    >
      <span className="select-option-label">{option.label}</span>
      {isSelected ? (
        <svg className="select-option-check" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </li>
  );
}

function SelectPanel({
  panelRef,
  position,
  showSearch,
  searchInputRef,
  query,
  setQuery,
  filtered,
  value,
  highlightedIndex,
  listboxId,
  optionId,
  setOptionRef,
  onHighlight,
  onSelect,
  onKeyDown,
  searchHandle,
  optionHandles,
  t,
}: {
  panelRef: React.RefObject<HTMLDivElement | null>;
  position: PanelPosition;
  showSearch: boolean;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  query: string;
  setQuery: (query: string) => void;
  filtered: SelectOption[];
  value: string;
  highlightedIndex: number;
  listboxId: string;
  optionId: (index: number) => string;
  setOptionRef: (index: number, el: HTMLLIElement | null) => void;
  onHighlight: (index: number) => void;
  onSelect: (option: SelectOption) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  searchHandle?: string | undefined;
  optionHandles?: readonly string[] | undefined;
  t: Translate;
}) {
  return (
    <div
      ref={panelRef}
      className="select-panel"
      style={{ left: position.left, width: position.width, top: position.top, bottom: position.bottom, maxHeight: position.maxHeight }}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      {showSearch ? (
        <input
          ref={searchInputRef}
          type="text"
          className="select-search"
          aria-label={t("Search options")}
          placeholder={t("Search…")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          {...(searchHandle ? agentHandle({ handle: searchHandle }, { role: "field", label: "Search the option list" }) : {})}
        />
      ) : null}
      <ul className="select-list" role="listbox" id={listboxId}>
        {filtered.length === 0 ? (
          <li className="select-empty" role="presentation">
            {t("No matches")}
          </li>
        ) : (
          filtered.map((option, index) => (
            <SelectOptionRow
              key={option.value}
              option={option}
              index={index}
              isSelected={option.value === value}
              isHighlighted={index === highlightedIndex}
              optionId={optionId(index)}
              setOptionRef={setOptionRef}
              onHighlight={onHighlight}
              onSelect={onSelect}
              agentHandle={optionHandles?.[index]}
            />
          ))
        )}
      </ul>
    </div>
  );
}

export function resolveSelectTriggerLabel({ selectedOption, placeholder }: { selectedOption: SelectOption | null; placeholder: string | undefined }, { t = (key) => key }: { t?: Translate | undefined } = {}
): { text: string; className: string } {
  if (selectedOption) return { text: selectedOption.label, className: "select-trigger-label" };
  return { text: placeholder ?? t("Select…"), className: "select-trigger-label is-placeholder" };
}

function resolveSelectTriggerActiveDescendant(
  open: boolean,
  highlightedIndex: number,
  optionId: (index: number) => string,
): string | undefined {
  return open && highlightedIndex >= 0 ? optionId(highlightedIndex) : undefined;
}

function resolveSelectTriggerHandleProps(
  base: string | undefined,
  ariaLabel: string | undefined,
  placeholder: string | undefined,
): Record<string, unknown> {
  return base ? agentHandle({ handle: base }, { role: "button", label: ariaLabel ?? placeholder ?? "Select an option" }) : {};
}

/** Controlled searchable listbox with portal positioning and keyboard navigation. */
export function Select(props: SelectProps) {
  const { value, onChange, options, placeholder, id, disabled, useDropdown = useSelectDropdown, agentHandle: base, translate, t = translate ?? ((key: string) => key) } = props;
  const ariaLabel = props["aria-label"];
  const ariaLabelledBy = props["aria-labelledby"];

  const {
    open,
    highlightedIndex,
    setHighlightedIndex,
    position,
    triggerRef,
    panelRef,
    searchInputRef,
    optionRefs,
    listboxId,
    showSearch,
    filtered,
    selectedOption,
    openPanel,
    closePanel,
    selectOption,
    handleTriggerKeyDown,
    handlePanelKeyDown,
    optionId,
    query,
    setQuery,
  } = useDropdown({ value, onChange, options }, { disabled });

  function setOptionRef(index: number, el: HTMLLIElement | null) {
    if (el) optionRefs.current.set(index, el);
    else optionRefs.current.delete(index);
  }

  const triggerLabel = resolveSelectTriggerLabel({ selectedOption: selectedOption, placeholder: placeholder }, { t: t });
  const activeDescendant = resolveSelectTriggerActiveDescendant(open, highlightedIndex, optionId);
  // One handle per FILTERED option, recomputed as the search query narrows the list — an option
  // dropped by the current query has no rendered row to attach a handle to, so it is simply absent
  // this render rather than holding a handle nothing resolves to. `undefined` (not an empty array)
  // when `base` itself is unset, so `SelectPanel` can tell "opted out" apart from "no options match".
  const optionHandles = base ? buildAgentListHandles({ prefix: `${base}-option`, ids: filtered.map((option) => option.value) }) : undefined;

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        id={id}
        className="select-trigger"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={activeDescendant}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        disabled={disabled}
        onClick={() => (open ? closePanel({ refocusTrigger: false }) : openPanel())}
        onKeyDown={handleTriggerKeyDown}
        {...resolveSelectTriggerHandleProps(base, ariaLabel, placeholder)}
      >
        <span className={triggerLabel.className}>{triggerLabel.text}</span>
        <span className="select-trigger-chevron" aria-hidden="true" />
      </button>

      {open && position
        ? createPortal(
            <SelectPanel
              panelRef={panelRef}
              position={position}
              showSearch={showSearch}
              searchInputRef={searchInputRef}
              query={query}
              setQuery={setQuery}
              filtered={filtered}
              value={value}
              highlightedIndex={highlightedIndex}
              listboxId={listboxId}
              optionId={optionId}
              setOptionRef={setOptionRef}
              onHighlight={setHighlightedIndex}
              onSelect={selectOption}
              onKeyDown={handlePanelKeyDown}
              searchHandle={base ? `${base}-search` : undefined}
              optionHandles={optionHandles}
              t={t}
            />,
            document.body
          )
        : null}
    </>
  );
}
