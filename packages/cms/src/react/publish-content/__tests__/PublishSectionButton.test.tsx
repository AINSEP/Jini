import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { agentHandle } from "@jini-ai/core/agent-handles";
import { describe, expect, it, vi } from "vitest";
import { PublishSectionButton, type PublishSectionButtonProps } from "../PublishSectionButton.js";

describe("PublishSectionButton", () => {
  it("renders nothing when the injected hook reports unavailable", () => {
    const { container } = render(<PublishSectionButton
      section="fixture-section"
      usePublishSectionButtonHook={() => ({ visible: false, label: "Unavailable", onClick: () => {} })}
      agentHandle={agentHandle}
      agentLabel="Fixture unavailable"
    />);
    expect(container).toBeEmptyDOMElement();
  });

  it("passes the section object, defaults to secondary and invokes the injected callback once", () => {
    const onClick = vi.fn();
    const usePublishSectionButtonHook = vi.fn<PublishSectionButtonProps<"fixture-section">["usePublishSectionButtonHook"]>(
      () => ({ visible: true, label: "Publish fixture", onClick }),
    );
    render(<PublishSectionButton section="fixture-section" usePublishSectionButtonHook={usePublishSectionButtonHook} agentHandle={agentHandle} agentLabel="Fixture publish action" />);
    expect(usePublishSectionButtonHook).toHaveBeenCalledExactlyOnceWith({ section: "fixture-section" });
    const button = screen.getByRole("button", { name: "Publish fixture" });
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("class", "btn-secondary");
    expect(button).toHaveAttribute("data-agent-element", "publish-section-fixture-section");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("preserves the custom class and supplied agent label", () => {
    render(<PublishSectionButton
      section="fixture-themes"
      className="btn-primary"
      usePublishSectionButtonHook={() => ({ visible: true, label: "Publish fixture themes", onClick: () => {} })}
      agentHandle={agentHandle}
      agentLabel="Fixture themes publish action"
    />);
    const button = screen.getByRole("button", { name: "Publish fixture themes" });
    expect(button).toHaveAttribute("class", "btn-primary");
    expect(button).toHaveAttribute("data-agent-label", "Fixture themes publish action");
  });
});
