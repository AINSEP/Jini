import type { ComponentType } from "react";
import type { useTaxonomyRowMenu } from "./TaxonomyRowMenu.hooks.js";
import type { NewTermFormController, NewTermFormOptions } from "./hooks/use-new-term-form.hooks.js";
import type { NewTaxonomyFormController, NewTaxonomyFormOptions } from "./hooks/use-new-taxonomy-form.hooks.js";
import type { MergeTermSectionController, MergeTermSectionOptions } from "./hooks/use-merge-term-section.hooks.js";
import type { TermDetailPanelController, TermDetailPanelOptions } from "./hooks/use-term-detail-panel.hooks.js";

/**
 * @file What the Categories & Tags screen's components receive from the host besides their data:
 * one hook per stateful component (each bound by the host to its live port, locale and kit) and the
 * host's status-label component. `Taxonomy.tsx` takes these as required props and hands them down.
 */

export type Translate = (key: string) => string;

/** The hooks every taxonomy sub-component mounts; the host binds each to its live port, locale and kit. */
export interface TaxonomyScreenHooks {
  useNewTermFormHook: (options: NewTermFormOptions) => NewTermFormController;
  useNewTaxonomyFormHook: (options: NewTaxonomyFormOptions) => NewTaxonomyFormController;
  useMergeTermSectionHook: (options: MergeTermSectionOptions) => MergeTermSectionController;
  useTermDetailPanelHook: (options: TermDetailPanelOptions) => TermDetailPanelController;
  useTaxonomyRowMenuHook: typeof useTaxonomyRowMenu;
}

/** What the screen's inner components read besides their own data: the hooks and the status label. */
export interface TaxonomyScreenParts extends TaxonomyScreenHooks {
  /** The host's server-status label (e.g. "active"), rendered inside each `.status` pill. */
  StatusLabel: ComponentType<{ value: string }>;
}

