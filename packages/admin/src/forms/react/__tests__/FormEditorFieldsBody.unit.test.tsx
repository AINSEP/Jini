import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AdminFormDefinition } from "../../models.js";
import { FormEditorFieldsBody, type FormEditorFieldsBodyProps } from "../components/FormEditorFieldsBody.js";

/**
 * @file `FormEditorFieldsBody` in isolation: the name/slug inputs, the Builder/HTML switch, and the
 * action row (copy embed, feedback, disable/enable, save/create) for new vs existing forms.
 */

const t = (key: string) => key;

function savedForm(status: AdminFormDefinition["status"]): AdminFormDefinition {
  return { id: "f1", name: "Contact", slug: "contact", status, fields: [], notify: { enabled: false, recipients: [] }, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
}

function props(overrides: Partial<FormEditorFieldsBodyProps> = {}): FormEditorFieldsBodyProps {
  return {
    name: "Contact", onNameChange: vi.fn(), slug: "contact", onSlugChange: vi.fn(), isNew: false,
    fields: [], existingFieldIds: [], onFieldsChange: vi.fn(), form: savedForm("active"), saving: false,
    onStatusToggle: vi.fn(), onSave: vi.fn(), t, mode: "builder", onModeChange: vi.fn(), html: "<form></form>",
    onHtmlChange: vi.fn(), onCopyEmbed: vi.fn(), copyFeedback: null, ...overrides,
  };
}

describe("FormEditorFieldsBody inputs", () => {
  it("explains live protection defaults, exported limits and embed requirements", () => {
    render(<FormEditorFieldsBody {...props()} />);
    expect(screen.getByText("Basic spam protection is on.").textContent).toBe("Basic spam protection is on.");
    expect(screen.getByText("Hidden-field checks, submission timing when available, duplicate suppression, and rate limits.").textContent).toBe("Hidden-field checks, submission timing when available, duplicate suppression, and rate limits.");
    expect(screen.getByText("Live server defaults: wait 1 second; up to 5 submissions per minute per IP address and form.").textContent).toBe("Live server defaults: wait 1 second; up to 5 submissions per minute per IP address and form.");
    expect(screen.getByText("Exported forms use their destination's protection; timing and duplicate suppression may be unavailable. Custom embeds need the generated hidden controls for hidden-field checks.").textContent).toBe("Exported forms use their destination's protection; timing and duplicate suppression may be unavailable. Custom embeds need the generated hidden controls for hidden-field checks.");
  });
  it("sends name and slug edits to their callbacks", () => {
    const p = props();
    render(<FormEditorFieldsBody {...p} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "N" } });
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "s" } });
    expect(p.onNameChange).toHaveBeenCalledWith("N");
    expect(p.onSlugChange).toHaveBeenCalledWith("s");
  });

  it("locks the slug for an existing form", () => {
    render(<FormEditorFieldsBody {...props()} />);
    expect((screen.getByLabelText("Slug") as HTMLInputElement).disabled).toBe(true);
  });

  it("keeps the slug editable for a new form", () => {
    render(<FormEditorFieldsBody {...props({ isNew: true, form: null })} />);
    expect((screen.getByLabelText("Slug") as HTMLInputElement).disabled).toBe(false);
  });
});

describe("FormEditorFieldsBody mode switch", () => {
  it("marks Builder pressed and shows the fields table in builder mode", () => {
    const { container } = render(<FormEditorFieldsBody {...props()} />);
    expect(screen.getByRole("button", { name: "Builder" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Builder" }).className).toBe("is-active");
    expect(screen.getByRole("button", { name: "HTML" }).getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector(".table-scroll")).not.toBeNull();
    expect(screen.queryByLabelText("Form HTML")).toBeNull();
  });

  it("marks HTML pressed and shows the source textarea in html mode", () => {
    const { container } = render(<FormEditorFieldsBody {...props({ mode: "html" })} />);
    expect(screen.getByRole("button", { name: "HTML" }).className).toBe("is-active");
    expect(screen.getByRole("button", { name: "Builder" }).className).toBe("");
    expect((screen.getByLabelText("Form HTML") as HTMLTextAreaElement).value).toBe("<form></form>");
    expect(container.querySelector(".table-scroll")).toBeNull();
  });

  it("reports mode clicks and HTML edits", () => {
    const p = props({ mode: "html" });
    render(<FormEditorFieldsBody {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Builder" }));
    fireEvent.click(screen.getByRole("button", { name: "HTML" }));
    fireEvent.change(screen.getByLabelText("Form HTML"), { target: { value: "<p>" } });
    expect(p.onModeChange).toHaveBeenNthCalledWith(1, "builder");
    expect(p.onModeChange).toHaveBeenNthCalledWith(2, "html");
    expect(p.onHtmlChange).toHaveBeenCalledWith("<p>");
  });
});

describe("FormEditorFieldsBody actions", () => {
  it("offers copy-embed, a warning Disable and Save for an active saved form", () => {
    const p = props();
    render(<FormEditorFieldsBody {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy HTML embed" }));
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("button", { name: "Disable" }).className).toBe("btn-warning");
    expect(p.onCopyEmbed).toHaveBeenCalledTimes(1);
    expect(p.onStatusToggle).toHaveBeenCalledTimes(1);
    expect(p.onSave).toHaveBeenCalledTimes(1);
  });

  it("offers a secondary Enable for a disabled saved form", () => {
    render(<FormEditorFieldsBody {...props({ form: savedForm("disabled") })} />);
    expect(screen.getByRole("button", { name: "Enable" }).className).toBe("btn-secondary");
  });

  it("shows only Create form for a new form with no saved definition", () => {
    render(<FormEditorFieldsBody {...props({ isNew: true, form: null })} />);
    expect(screen.queryByRole("button", { name: "Copy HTML embed" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Disable" })).toBeNull();
    expect(screen.getByRole("button", { name: "Create form" })).not.toBeNull();
  });

  it("hides the status toggle for a new form even when a definition is present", () => {
    render(<FormEditorFieldsBody {...props({ isNew: true })} />);
    expect(screen.queryByRole("button", { name: "Disable" })).toBeNull();
    expect(screen.getByRole("button", { name: "Copy HTML embed" })).not.toBeNull();
  });

  it("shows the copy feedback as a status message", () => {
    render(<FormEditorFieldsBody {...props({ copyFeedback: "Copied" })} />);
    expect(screen.getByRole("status").textContent).toBe("Copied");
  });

  it("disables the status toggle and save while saving", () => {
    render(<FormEditorFieldsBody {...props({ saving: true })} />);
    expect((screen.getByRole("button", { name: "Disable" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
