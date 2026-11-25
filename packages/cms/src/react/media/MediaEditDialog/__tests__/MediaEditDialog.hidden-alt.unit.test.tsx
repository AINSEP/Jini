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
