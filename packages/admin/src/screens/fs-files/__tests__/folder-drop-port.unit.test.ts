// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { getFolderDropPort, type FolderDropPort } from "../folder-drop-port.js";

/** The host's preload global name is injected; any name works here, the host passes its own. */
const bridgeKey = "desktopFiles";

type BridgeHost = { desktopFiles?: FolderDropPort };

/** @file Mirrors the host's other preload-port readers' capability-gate shape exactly (a plain
 *  browser tab, no bridge global, must resolve to `null`, never throw). */
describe("getFolderDropPort", () => {
  it("returns null when there is no global window and no injected window", () => {
    vi.stubGlobal("window", undefined);
    try {
      expect(getFolderDropPort({ targetWindow: undefined, bridgeKey })).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns null for a window with no bridge global (plain browser tab)", () => {
    const fakeWindow = {} as unknown as Window;
    expect(getFolderDropPort({ targetWindow: fakeWindow, bridgeKey })).toBeNull();
  });

  it("returns the real port when the bridge global is present (inside the desktop shell)", () => {
    const port: FolderDropPort = { getPathForFile: () => "/Users/x/Desktop/Folder" };
    const fakeWindow = { desktopFiles: port } as unknown as Window;
    expect(getFolderDropPort({ targetWindow: fakeWindow, bridgeKey })).toBe(port);
  });

  it("reads only the injected bridge name, never another global", () => {
    const port: FolderDropPort = { getPathForFile: () => "/Users/x/Desktop/Folder" };
    const fakeWindow = { desktopFiles: port } as unknown as Window;
    expect(getFolderDropPort({ targetWindow: fakeWindow, bridgeKey: "otherBridge" })).toBeNull();
  });

  it("falls back to the global window when no target is injected", () => {
    const host = window as unknown as BridgeHost;
    const previous = host.desktopFiles;
    const port: FolderDropPort = { getPathForFile: () => "/Users/x/Desktop/Folder" };
    try {
      host.desktopFiles = port;
      expect(getFolderDropPort({ targetWindow: undefined, bridgeKey })).toBe(port);
      delete host.desktopFiles;
      expect(getFolderDropPort({ targetWindow: undefined, bridgeKey })).toBeNull();
    } finally {
      if (previous === undefined) delete host.desktopFiles;
      else host.desktopFiles = previous;
    }
  });
});
