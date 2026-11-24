// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

/**
 * @file `SlowRunNoticeCard` — the inline transcript rendering of Jini's slow-run notice (a
 * `type: 'slow_running'` agent event, routed here through the `ext` renderer registry rather than
 * the pre-existing, nowhere-rendered `'status'` kind — see the component's own doc). No real
 * `@jini-ai/chat/react` component is mounted underneath it (unlike `OverflowAwareMcpUiSurfaceCard`'s
 * `McpUiSurfaceCard`), so only the injected `useTHook` needs a fake here, matching that sibling test file's own
 * "identity translation" convention.
 */


import { SlowRunNoticeCard } from "../SlowRunNoticeCard.js";
import { isSlowRunNoticeVisible, resolveSlowRunDetail } from "../SlowRunNoticeCard.hooks.js";

afterEach(() => {
  cleanup();
});

describe("resolveSlowRunDetail", () => {
  it("returns the latest event's detail text", () => {
    const events = [
      { type: "slow_running", detail: "first stall" },
      { type: "slow_running", detail: "second stall" },
    ];
    expect(resolveSlowRunDetail(events)).toBe("second stall");
  });

  it("returns undefined for an empty events array", () => {
    expect(resolveSlowRunDetail([])).toBeUndefined();
  });

  it("returns undefined when the latest entry has no detail field", () => {
    expect(resolveSlowRunDetail([{ type: "slow_running" }])).toBeUndefined();
  });

  it("returns undefined rather than trusting a non-string detail — untyped wire data, never assumed well-formed", () => {
    expect(resolveSlowRunDetail([{ type: "slow_running", detail: 12345 }])).toBeUndefined();
  });

  it("returns undefined for an empty-string detail rather than rendering a blank line", () => {
    expect(resolveSlowRunDetail([{ type: "slow_running", detail: "" }])).toBeUndefined();
  });
});

describe("isSlowRunNoticeVisible", () => {
  it("is visible while the run is still streaming and has not (yet) succeeded", () => {
    expect(isSlowRunNoticeVisible({ runStreaming: true, runSucceeded: false })).toBe(true);
  });

  it("hides once the run has finished successfully — 'still working' is no longer true", () => {
    expect(isSlowRunNoticeVisible({ runStreaming: false, runSucceeded: true })).toBe(false);
  });

  it("hides once the run has ended without succeeding (failed or aborted), not only on success", () => {
    expect(isSlowRunNoticeVisible({ runStreaming: false, runSucceeded: false })).toBe(false);
  });

  it("hides even mid-stream if runSucceeded is (incorrectly) reported true — never trusts one flag alone", () => {
    expect(isSlowRunNoticeVisible({ runStreaming: true, runSucceeded: true })).toBe(false);
  });
});

describe("SlowRunNoticeCard", () => {
  const baseProps = { name: "slow_running", runStreaming: true, runSucceeded: false, runId: "run-1",
    useTHook: () => (key: string) => key };

  it("renders the daemon-supplied detail text as a status line", () => {
    render(
      <SlowRunNoticeCard
        {...baseProps}
        events={[{ type: "slow_running", detail: "Still working — this turn is taking longer than usual." }]}
      />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Still working — this turn is taking longer than usual.");
  });

  it("falls back to the translated default copy when the event carries no usable detail", () => {
    render(<SlowRunNoticeCard {...baseProps} events={[{ type: "slow_running" }]} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Still working — this is taking longer than usual.");
  });

  it("renders nothing once the run has completed successfully, even with a stall event still in the transcript", () => {
    render(
      <SlowRunNoticeCard
        {...baseProps}
        runStreaming={false}
        runSucceeded={true}
        events={[{ type: "slow_running", detail: "Still working — this turn is taking longer than usual." }]}
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  // Demo dry-run 2026-10-05: the "Connect GitHub" credential form sat waiting for the owner while
  // this line said the turn was taking longer than usual, so a run waiting on a person looked hung.
  it("renders nothing while the run is awaiting the person's answer to an open form or card", () => {
    render(
      <SlowRunNoticeCard
        {...baseProps}
        awaitingAnswer
        events={[{ type: "slow_running", detail: "Still working — this turn is taking longer than usual." }]}
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders nothing once the run has ended without succeeding — a finished run is never 'still working'", () => {
    render(<SlowRunNoticeCard {...baseProps} runStreaming={false} runSucceeded={false} events={[{ type: "slow_running" }]} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
