// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OwnerGrantStatus } from "../OwnerGrantStatus.js";

/** @file The owner-grant footer: busy copy only while busy, and each error as its own alert. */

const t = (key: string) => `tr:${key}`;

describe("OwnerGrantStatus", () => {
  it("translates the busy key only while busy", () => {
    const { rerender } = render(<OwnerGrantStatus t={t} busyKey="Saving…" busy loadError={null} saveError={null} />);
    expect(screen.getByRole("status")).toHaveTextContent("tr:Saving…");

    rerender(<OwnerGrantStatus t={t} busyKey="Saving…" busy={false} loadError={null} saveError={null} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows load and save failures as separate alerts, untranslated", () => {
    render(<OwnerGrantStatus t={t} busyKey="Saving…" busy={false} loadError="Could not load." saveError="Could not save." />);
    const alerts = screen.getAllByRole("alert");
    expect(alerts.map((alert) => alert.textContent)).toEqual(["Could not load.", "Could not save."]);
    for (const alert of alerts) expect(alert).toHaveClass("jini-save-error");
  });

  it("renders nothing when idle with no errors", () => {
    const { container } = render(<OwnerGrantStatus t={t} busyKey="Saving…" busy={false} loadError={null} saveError={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
