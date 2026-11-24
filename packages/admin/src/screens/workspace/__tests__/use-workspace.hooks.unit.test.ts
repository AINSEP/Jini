// @vitest-environment jsdom
import { act, renderHook, waitFor } from "../../../__tests__/fetch-query-support.js";
import type { FormEvent } from "react";
import { describe, expect, it, vi } from "vitest";

import type { AdminWorkspaceResponse as AdminWorkspace } from "@jini-ai/core/contracts/site/cms-workspace";
import { useWorkspace, type WorkspaceDependencies, type WorkspaceErrorDescriber, type WorkspaceTranslate } from "../hooks/use-workspace.hooks.js";
import type { WorkspacePort } from "../hooks/workspace-port.hooks.js";

/**
 * @file `useWorkspace` — the Workspace screen's entire state machine (load + rename-form save),
 * extracted so it is reachable from `renderHook` with no `Workspace.tsx` markup involved.
 * The screen's own tests (`Workspace.unit.test.tsx`) drive the SCREEN through its `useWorkspaceHook`
 * DI seam with a hand-built `WorkspaceController`, so the real hook body —
 * `port.getWorkspace()`/`port.updateWorkspace()`, the `describeError` wiring, the locale — never ran.
 *
 * The host resolves the locale, owns the dictionary and owns the error copy; here each arrives as a
 * fake (`locale`, `translate`, `describeError`), and every read/write goes through an in-memory
 * `WorkspacePort`, never real `fetch`. The host's wired binding (real API client, real locale
 * endpoint, its production query adapter) keeps its own wiring test in the host.
 */

function fakeSubmitEvent(): FormEvent {
  return { preventDefault: vi.fn() } as unknown as FormEvent;
}

/** An in-memory {@link WorkspacePort}: `current` is the record the fake holds after each save. */
function createFakePort({ workspace }: { workspace: AdminWorkspace }, _optional = {}): WorkspacePort & { readonly current: AdminWorkspace } {
  let current = workspace;
  return {
    get current() { return current; },
    async getWorkspace() { return { workspace: current }; },
    async updateWorkspace({ patch }) { current = { ...current, ...patch }; return { workspace: current }; },
  };
}

const SPANISH: Record<string, string> = { "Save changes": "Guardar cambios", "failed to load workspace": "no se pudo cargar" };
/** A two-locale dictionary standing in for the host's: English is the key itself. */
const translate: WorkspaceTranslate = ({ locale, key }) => (locale === "es" ? SPANISH[key] ?? key : key);
/** The host's default shape: an Error's own message, else the translated fallback. */
const describeError: WorkspaceErrorDescriber = ({ e, fallback }) => (e instanceof Error && e.message ? e.message : fallback);

const WORKSPACE: AdminWorkspace = {
  id: "w1",
  name: "My Site",
  slug: "my-site",
  createdAt: "2026-08-01T00:00:00.000Z",
  version: 1,
};

function deps(port: WorkspacePort, overrides: Partial<WorkspaceDependencies> = {}): WorkspaceDependencies {
  return { port, locale: "en", translate, describeError, ...overrides };
}

describe("useWorkspace — load", () => {
  it("starts with workspace null and empty draft fields before the load settles", () => {
    const port = createFakePort({ workspace: WORKSPACE });
    port.getWorkspace = () => new Promise(() => {});
    const { result } = renderHook(() => useWorkspace(deps(port)));

    expect(result.current.workspace).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.name).toBe("");
    expect(result.current.slug).toBe("");
    expect(result.current.saving).toBe(false);
    expect(result.current.saveError).toBeNull();
    expect(result.current.saved).toBe(false);
  });

  it("loads the workspace from the injected port on mount, seeding name/slug from it", async () => {
    const port = createFakePort({ workspace: WORKSPACE });
    const { result } = renderHook(() => useWorkspace(deps(port)));

    await waitFor(() => expect(result.current.workspace).not.toBeNull());
    expect(result.current.workspace).toEqual(WORKSPACE);
    expect(result.current.name).toBe(WORKSPACE.name);
    expect(result.current.slug).toBe(WORKSPACE.slug);
    expect(result.current.error).toBeNull();
  });

  it("passes an Error rejection's own message straight through the injected describeError", async () => {
    const port = createFakePort({ workspace: WORKSPACE });
    port.getWorkspace = () => Promise.reject(new Error("boom"));
    const { result } = renderHook(() => useWorkspace(deps(port)));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toBe("boom");
    expect(result.current.workspace).toBeNull();
  });

  it("hands describeError the rejection, the translated 'failed to load workspace' fallback and the locale", async () => {
    const port = createFakePort({ workspace: WORKSPACE });
    port.getWorkspace = () => Promise.reject("network exploded");
    const spy = vi.fn(describeError);
    const { result } = renderHook(() => useWorkspace(deps(port, { locale: "es", describeError: spy })));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toBe("no se pudo cargar");
    expect(spy).toHaveBeenCalledWith({ e: "network exploded", fallback: "no se pudo cargar", locale: "es" });
  });
});

