import { ToolInputError } from "@jini-ai/core";
import { expect, it } from "vitest";
import { acceptedPullReport, plainSentence, publishContentDerivedRisk, pullOverwriteKeys, pullCounts, pullTitle, requiredPullBundleId } from "../tool-helpers.js";
import type { PublishContentOutcomeRow, PublishContentReport } from "../plan-rows.js";

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

it("counts creates, updates including forced rows, unchanged and blocked independently of conflicts", () => {
  const rows: PublishContentOutcomeRow[] = (["created", "applied", "forced", "unchanged", "blocked", "blocked", "conflict"] as const)
    .map((outcome, index) => ({ entityType: "article", entityId: String(index), entityLabel: null, outcome,
      writes: ["created", "applied", "forced"].includes(outcome), reason: null, canOverwrite: false, retires: null }));
  expect(pullCounts({ report: { refused: false, refusalReason: null, applyOrder: ["article"], rows } })).toEqual({
    create: 1, update: 2, unchanged: 1, blocked: 2,
  });
});

it("uses a title when present and the full entity key when the title is absent", () => {
  const row: PublishContentOutcomeRow = { entityType: "article", entityId: "a-9", entityLabel: null, outcome: "created",
    writes: true, reason: null, canOverwrite: false, retires: null };
  expect(pullTitle({ row })).toBe("article:a-9");
  expect(pullTitle({ row: { ...row, entityLabel: "Ocean tides" } })).toBe("Ocean tides");
});

it.each([{ value: 71, key: "a number" }, { value: " \t", key: "whitespace" }])("rejects $key as a staged bundle ID", ({ value }) => {
  expect(() => requiredPullBundleId({ value })).toThrow(new ToolInputError({ message: "'bundleId' must be a non-empty string." }));
});

it("preserves the staged bundle identifier and treats an omitted overwrite list as empty", () => {
  expect(requiredPullBundleId({ value: "bundle-37" })).toBe("bundle-37");
  expect(pullOverwriteKeys({ value: undefined })).toEqual(new Set());
});

it.each([
  { value: "post:1", key: "a scalar key" },
  { value: ["post:1", 2, "post:3"], key: "a non-string item" },
  { value: ["post:1", "post:2", " "], key: "a blank item" },
])("rejects $key in the overwrite selection", ({ value }) => {
  expect(() => pullOverwriteKeys({ value })).toThrow(new ToolInputError({ message: "'overwriteEntityKeys' must be an array of at most 1000 non-empty strings." }));
});

it("refuses a remote report without a reason using plain fallback copy", () => {
  expect(() => acceptedPullReport({ report: { refused: true, refusalReason: null, applyOrder: [], rows: [] } }))
    .toThrow(new ToolInputError({ message: "The live content cannot be imported here." }));
});
