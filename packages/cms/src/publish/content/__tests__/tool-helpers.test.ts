import { expect, it } from "vitest";
import { acceptedPullReport, plainSentence, publishContentDerivedRisk, pullOverwriteKeys } from "../tool-helpers.js";
import type { PublishContentReport } from "../plan-rows.js";

it("a message with an underscore token falls back whole", () => {
  expect(plainSentence({ text: "Could not connect: PEER_NOT_FOUND.", fallback: "Try again." })).toBe("Try again.");
  expect(plainSentence({ text: "  Connected to Example.  ", fallback: "Try again." })).toBe("Connected to Example.");
});

it("a refused report throws instead of returning an empty plan", () => {
  const report: PublishContentReport = { refused: true, refusalReason: "refused", applyOrder: [], rows: [] };
  expect(() => acceptedPullReport({ report })).toThrow("refused");
});

it("1001 overwrite keys are refused", () => {
  expect(() => pullOverwriteKeys({ value: Array.from({ length: 1001 }, (_, i) => `post:${i}`) })).toThrow("at most 1000");
  expect(pullOverwriteKeys({ value: ["post:1"] })).toEqual(new Set(["post:1"]));
});

it("publish, plan, execute and connect are never `none`", () => {
  for (const id of ["publish_content_publish", "publish_content_plan_pull", "publish_content_execute_pull", "publish_content_connect"]) {
    expect(publishContentDerivedRisk.get(id)).toBe("mutates-durable-state");
  }
});
