// @vitest-environment jsdom
import { cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstallTabCard, InstallTabFieldRow } from "../InstallTabCard.js";

/**
 * @file The install card's field row as a form: Enter or the button submits through the host's
 * handler, and without one the form never navigates the admin away (the browser's default submit).
 */

afterEach(cleanup);

describe("InstallTabFieldRow", () => {
  it("swallows the browser's default submit when the host gives no handler", () => {
    render(<InstallTabFieldRow inputId="url" label="GitHub URL" value="" onChange={() => {}} action={{ label: "Install" }} />);
    const form = screen.getByRole("button", { name: "Install" }).closest("form")!;
    const submit = createEvent.submit(form);
    fireEvent(form, submit);
    expect(submit.defaultPrevented).toBe(true);
  });

  it("hands a submit to the host's handler instead", () => {
    const onSubmit = vi.fn((event: { preventDefault(): void }) => event.preventDefault());
    render(<InstallTabFieldRow inputId="url" placeholder="Server path" value="" onChange={() => {}} onSubmit={onSubmit} />);
    // No label: the placeholder names the field, and there is no button beside it.
    const input = screen.getByRole("textbox", { name: "Server path" });
    expect(screen.queryByRole("button")).toBeNull();
    fireEvent.submit(input.closest("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("InstallTabCard", () => {
  it("titles its section and renders the lede and content", () => {
    render(<InstallTabCard titleId="t1" title="Add a skill" lede="From GitHub or a ZIP.">body</InstallTabCard>);
    expect(screen.getByRole("heading", { name: "Add a skill" })).toHaveAttribute("id", "t1");
    expect(screen.getByText("From GitHub or a ZIP.")).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });
});
