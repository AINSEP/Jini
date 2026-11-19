import { reactModuleUi } from '../../../core/react/module-ui.js';
import { Component, Suspense, type ReactNode } from "react";
import { AdminConfigError } from '@jini-ai/core/admin-runtime';
import { cleanup, render, renderHook, screen } from "../../../__tests__/fetch-query-support.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchQueryProvider } from "@jini-ai/ui/fetch-query";
import { createAdmin } from "../../../core/module/create-admin.js";
import type { AdminFormDefinition as CoreForm } from "../../../core/ports/forms.js";
import { createMemoryFormsApi } from "../../adapters/memory.js";
import { forms, useFormsPorts } from "../index.js";
import { fakeFormsCatalog } from '../../__tests__/fakes/forms-catalog.js';

afterEach(cleanup);
const storedForm = (id: string, overrides: Partial<CoreForm> = {}): CoreForm => ({ id, name: id, slug: id, status: "active",
  fields: [{ id: "name", label: "Name", type: "text", required: false }], notify: { enabled: false, recipients: [] },
  createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", ...overrides });

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  override render() { return this.state.error ? <p role="alert">{this.state.error.message}</p> : this.props.children; }
}

describe("forms module editor page", () => {
  function mountEditor(pageProps: Record<string, unknown>) {
    const api = createMemoryFormsApi({}, { forms: [storedForm("f1", { name: "Contact" })] });
    const module = forms({ ui: reactModuleUi });
    const admin = createAdmin({ modules: [module.react.module], ports: { formsApi: api, formsCatalog: fakeFormsCatalog(), formsTrash: api.trash } }, { permissions: ["admin.forms.manage"] });
    const { Page, tabs } = module.react.pages.editor;
    const description = admin.describe().pages.find(page => page.id === "forms.editor")!;
    render(<FetchQueryProvider><module.react.Provider admin={admin}><Boundary><Suspense fallback="loading">
      <Page tabs={tabs} description={description} {...pageProps} />
      <tabs.fields params={{}} /><tabs.submissions params={{}} />
    </Suspense></Boundary></module.react.Provider></FetchQueryProvider>);
    return admin;
  }

  it("opens the editor for a formId prop", async () => {
    const admin = mountEditor({ formId: "f1" });
    expect(await screen.findByDisplayValue("Contact")).toBeVisible();
    admin.dispose();
  });

  it("opens the editor for a route param on the submissions tab", async () => {
    const admin = mountEditor({ params: { formId: "f1" }, requestedTab: "submissions" });
    expect(await screen.findByRole("tab", { name: "Submissions", selected: true })).toBeVisible();
    admin.dispose();
  });

  it("refuses to render the editor without a form id", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const admin = mountEditor({});
    expect(await screen.findByRole("alert")).toHaveTextContent("Forms editor page requires formId");
    admin.dispose();
  });

  it("fails loudly when forms hooks run outside the bound provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useFormsPorts())).toThrow(AdminConfigError);
    expect(() => renderHook(() => useFormsPorts())).toThrow(/React scope unavailable: forms/);
  });
});
