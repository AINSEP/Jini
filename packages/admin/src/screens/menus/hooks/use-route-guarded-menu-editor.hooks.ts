import { useLayoutEffect } from "react";
import type { MenuEditorController } from "./use-menu-editor.hooks.js";

// The sidebar never calls the header; bind the dirty check while mounted and let the router own Back too.
export function useRouteGuardedMenuEditor({ menuId, useMenuEditorHook, subscribeBeforeNavigation }: { menuId: string | null; useMenuEditorHook: (required: { menuId: string | null }) => MenuEditorController; subscribeBeforeNavigation: (listener: (event: Event) => void) => () => void }, _optional = {}): MenuEditorController {
  const controller = useMenuEditorHook({ menuId });
  const { confirmLeave } = controller;
  useLayoutEffect(() => {
    const onBefore = (event: Event) => { if (!confirmLeave()) event.preventDefault(); };
    return subscribeBeforeNavigation(onBefore);
  }, [confirmLeave, subscribeBeforeNavigation]);
  return { ...controller, leaveGuardOwner: "router" };
}
