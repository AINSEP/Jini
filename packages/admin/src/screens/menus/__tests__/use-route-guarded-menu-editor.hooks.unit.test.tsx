// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { MenuEditorController } from "../hooks/use-menu-editor.hooks.js";
import { useRouteGuardedMenuEditor } from "../hooks/use-route-guarded-menu-editor.hooks.js";

it("cancels Back with the mounted dirty callback once and removes its listener on unmount", () => {
  const confirmLeave = vi.fn(() => false);
  const controller = { confirmLeave } as MenuEditorController;
  const target = new EventTarget();
  const unsubscribe = vi.fn();
  const { result, unmount } = renderHook(() => useRouteGuardedMenuEditor({ menuId: "menu",
    useMenuEditorHook: () => controller,
    subscribeBeforeNavigation: (listener) => {
      target.addEventListener("back", listener);
      return () => { unsubscribe(); target.removeEventListener("back", listener); };
    },
  }));
  const event = new Event("back", { cancelable: true });
  target.dispatchEvent(event);
  expect(confirmLeave).toHaveBeenCalledTimes(1);
  expect(event.defaultPrevented).toBe(true);
  expect(result.current.leaveGuardOwner).toBe("router");
  unmount();
  target.dispatchEvent(new Event("back", { cancelable: true }));
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(confirmLeave).toHaveBeenCalledTimes(1);
});