describe("useWorkspace — onSave", () => {
  async function loaded(overrides: Partial<WorkspaceDependencies> = {}) {
    const port = createFakePort({ workspace: WORKSPACE });
    const view = renderHook(() => useWorkspace(deps(port, overrides)));
    await waitFor(() => expect(view.result.current.workspace).not.toBeNull());
    return { port, view };
  }

  it("saves the CURRENT draft name/slug through the injected port, not the stale persisted ones", async () => {
    const { port, view } = await loaded();
    const updateSpy = vi.spyOn(port, "updateWorkspace");

    act(() => {
      view.result.current.setName("Renamed Site");
      view.result.current.setSlug("renamed-site");
    });

    const event = fakeSubmitEvent();
    await act(async () => view.result.current.onSave(event));

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(updateSpy).toHaveBeenCalledWith({ patch: { name: "Renamed Site", slug: "renamed-site" } });
    expect(view.result.current.workspace).toEqual({ ...WORKSPACE, name: "Renamed Site", slug: "renamed-site" });
    expect(view.result.current.saved).toBe(true);
    expect(view.result.current.saveError).toBeNull();
    // The fake's own `current` record actually mutated, not just what the hook echoed back.
    expect(port.current).toEqual({ ...WORKSPACE, name: "Renamed Site", slug: "renamed-site" });
  });

  it("sets saving=true for the duration of the port call, false once it settles", async () => {
    const { port, view } = await loaded();
    let resolveUpdate!: (v: { workspace: AdminWorkspace }) => void;
    port.updateWorkspace = () => new Promise((resolve) => (resolveUpdate = resolve));

    act(() => {
      void view.result.current.onSave(fakeSubmitEvent());
    });
    expect(view.result.current.saving).toBe(true);

    await waitFor(() => expect(resolveUpdate).toBeTypeOf("function"));
    await act(async () => {
      resolveUpdate({ workspace: WORKSPACE });
      await Promise.resolve();
    });
    expect(view.result.current.saving).toBe(false);
  });

  it("sets saveError (not error) on a failed save, leaving saved false and workspace unchanged", async () => {
    const { port, view } = await loaded();
    port.updateWorkspace = () => Promise.reject(new Error("slug already in use"));

    await act(async () => view.result.current.onSave(fakeSubmitEvent()));

    expect(view.result.current.saveError).toBe("slug already in use");
    expect(view.result.current.saved).toBe(false);
    expect(view.result.current.error).toBeNull();
    expect(view.result.current.workspace).toEqual(WORKSPACE);
  });

  it("hands describeError the translated 'failed to save workspace' fallback for a failed save", async () => {
    const spy = vi.fn(describeError);
    const { port, view } = await loaded({ describeError: spy });
    port.updateWorkspace = () => Promise.reject("offline");

    await act(async () => view.result.current.onSave(fakeSubmitEvent()));

    expect(view.result.current.saveError).toBe("failed to save workspace");
    expect(spy).toHaveBeenLastCalledWith({ e: "offline", fallback: "failed to save workspace", locale: "en" });
  });

  it("clears a prior saveError and saved flag at the start of a new save attempt", async () => {
    const { port, view } = await loaded();
    port.updateWorkspace = () => Promise.reject(new Error("first failure"));
    await act(async () => view.result.current.onSave(fakeSubmitEvent()));
    expect(view.result.current.saveError).toBe("first failure");

    let resolveUpdate!: (v: { workspace: AdminWorkspace }) => void;
    port.updateWorkspace = () => new Promise((resolve) => (resolveUpdate = resolve));
    let pending!: Promise<void>;
    act(() => { pending = view.result.current.onSave(fakeSubmitEvent()); });
    expect(view.result.current.saving).toBe(true);
    expect(view.result.current.saveError).toBeNull();
    expect(view.result.current.saved).toBe(false);
    await waitFor(() => expect(resolveUpdate).toBeTypeOf("function"));
    await act(async () => {
      resolveUpdate({ workspace: WORKSPACE });
      await pending;
    });
    expect(view.result.current.saved).toBe(true);

    // A successful attempt also leaves a flag that must clear before the next response.
    const previousResolve = resolveUpdate;
    act(() => { pending = view.result.current.onSave(fakeSubmitEvent()); });
    expect(view.result.current.saving).toBe(true);
    expect(view.result.current.saveError).toBeNull();
    expect(view.result.current.saved).toBe(false);
    await waitFor(() => expect(resolveUpdate).not.toBe(previousResolve));
    await act(async () => {
      resolveUpdate({ workspace: WORKSPACE });
      await pending;
    });
    expect(view.result.current.saved).toBe(true);
  });
});

describe("useWorkspace — t/locale (2026-08-11, standing i18n rule)", () => {
  it("t/locale reflect the injected locale, translating through the injected dictionary", async () => {
    const port = createFakePort({ workspace: WORKSPACE });
    const { result } = renderHook(() => useWorkspace(deps(port, { locale: "es" })));

    expect(result.current.locale).toBe("es");
    expect(result.current.t("Save changes")).toBe("Guardar cambios");
    await waitFor(() => expect(result.current.workspace).toEqual(WORKSPACE));
  });
});

describe("workspace cache and form drafts", () => {
  it("publishes a sibling save without replacing an unsaved rename", async () => {
    const port = createFakePort({ workspace: WORKSPACE });
    const { result } = renderHook(() => ({ first: useWorkspace(deps(port)), second: useWorkspace(deps(port)) }));
    await waitFor(() => expect(result.current.second.name).toBe(WORKSPACE.name));
    act(() => {
      result.current.first.setName("Published name");
      result.current.second.setName("My unsaved name");
    });
    await act(async () => { await result.current.first.onSave(fakeSubmitEvent()); });
    await waitFor(() => expect(result.current.second.workspace?.name).toBe("Published name"));
    expect(result.current.second.name).toBe("My unsaved name");
  });
});
