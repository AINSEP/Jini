/**
 * @file `windows/dock-icon.ts`: the dock tile icon, with a fake `app.dock`.
 */
import { describe, expect, it } from "vitest";

import { applyDockIcon } from "../index.js";

describe("applyDockIcon", () => {
  it("sets nothing and reports nothing without a dock (Windows, Linux)", () => {
    const reasons: string[] = [];
    applyDockIcon({ dock: undefined, iconPath: "/icon.png", reportFailure: ({ reason }) => reasons.push(reason) });
    expect(reasons).toEqual([]);
  });

  it("puts the injected icon on a dock", () => {
    const set: string[] = [];
    const reasons: string[] = [];
    applyDockIcon({ dock: { setIcon: (p) => { set.push(p); } }, iconPath: "/brand/app-icon.png", reportFailure: ({ reason }) => reasons.push(reason) });
    expect(set).toEqual(["/brand/app-icon.png"]);
    expect(reasons).toEqual([]);
  });

  it("reports an unreadable icon's reason and lets the boot carry on", () => {
    const reasons: string[] = [];
    expect(() => applyDockIcon({
      dock: { setIcon: () => { throw new Error("Failed to load image"); } },
      iconPath: "/missing.png",
      reportFailure: ({ reason }) => reasons.push(reason),
    })).not.toThrow();
    expect(reasons).toEqual(["Failed to load image"]);
  });

  it("stringifies a non-Error throw rather than losing it", () => {
    const reasons: string[] = [];
    applyDockIcon({ dock: { setIcon: () => { throw "bad image"; } }, iconPath: "/x.png", reportFailure: ({ reason }) => reasons.push(reason) });
    expect(reasons).toEqual(["bad image"]);
  });
});
