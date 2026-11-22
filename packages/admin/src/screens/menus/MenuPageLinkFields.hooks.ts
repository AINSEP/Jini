import type { ChangeEvent } from "react";
import type { AdminMenuItem } from "./api/menus-api.types.js";
import { pageLinkState, pageTargetForChoice, menuTargetEditorKind, targetForKind, type MenuPageChoice, type MenuTargetEditorKind } from "./page-link-rules.js";

export function useMenuTargetEditor(
  { item, path, onChange, pages }: { item: AdminMenuItem; path: number[]; pages?: readonly MenuPageChoice[]; onChange: (path: number[], update: (item: AdminMenuItem) => AdminMenuItem) => void },
  _optional = {},
) {
  const kind = menuTargetEditorKind({ target: item.target, pages });
  return { kind, isPage: kind === "page", selectType: (event: ChangeEvent<HTMLSelectElement>) => {
    const selected = event.currentTarget.value as MenuTargetEditorKind;
    onChange(path, (previous) => ({ ...previous, target: targetForKind({ kind: selected, prev: previous.target }) }));
  } };
}

/** Keeps target reshaping outside the page selector's markup. */
export function useMenuPageLinkFields(
  { item, path, pages, onChange, t }: {
    item: AdminMenuItem; path: number[]; pages?: readonly MenuPageChoice[]; t: (key: string) => string;
    onChange: (path: number[], update: (item: AdminMenuItem) => AdminMenuItem) => void;
  },
  _optional = {},
) {
  return { ...pageLinkState({ entryId: item.target.entryId, label: item.label, pages, t }),
    selectPage: (event: ChangeEvent<HTMLSelectElement>) => {
      const entryId = event.currentTarget.value;
      onChange(path, (previous) => ({ ...previous, target: pageTargetForChoice({ entryId, pages }) }));
    },
  };
}
