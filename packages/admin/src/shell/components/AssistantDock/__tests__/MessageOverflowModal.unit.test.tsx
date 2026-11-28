// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_ELEMENT_ATTRIBUTE, AGENT_LABEL_ATTRIBUTE, AGENT_ROLE_ATTRIBUTE, agentHandle } from "@jini-ai/core/agent-handles";

import type { KitChatTranslator } from "../../../../react/kit.js";
import { MessageOverflowModal } from "../MessageOverflowModal.js";
import type { useMessageOverflowModal } from "../MessageOverflowModal.hooks.js";

/**
 * @file `MessageOverflowModal`'s own rendering, with the `<dialog>` lifecycle hook injected as a fake
 * (its real behaviour is covered by MessageOverflowModal.hooks.unit.test.tsx).
 */

const t: KitChatTranslator = (key) => `tr:${key}`;
const useTHook = () => t;

function fakeModal() {
  const handleNativeCancel = vi.fn();
  const handleBackdropClick = vi.fn();
  const useModal = vi.fn<typeof useMessageOverflowModal>(() => ({ dialogRef: createRef<HTMLDialogElement>(), handleNativeCancel, handleBackdropClick }));
  return { useModal, handleNativeCancel, handleBackdropClick };
}

afterEach(cleanup);

describe("MessageOverflowModal", () => {
  it("names the dialog, shows its content, and closes from an untagged, translated close button", () => {
    const onClose = vi.fn();
    const { useModal, handleNativeCancel, handleBackdropClick } = fakeModal();
    const { container } = render(
      <MessageOverflowModal open title="Full table" onClose={onClose} useModal={useModal} useTHook={useTHook}>
        <p>row one</p>
      </MessageOverflowModal>,
    );
    expect(useModal).toHaveBeenCalledWith({ open: true, onClose });
    const dialog = container.querySelector("dialog")!;
    expect(dialog.getAttribute("aria-label")).toBe("Full table");
    expect(screen.getByText("row one").parentElement?.className).toBe("jini-message-overflow-modal-body");
    const close = screen.getByRole("button", { name: "tr:Close", hidden: true });
    expect(close.hasAttribute(AGENT_ELEMENT_ATTRIBUTE)).toBe(false);
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent(dialog, new Event("cancel"));
    expect(handleNativeCancel).toHaveBeenCalledOnce();
    // The close click bubbled to the dialog once; a direct dialog click reaches the backdrop handler again.
    fireEvent.click(dialog);
    expect(handleBackdropClick).toHaveBeenCalledTimes(2);
  });

  it("publishes the close button as an agent-addressable button with the translated label when tagging is supplied", () => {
    const { useModal } = fakeModal();
    const tagger = vi.fn(agentHandle);
    render(
      <MessageOverflowModal open title="Full table" onClose={vi.fn()} useModal={useModal} useTHook={useTHook} agentHandle={{ handle: "overflow-close", agentHandle: tagger }}>
        <p>row one</p>
      </MessageOverflowModal>,
    );
    expect(tagger).toHaveBeenCalledExactlyOnceWith({ handle: "overflow-close" }, { role: "button", label: "tr:Close" });
    const close = screen.getByRole("button", { name: "tr:Close", hidden: true });
    expect(close.getAttribute(AGENT_ELEMENT_ATTRIBUTE)).toBe("overflow-close");
    expect(close.getAttribute(AGENT_ROLE_ATTRIBUTE)).toBe("button");
    expect(close.getAttribute(AGENT_LABEL_ATTRIBUTE)).toBe("tr:Close");
  });
});
