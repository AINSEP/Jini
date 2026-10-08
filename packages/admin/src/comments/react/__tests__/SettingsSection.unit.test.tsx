import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { assert, describe, expect, it, vi } from "vitest";

import { SettingsSection } from "./support.js";
import type { CommentSettingsController } from "./support.js";
import type { CommentsSettings } from "./support.js";

/**
 * @file First direct test for `SettingsSection` (previously module-private, only reachable through
 * `Comments`'s own render tree — `Comments.unit.test.tsx` keeps the full round-trip coverage). See
 * `QueueSection.unit.test.tsx`'s header for the shared rationale — same `AdminExecutionMode.unit
 * .test.tsx` precedent, same "renders from the injected fake, not a real round trip" assertion.
 */

const SETTINGS: CommentsSettings = {
  enabled: true,
  requireModeration: true,
  maxDepth: 5,
  closeAfterDays: null,
  spamAutoRejectScore: 0.9,
  maxPerIpPerHour: 10,
};

function fakeController(overrides: Partial<CommentSettingsController> = {}): CommentSettingsController {
  return {
    settings: SETTINGS,
    error: null,
    saving: false,
    notice: null,
    save: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("SettingsSection — useCommentSettingsHook injection", () => {
  it("renders the settings form from the injected fake, with no fetch involved", () => {
    render(<SettingsSection canConfigure locale="en" useCommentSettingsHook={() => fakeController()} />);

    // The real hook always starts `settings: null` until the load settles — the form (and its
    // seeded `enabled` checkbox) appearing synchronously, with no `fetch` mocked anywhere in this
    // file, is only possible via the fake.
    expect(screen.getByRole("checkbox", { name: /comments enabled/i })).toBeChecked();
  });

  it("shows the loading notice from the injected fake when settings is still null", () => {
    render(
      <SettingsSection canConfigure locale="en" useCommentSettingsHook={() => fakeController({ settings: null })} />,
    );

    expect(screen.getByText(/loading comments settings/i)).toBeInTheDocument();
  });

  it("renders nothing when canConfigure is false, regardless of the fake controller", () => {
    const { container } = render(
      <SettingsSection canConfigure={false} locale="en" useCommentSettingsHook={() => fakeController()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
  it("submits the edited real form fields under the names the settings patch reads", async () => {
    const user = userEvent.setup();
    const controller = fakeController();
    render(<SettingsSection canConfigure locale="en" useCommentSettingsHook={() => controller} />);

    await user.click(screen.getByRole("checkbox", { name: /comments enabled/i }));
    await user.click(screen.getByRole("checkbox", { name: /require moderation/i }));
    const fields = [
      [/max thread depth/i, "7"],
      [/close submissions after/i, "14"],
      [/spam auto-reject score/i, "0.8"],
      [/max submissions per ip/i, "20"],
    ] as const;
    for (const [name, value] of fields) {
      const input = screen.getByRole("spinbutton", { name });
      await user.clear(input);
      await user.type(input, value);
    }
    await user.click(screen.getByRole("button", { name: /save settings/i }));

    expect(controller.save).toHaveBeenCalledTimes(1);
    const saveCall = vi.mocked(controller.save).mock.calls[0];
    assert.isDefined(saveCall);
    const [form] = saveCall;
    expect(Object.fromEntries(form.entries())).toEqual({
      maxDepth: "7", closeAfterDays: "14", spamAutoRejectScore: "0.8", maxPerIpPerHour: "20",
    });

    await user.click(screen.getByRole("checkbox", { name: /comments enabled/i }));
    await user.click(screen.getByRole("checkbox", { name: /require moderation/i }));
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    expect(controller.save).toHaveBeenCalledTimes(2);
    const checkedSaveCall = vi.mocked(controller.save).mock.calls[1];
    assert.isDefined(checkedSaveCall);
    const [checkedForm] = checkedSaveCall;
    expect(checkedForm.get("enabled")).toBe("on");
    expect(checkedForm.get("requireModeration")).toBe("on");
  });

});
