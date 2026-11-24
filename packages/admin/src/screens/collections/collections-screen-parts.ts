import type { ComponentType, ReactNode } from "react";
import type { EditFieldsDialogProps } from "./EditFieldsDialog.js";
import type { LifecycleConfirmDialogProps } from "./LifecycleConfirmDialog.js";
import type { NewContentTypeDialogProps } from "./NewContentTypeDialog.js";
import type { BoundCollectionsRules } from "./rules.js";

/**
 * @file What the collections list and entries screens receive from the host besides their data:
 * the host's status-label component, its section publish control, its kit-bound row-menu builder
 * and (for the list) one hook per dialog, each bound by the host to its live port, locale and kit.
 * `Collections.tsx` / `CollectionEntries.tsx` take these as required props; none has a default
 * because every one of them is a host collaborator this package must not import.
 */

/** The host collaborators both screens render inside their headers and status pills. */
export interface CollectionsChromeParts {
  /** The host's server-status label (e.g. "active"), rendered inside each `.status` pill. */
  StatusLabel: ComponentType<{ value: string }>;
  /** The host's "publish this section" control, placed first in the page header's actions. */
  publishButton: ReactNode;
}

/** The three dialog hooks the list screen mounts; the host binds each to its live port, locale and kit. */
export interface CollectionsDialogHooks {
  useNewContentTypeDialogHook: NewContentTypeDialogProps["useNewContentTypeDialogHook"];
  useEditFieldsDialogHook: EditFieldsDialogProps["useEditFieldsDialogHook"];
  useLifecycleConfirmDialogHook: LifecycleConfirmDialogProps["useLifecycleConfirmDialogHook"];
}

/** The list screen's remaining host collaborator: the kit-bound row-menu builder
 *  (`bindCollectionsRules({ kit }).contentTypeMenuItems`). */
export interface CollectionsListParts extends CollectionsChromeParts, CollectionsDialogHooks {
  contentTypeMenuItems: BoundCollectionsRules["contentTypeMenuItems"];
}
