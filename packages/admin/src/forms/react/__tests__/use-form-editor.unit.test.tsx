import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FetchQueryProvider } from "@jini-ai/ui/fetch-query";
import { useFormEditor } from "./legacy-ports.js";
import { createFakeFormsPort } from "./legacy-ports.js";
import type { AdminFormDefinition } from "../../models.js";

/**
 * @file `useFormEditor` — the FormEditor screen's load/save/status-toggle state.
 * `FormEditor.unit.test.tsx` already exercises the full UI flow through a stubbed `fetch`; this
 * file is the hook's own injected-port + injected-navigate coverage — see `forms-port.hooks.ts`
 * for why the injection exists.
 *
 * `fetch-query` migration (2026-08-12): every `renderHook` now needs `wrapper: FetchQueryProvider`
 * — see `redirects/__tests__/use-redirects.hooks.unit.test.tsx`'s identical wrapper for the pilot
 * precedent.
 */

function wrapper({ children }: { children: React.ReactNode }) {
  return <FetchQueryProvider>{children}</FetchQueryProvider>;
}

function formFixture(overrides: Partial<AdminFormDefinition> = {}): AdminFormDefinition {
  return {
    id: "f1",
    workspaceId: "fake-ws",
    name: "Contact",
    slug: "contact",
    fields: [{ id: "email", label: "Email", type: "email", required: true }],
    notify: { enabled: false, recipients: [] },
    status: "active",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useFormEditor — injected port + navigate + t", () => {
  it("loads an existing form from the fake port's seed, with no fetch involved", async () => {
    const networkMock = vi.fn();
    vi.stubGlobal("fetch", networkMock);
    const port = createFakeFormsPort({ forms: [formFixture()] });
    const navigate = vi.fn();
    const t = (key: string) => `[${key}]`;

    const { result } = renderHook(() => useFormEditor({ formId: "f1", tab: "fields" }, { port, navigate, t }), { wrapper });

    await waitFor(() => expect(result.current.form).not.toBeNull());
    expect(result.current.name).toBe("Contact");
    expect(networkMock).not.toHaveBeenCalled();
    // Proves `t` is the injected fake, not a real FORMS_DICT lookup — see use-forms-list.unit
    // .test.tsx's identical assertion for why this is the point, not incidental.
    expect(result.current.t("Save")).toBe("[Save]");
  });

  it("does not load for a new form (isNew), and creating one calls the injected navigate", async () => {
    const port = createFakeFormsPort();
    const navigate = vi.fn();
    const { result } = renderHook(
      () => useFormEditor({ formId: "new", tab: "fields" }, { port, navigate, t: (key: string) => key }),
      { wrapper },
    );

    expect(result.current.isNew).toBe(true);
    expect(result.current.form).toBeNull();

    act(() => {
      result.current.setName("Newsletter");
      result.current.setSlug("newsletter");
    });
    await act(async () => {
      await result.current.handleSave();
    });

    expect(navigate).toHaveBeenCalledTimes(1);
    // Slug, not id (ui-fixes-backlog.md #8) — `createFakeFormsPort.createForm` echoes back
    // `input.slug`, so this is "newsletter" (set via `setSlug` above), not the fake's own
    // generated "fake-1" id.
    expect(navigate).toHaveBeenCalledWith(expect.stringMatching(/^\/forms\/newsletter$/));
  });

  it("saving an existing form targets the loaded record's real id, even when the route param is a slug", async () => {
    // Simulates the admin URL now carrying a slug (ui-fixes-backlog.md #8): `formId` here is
    // "contact-us", NOT the fixture's real id "f1". Proves `handleSave`'s update mutation reads
    // `form.id`, never `props.formId`, for its write target.
    const port = createFakeFormsPort({ forms: [formFixture({ id: "f1", slug: "contact-us" })] });
    const navigate = vi.fn();
    const { result } = renderHook(
      () => useFormEditor({ formId: "contact-us", tab: "fields" }, { port, navigate, t: (key: string) => key }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.form).not.toBeNull());

    // Two `act()` calls, not one — matches the "does not load for a new form" test above:
    // `result.current` inside a single callback still points at the pre-update closure, so
    // `handleSave` would read `name` from before `setName`'s re-render if called in the same act.
    act(() => {
      result.current.setName("Contact (renamed)");
    });
    await act(async () => {
      await result.current.handleSave();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.form?.name).toBe("Contact (renamed)");
  });

  it("preserves an existing form's notify setting on save, even though the Fields tab no longer has any UI to edit it (owner ask 2026-09-22)", async () => {
    const port = createFakeFormsPort({
      forms: [formFixture({ notify: { enabled: true, recipients: ["owner@example.com"] } })],
    });
    const navigate = vi.fn();
    const { result } = renderHook(
      () => useFormEditor({ formId: "f1", tab: "fields" }, { port, navigate, t: (key: string) => key }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.form).not.toBeNull());

    // A save that only touches name/slug/fields must not go anywhere near `notify` — there is no
    // `setNotify`/`recipientsText` on this controller for the view to call any more.
    act(() => {
      result.current.setName("Contact (renamed)");
    });
    await act(async () => {
      await result.current.handleSave();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.form?.notify).toEqual({ enabled: true, recipients: ["owner@example.com"] });
  });

  it("handleStatusToggle flips status through the port for an existing form", async () => {
    const port = createFakeFormsPort({ forms: [formFixture({ status: "active" })] });
    const navigate = vi.fn();
    const { result } = renderHook(
      () => useFormEditor({ formId: "f1", tab: "fields" }, { port, navigate, t: (key: string) => key }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.form).not.toBeNull());

    await act(async () => {
      await result.current.handleStatusToggle();
    });

    expect(result.current.form?.status).toBe("disabled");
    expect(navigate).not.toHaveBeenCalled();
  });
});
