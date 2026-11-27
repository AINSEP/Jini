// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { expect, it, vi } from "vitest";
import { SecretInput, secretToggleLabels } from "../SecretInput.js";

it("keeps a declared public field visible and editable without a reveal control", async () => {
  const user = userEvent.setup();
  const ref = createRef<HTMLInputElement>();
  const onRevealedChange = vi.fn();
  render(<><label htmlFor="account">Account</label>
    <SecretInput id="account" label="Account" secret={false} autoComplete="current-password"
      defaultValue="team" revealed={false} onRevealedChange={onRevealedChange} ref={ref} />
  </>);
  const input = screen.getByRole("textbox", { name: "Account" }) as HTMLInputElement;
  expect(ref.current).toBe(input);
  expect(input.type).toBe("text");
  expect(input.autocomplete).toBe("off");
  expect(screen.queryByRole("button")).toBeNull();
  await user.type(input, "-one");
  expect(input.value).toBe("team-one");
  expect(onRevealedChange.mock.calls).toEqual([]);
});

it("uses English when the document language is empty", () => {
  const root = document.documentElement;
  const previous = root.lang;
  try {
    root.lang = "";
    expect(secretToggleLabels({ label: "Access key" })).toEqual({ show: "Show Access key", hide: "Hide Access key" });
  } finally { root.lang = previous; }
});
