import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { MediaEditDialog, type MediaEditDialogProps } from "../MediaEditDialog.js";

afterEach(cleanup);

test("saving style with the Alt field hidden preserves the initial alt", () => {
  const onSave = vi.fn();
  const useDialog: MediaEditDialogProps["useDialog"] = ({ initial, onSave }) => {
    const [cssClass, setCssClass] = useState(initial.cssClass ?? "");
    return { alt: initial.alt ?? "", cssClass, htmlAttributes: initial.htmlAttributes ?? "", setAlt: vi.fn(), setCssClass, setHtmlAttributes: vi.fn(), htmlAttributesError: null, save: () => onSave({ ...initial, cssClass }), t: ({ key }) => key };
  };
  const Dialog = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const view = render(<MediaEditDialog initial={{ alt: "keep alt", cssClass: "old", htmlAttributes: null }} onSave={onSave} onCancel={vi.fn()} showAlt={false} useDialog={useDialog} Dialog={Dialog} />);
  expect(view.queryByLabelText("Alt text (optional)")).toBeNull();
  fireEvent.change(view.getByLabelText("CSS class (optional)"), { target: { value: "new" } });
  fireEvent.click(view.getByText("Save"));
  expect(onSave).toHaveBeenCalledExactlyOnceWith({ alt: "keep alt", cssClass: "new", htmlAttributes: null });
});

test("edits visible alt and HTML attributes through their labeled controls and preserves the custom field slot", () => {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const useDialog: MediaEditDialogProps["useDialog"] = ({ initial, onSave }) => {
    const [alt, setAlt] = useState(initial.alt ?? "");
    const [htmlAttributes, setHtmlAttributes] = useState(initial.htmlAttributes ?? "");
    return { alt, setAlt, htmlAttributes, setHtmlAttributes, cssClass: initial.cssClass ?? "", setCssClass: vi.fn(),
      htmlAttributesError: htmlAttributes === "bad" ? "Use a name and value." : null,
      save: () => onSave({ ...initial, alt, htmlAttributes }), t: ({ key }) => key };
  };
  const Dialog: MediaEditDialogProps["Dialog"] = ({ title, children, onClose }) =>
    <section role="dialog" aria-label={title}><button onClick={onClose}>Close dialog</button>{children}</section>;
  const props = { initial: { alt: "Sea", cssClass: "lead-photo", htmlAttributes: "" }, onSave, onCancel, useDialog, Dialog };
  const view = render(<MediaEditDialog {...props}><p>Preview crop</p></MediaEditDialog>);
  expect(view.getByRole("dialog", { name: "Edit this instance" })).toContainElement(view.getByText("Preview crop"));
  const alt = view.getByLabelText("Alt text (optional)");
  expect(alt).toHaveAttribute("data-jini-autofocus", "");
  fireEvent.change(alt, { target: { value: "Waves at sunset" } });
  const attributes = view.getByLabelText("HTML attributes (optional)");
  fireEvent.change(attributes, { target: { value: "bad" } });
  expect(attributes).toHaveAttribute("aria-invalid", "true");
  expect(view.getByText("Use a name and value.")).toBeVisible();

  view.rerender(<MediaEditDialog {...props} renderHtmlAttributes={({ value, onChange }) =>
    <input aria-label="Custom attribute value" value={value} onChange={event => onChange(event.target.value)} />
  } />);
  const group = view.getByRole("group", { name: "HTML attributes (optional)" });
  const custom = view.getByRole("textbox", { name: "Custom attribute value" });
  expect(group).toContainElement(custom);
  expect(group).toContainElement(view.getByText("Use a name and value."));
  expect(custom).toHaveValue("bad");
  fireEvent.change(custom, { target: { value: 'data-motion="slow"' } });
  expect(view.queryByText("Use a name and value.")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Save" }));
  expect(onSave).toHaveBeenCalledExactlyOnceWith({ alt: "Waves at sunset", cssClass: "lead-photo", htmlAttributes: 'data-motion="slow"' });
  fireEvent.click(view.getByRole("button", { name: "Close dialog" }));
  expect(onCancel).toHaveBeenCalledExactlyOnceWith();
});
