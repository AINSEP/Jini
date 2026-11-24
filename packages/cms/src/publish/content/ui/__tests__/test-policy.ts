/**
 * @file A deliberately generic host policy for the neutral publish-content-ui tests: it proves the
 * module takes every table and every word from the injected policy rather than from anything baked in.
 */
import type { PublishReportPolicy } from "../report-rows.js";
import { definePublishSection } from "../sections.js";

export const TEST_SECTIONS = [
  definePublishSection({ id: "widgets", labelKey: "Ship widgets", descriptionKey: "Ships widgets.", typeLabelKeys: { widget: "Widget", gadget: "Gadget" }, typePluralLabelKeys: { widget: "Widgets", gadget: "Gadgets" } }),
  definePublishSection({ id: "gears", labelKey: "Ship gears", descriptionKey: "Ships gears.", typeLabelKeys: { gear: "Gear" }, typePluralLabelKeys: { gear: "Gears" } }),
] as const;

export const TEST_POLICY: PublishReportPolicy = {
  sections: TEST_SECTIONS,
  reasons: {
    alreadyFinalPrefix: "FINAL:",
    rewrites: [{ pattern: /^raw clash '.+'/, friendly: "friendly clash" }],
    namedFileRewrites: [{ pattern: /^big file "(.+)"$/, friendly: ({ name }: { name: string }) => `FINAL: too big (${name})` }],
    genericWrapPattern: /^(.+) failed: .+$/,
    genericWrapFriendly: ({ title }: { title: string }) => `${title} is not allowed`,
  },
  copy: {
    missingReason: "no reason on file",
    plannedLabelByOutcome: { created: "plan-new", applied: "plan-update", forced: "plan-overwrite", unchanged: "same", conflict: "skip", blocked: "skip" },
    completedLabelByOutcome: { created: "done-new", applied: "done-update", forced: "done-overwrite", unchanged: "same", conflict: "skip", blocked: "skip" },
    trashPlannedLabel: "plan-trash",
    trashCompletedLabel: "done-trash",
    shortIdLength: 4,
  },
  usedByNote: ({ types }: { types: ReadonlySet<string> }) => `used by ${[...types].sort().join("+")}`,
};
