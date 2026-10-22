import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { assert, afterEach, describe, expect, it, vi } from "vitest";

import { FetchQueryProvider } from "@jini-ai/ui/fetch-query";
import { Redirects } from "./legacy-harness.js";
import { useRedirects } from "./legacy-harness.js";
import { createFakeRedirectsPort, defaultRedirectsPort } from "./legacy-harness.js";

/**
 * @file `Redirects` — the first component test for this screen. Drives the REAL `useRedirects`
 * hook through the `useRedirectsHook` seam against `createFakeRedirectsPort`, so this exercises
 * the real create-then-reset wiring end to end rather than a hand-typed `RedirectsController`
 * stub that could already assume the fix. `FetchQueryProvider` is required because `useRedirects`
 * calls the real `useFetchQuery`/`useFetchMutation`.
 *
 * Pins the fix for the "failed create wipes the operator's input" bug: `Redirects.tsx`'s inline
 * `onSubmit` used to call `e.currentTarget.reset()` unconditionally, synchronously, before
 * `createRedirect`'s fire-and-forget mutation had any chance to settle — so a REJECTED create
 * still cleared the form, discarding what the operator typed right when they needed it most (to
 * fix and resubmit). The fix moves the reset into `use-redirects.hooks.ts`'s `submitCreate`,
 * which only resets after `createRedirect` resolves `true`.
 */

describe("Publish section button (plan-publish-sections-2026-09-25.md §2 S3)", () => {
  it("renders the section's own Publish redirects button", async () => {
    const port = createFakeRedirectsPort();
    render(
      <FetchQueryProvider>
        <Redirects useRedirectsHook={() => useRedirects(port, (k) => k, "en")} />
      </FetchQueryProvider>,
    );

    expect(await screen.findByRole("button", { name: "Publish redirects" })).toBeInTheDocument();
  });
});

describe("Redirects — create form", () => {
  it("keeps the operator's input after a failed create, and shows the banner", async () => {
    const user = userEvent.setup();
    const port = {
      ...createFakeRedirectsPort(),
      createRedirect: vi.fn().mockRejectedValue(new Error("fromPattern '/old-path-x' conflicts with an existing rule")),
    };
    render(
      <FetchQueryProvider>
        <Redirects useRedirectsHook={() => useRedirects(port, (k) => k, "en")} />
      </FetchQueryProvider>,
    );

    await screen.findByLabelText("From path");
    await user.type(screen.getByLabelText("From path"), "/old-path-x");
    await user.type(screen.getByLabelText("To target"), "/new-path-x");
    await user.click(screen.getByRole("button", { name: "Add redirect" }));

    await screen.findByText("fromPattern '/old-path-x' conflicts with an existing rule");
    expect(port.createRedirect).toHaveBeenCalledWith(
      { matchType: "exact", fromPattern: "/old-path-x", toTarget: "/new-path-x", statusCode: 301 },
    );
    expect(screen.getByLabelText("From path")).toHaveValue("/old-path-x");
    expect(screen.getByLabelText("To target")).toHaveValue("/new-path-x");
  });

  it("clears the form after a successful create", async () => {
    const user = userEvent.setup();
    const port = createFakeRedirectsPort();
    render(
      <FetchQueryProvider>
        <Redirects useRedirectsHook={() => useRedirects(port, (k) => k, "en")} />
      </FetchQueryProvider>,
    );

    await screen.findByLabelText("From path");
    await user.type(screen.getByLabelText("From path"), "/old-path-y");
    await user.type(screen.getByLabelText("To target"), "/new-path-y");
    await user.click(screen.getByRole("button", { name: "Add redirect" }));

    await waitFor(() => expect(screen.getByLabelText("From path")).toHaveValue(""));
    expect(screen.getByLabelText("To target")).toHaveValue("");
    expect(port.rules).toHaveLength(1);
    expect(port.rules[0]).toMatchObject({ fromPattern: "/old-path-y", toTarget: "/new-path-y" });
  });
});


afterEach(() => vi.restoreAllMocks());

describe("Redirects — table actions and bulk import", () => {
  async function renderRule() {
    const port = createFakeRedirectsPort();
    const { data: rule } = await port.createRedirect({ matchType: "exact", fromPattern: "/old-ui", toTarget: "/new-ui", statusCode: 301 });
    render(<FetchQueryProvider><Redirects useRedirectsHook={() => useRedirects(port, (k) => k, "en")} /></FetchQueryProvider>);
    const row = (await screen.findByText("/old-ui")).closest("tr")!;
    return { port, rule, row };
  }

  it("disables the selected rule from its row menu, then deletes only after confirmation", async () => {
    const user = userEvent.setup();
    const { port, row } = await renderRule();
    await user.click(within(row).getByRole("button", { name: /Actions/ }));
    await user.click(screen.getByRole("menuitem", { name: "Disable" }));
    await waitFor(() => expect(within(row).getByText("disabled")).toBeInTheDocument());
    const [disabledRule] = (await port.listRedirects()).data;
    assert.isDefined(disabledRule);
    expect(disabledRule.status).toBe("disabled");
    await user.click(within(row).getByRole("button", { name: /Actions/ }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/old-ui/)).toBeInTheDocument();
    expect((await port.listRedirects()).data).toHaveLength(1);
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByText("/old-ui")).not.toBeInTheDocument());
    expect((await port.listRedirects()).data).toEqual([]);
  });

  it("loads a row's hit count and imports the JSON typed into the bulk form", async () => {
    const user = userEvent.setup();
    const { port, rule, row } = await renderRule();
    const hits = vi.spyOn(defaultRedirectsPort, "getRedirectHits").mockImplementation(async (id) => {
      expect(id).toBe(rule.id);
      return { data: { redirectId: id, workspaceId: "fake-ws", hitCount: 17, lastHitAt: null } };
    });
    const importing = vi.spyOn(defaultRedirectsPort, "importRedirects").mockImplementation(port.importRedirects);
    expect(hits).not.toHaveBeenCalled();
    await user.click(within(row).getByRole("button", { name: "Load hits" }));
    expect(await within(row).findByText("17")).toBeInTheDocument();
    await user.click(screen.getByText("Bulk import"));
    const batch = [{ matchType: "exact", fromPattern: "/import-old", toTarget: "/import-new", statusCode: 302 }];
    await user.type(screen.getByRole("textbox", { name: /JSON array/ }), JSON.stringify(batch).replace(/\[/g, "[[").replace(/\{/g, "{{"));
    await user.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(importing).toHaveBeenCalledWith(batch));
    const importedRow = (await screen.findByText("/import-old", { selector: "td" })).closest("tr")!;
    expect(within(importedRow).getByText("/import-new")).toBeInTheDocument();
    expect((await port.listRedirects()).data).toHaveLength(2);
  });
});
