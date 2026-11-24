// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { orFallbackSync } from "@jini-ai/core/errors/idioms";

import {
  createBrowserWorkingDirectoryAccess,
  isDirectoryPickerSupported,
} from "../browser-working-directory-access.js";

const KEY = "host.recent-directory-names";
const createAccess = () => createBrowserWorkingDirectoryAccess({ orFallbackSync, recentDirectoryNamesStorageKey: KEY });

/**
 * @file `browser-working-directory-access.ts` — the native File System Access API implementation
 * of `@jini-ai/chat/react`'s `ChatPaneWorkingDirectoryAccess`, wired into the host's `AssistantDock` as the
 * folder button's native picker (owner request, 2026-09-01: "shouldn't clicking the folder open a
 * real folder picker, like Finder?").
 *
 * jsdom (this suite's `environment: "jsdom"`, `vitest.config.ts`) has no
 * `window.showDirectoryPicker` of its own — exactly like Safari/Firefox — so every test here
 * installs (and removes) its own stub rather than relying on a real browser. That doubles as the
 * regression coverage for the no-native-API browsers: {@link isDirectoryPickerSupported} and
 * {@link createBrowserWorkingDirectoryAccess} are exercised with the stub ABSENT first.
 */

describe("isDirectoryPickerSupported / createBrowserWorkingDirectoryAccess — feature detection", () => {
  afterEach(() => {
    delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  });

  it("reports unsupported, and returns undefined, on a browser with no showDirectoryPicker (Safari, Firefox, jsdom)", () => {
    expect(isDirectoryPickerSupported()).toBe(false);
    expect(createAccess()).toBeUndefined();
  });

  it("reports supported, and returns a real access object, once showDirectoryPicker exists (Chrome, Edge)", () => {
    window.showDirectoryPicker = async () => ({ name: "stub" }) as FileSystemDirectoryHandle;

    expect(isDirectoryPickerSupported()).toBe(true);
    expect(createAccess()).toBeDefined();
  });
});

describe("createAccess().pickWorkingDirectory", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
    window.localStorage.clear();
  });

  it("resolves null, without throwing, when the user cancels the native dialog (AbortError)", async () => {
    // This is the FAILING case this fix exists for: a naive implementation treats every
    // showDirectoryPicker() rejection as an error, which would surface "cancel" to the operator
    // as a visible `workingDirectoryError` banner every time they close the dialog without
    // picking anything.
    window.showDirectoryPicker = async () => {
      throw new DOMException("The user aborted a request.", "AbortError");
    };
    const access = createAccess();

    await expect(access!.pickWorkingDirectory()).resolves.toBeNull();
  });

  it("resolves the picked folder's name, and records it as the most recent directory", async () => {
    window.showDirectoryPicker = async () => ({ name: "my-real-project" }) as FileSystemDirectoryHandle;
    const access = createAccess();

    await expect(access!.pickWorkingDirectory()).resolves.toBe("my-real-project");
    await expect(access!.recentDirectories()).resolves.toEqual(["my-real-project"]);
  });

  it("re-throws a non-cancel rejection (e.g. insecure context, permission policy) for the caller's own error UI", async () => {
    window.showDirectoryPicker = async () => {
      throw new DOMException("showDirectoryPicker is not allowed.", "SecurityError");
    };
    const access = createAccess();

    await expect(access!.pickWorkingDirectory()).rejects.toThrow("showDirectoryPicker is not allowed.");
  });

  it("moves a re-picked name to the front instead of duplicating it, and caps the list", async () => {
    let nextName = "";
    window.showDirectoryPicker = async () => ({ name: nextName }) as FileSystemDirectoryHandle;
    const access = createAccess()!;

    // Sequential, not `Promise.all` — each pick must land before the next fires, matching the
    // real one-dialog-at-a-time flow this is modeling.
    for (const name of ["a", "b", "c", "d", "e", "f"]) {
      nextName = name;
      await access.pickWorkingDirectory();
    }
    nextName = "b";
    await access.pickWorkingDirectory();

    await expect(access.recentDirectories()).resolves.toEqual(["b", "f", "e", "d", "c"]);
  });
});

describe("createAccess().directoryExists", () => {
  afterEach(() => {
    delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  });

  it("always resolves true — a folder NAME cannot be checked against the real filesystem from a browser tab", async () => {
    window.showDirectoryPicker = async () => ({ name: "stub" }) as FileSystemDirectoryHandle;
    const access = createAccess()!;

    await expect(access.directoryExists("my-project")).resolves.toBe(true);
    await expect(access.directoryExists("anything-at-all")).resolves.toBe(true);
  });
});

describe("createAccess().recentDirectories — storage resilience", () => {
  afterEach(() => {
    delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
    window.localStorage.clear();
  });

  it("degrades to an empty list instead of throwing on corrupt JSON under its storage key", async () => {
    window.showDirectoryPicker = async () => ({ name: "stub" }) as FileSystemDirectoryHandle;
    window.localStorage.setItem(KEY, "{not valid json");
    const access = createAccess()!;

    await expect(access.recentDirectories()).resolves.toEqual([]);
  });

  it("degrades to an empty list when the stored value is valid JSON but not a string array", async () => {
    window.showDirectoryPicker = async () => ({ name: "stub" }) as FileSystemDirectoryHandle;
    window.localStorage.setItem(KEY, JSON.stringify({ not: "an array" }));
    const access = createAccess()!;

    await expect(access.recentDirectories()).resolves.toEqual([]);
  });
});

describe("createBrowserWorkingDirectoryAccess — host-injected storage key", () => {
  beforeEach(() => {
    window.showDirectoryPicker = async () => ({ name: "picked" }) as FileSystemDirectoryHandle;
    window.localStorage.clear();
  });
  afterEach(() => {
    delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
    window.localStorage.clear();
  });

  it("writes and reads the recent list only under the key the host passed", async () => {
    window.localStorage.setItem("other.host.key", JSON.stringify(["from-another-key"]));
    window.localStorage.setItem("host.second-key", JSON.stringify(["older"]));
    const second = createBrowserWorkingDirectoryAccess({ orFallbackSync, recentDirectoryNamesStorageKey: "host.second-key" })!;

    await expect(second.recentDirectories()).resolves.toEqual(["older"]);
    await second.pickWorkingDirectory();

    expect(window.localStorage.getItem("host.second-key")).toBe(JSON.stringify(["picked", "older"]));
    expect(window.localStorage.getItem("other.host.key")).toBe(JSON.stringify(["from-another-key"]));
    expect(window.localStorage.length).toBe(2);
  });
});
