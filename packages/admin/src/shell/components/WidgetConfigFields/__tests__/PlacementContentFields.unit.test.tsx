// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PlacementContentFields, type PlacementContentEditorProps } from "../PlacementContentFields.js";

/**
 * @file "Content for this spot" markup against a fake content editor (its `ContentEditor` prop):
 * the radio pair picks between the widget's own content and a per-placement override, and only the
 * override mounts the editor, with the content, the content setter and `t` passed through.
 * Behaviour with the host's real editor is covered in the host's own test.
 */

afterEach(cleanup);

function FakeEditor({ widgetType, config, onChange, t }: PlacementContentEditorProps) {
  return (
    <textarea aria-label={t("HTML source")} data-widget-type={widgetType} value={String(config.html ?? "")}
      onChange={(event) => onChange({ ...config, html: event.target.value })} />
  );
}

function renderFields(custom: boolean, t?: (key: string) => string) {
  const calls: Array<[string, unknown]> = [];
  render(
    <PlacementContentFields
      widgetType="media"
      custom={custom}
      content={{ mode: "html", html: "<p>here</p>" }}
      setCustom={(next) => calls.push(["setCustom", next])}
      setContent={(next) => calls.push(["setContent", next])}
      ContentEditor={FakeEditor}
      {...(t ? { t } : {})}
    />,
  );
  return calls;
}

describe("PlacementContentFields", () => {
  it("defaults to the widget's own content, with no editor shown", () => {
    renderFields(false);
    expect(screen.getByRole("radio", { name: "Use the widget's content" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Custom for this post" })).not.toBeChecked();
    expect(screen.queryByLabelText("HTML source")).toBeNull();
  });

  it("choosing Custom asks the host to switch to custom content", () => {
    const calls = renderFields(false);
    fireEvent.click(screen.getByRole("radio", { name: "Custom for this post" }));
    expect(calls).toEqual([["setCustom", true]]);
  });

  it("mounts the host's editor for custom content and forwards its edits", () => {
    const calls = renderFields(true);
    expect(screen.getByRole("radio", { name: "Custom for this post" })).toBeChecked();
    const source = screen.getByLabelText("HTML source") as HTMLTextAreaElement;
    expect(source.value).toBe("<p>here</p>");
    expect(source).toHaveAttribute("data-widget-type", "media");
    fireEvent.change(source, { target: { value: "<p>there</p>" } });
    fireEvent.click(screen.getByRole("radio", { name: "Use the widget's content" }));
    expect(calls).toEqual([
      ["setContent", { mode: "html", html: "<p>there</p>" }],
      ["setCustom", false],
    ]);
  });

  it("renders only jini-prefixed classes on its own markup", () => {
    const { container } = render(
      <PlacementContentFields widgetType="media" custom={false} content={{}} setCustom={() => {}} setContent={() => {}} ContentEditor={FakeEditor} />,
    );
    expect(container.querySelector("fieldset")).toHaveClass("jini-widget-embed-content-choice");
    expect(container.querySelector("legend")).toHaveClass("jini-field-label");
  });

  it("translates the legend, the choices and the editor through the host's t", () => {
    renderFields(true, (key) => `«${key}»`);
    expect(screen.getByText("«Content for this spot»")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "«Custom for this post»" })).toBeInTheDocument();
    expect(screen.getByLabelText("«HTML source»")).toBeInTheDocument();
  });
});
