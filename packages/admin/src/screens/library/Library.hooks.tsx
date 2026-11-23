import type { KeyboardEvent } from "react";
import { Icon } from "@jini-ai/ui";
import type { LibraryController } from "./hooks/use-library.hooks";
import type { TabBarTab } from "@jini-ai/ui/tab-strip";

import { navigate } from "@jini-ai/admin/shell/lib/router";

import { resolveActiveTabId } from '@jini-ai/core/text';
/**
 * @file The Library screen's two `?tab=` tabs (Upload, Documents) on the shared
 * `@jini-ai/ui/tab-strip` — same convention as `Roles.hooks.tsx` / `Sites`. Upload is first and
 * the landing tab, in the owner's order (2026-10-18); after an upload the tab offers
 * "View in Documents".
 */

export const LIBRARY_TAB_IDS = ["upload", "documents"] as const;
export type LibraryTabId = (typeof LIBRARY_TAB_IDS)[number];

export function resolveLibraryTabId({ tabId }: { tabId: string | null | undefined }, _optional = {}): LibraryTabId {
  return resolveActiveTabId({ tabId: tabId, validIds: LIBRARY_TAB_IDS, defaultId: "upload" });
}

export function resolveLibraryTabs({ t }: { t: (key: string) => string }, { documentCount }: { documentCount?: number } = {}): TabBarTab[] {
  return [
    {
      id: "upload",
      label: t("Upload"),
      icon: <Icon name="tray-upload" size={16} strokeWidth={1.5} />,
      handle: "library-tab-upload",
      handleLabel: "Switch to the Upload tab — add Markdown, text, PDF, Word, CSV or JSON documents to the Library",
    },
    {
      id: "documents",
      label: t("Documents"),
      icon: <Icon name="document-lines" size={16} strokeWidth={1.5} />,
      count: documentCount,
      handle: "library-tab-documents",
      handleLabel: "Switch to the Documents tab — preview, rename, download or move Library documents to Trash",
    },
  ];
}

export function goToLibraryTab({ tabId }: { tabId: string }, _optional = {}) {
  navigate({ routePath: `/library?tab=${tabId}` }, { replace: true });
}

export function createRenameKeyDown({ rename }: { rename: LibraryController["rename"] }, _options = {}) {
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void rename.save();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      rename.cancel();
    }
  }
  return onKeyDown;
}

export function createPreviewKeyDown({ closePreview }: { closePreview: () => void }, _options = {}) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") closePreview();
  }
  return onKeyDown;
}
