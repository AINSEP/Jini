import type { ToolMetadataById } from "@jini-ai/core";
import type { ToolApprovalPolicy } from "@jini-ai/core/contracts/site/tool-metadata-approval-policy";

/** Routine registration declarations (P3-T4.T); shared placement rationale is in ./index.ts.
 *  `direct`: each writer holds its own call open for the human-confirm card, so remembered grants
 *  (the `policy` path) can never stand in for it. The three writers are redeemable and exchange-only:
 *  their click answers the parked call and can never execute a fresh one. `routine_list` only reads. */
export const toolMetadata = {
  routine_list: {
    search: {
      keywords: "routines list scheduled recurring ai jobs hourly daily weekly desktop schedule",
      queries: ["List my routines.", "What recurring AI jobs do I have scheduled?"],
    },
    approval: { class: "read", confirmation: "direct" },
  },
  routine_create: {
    search: {
      keywords: "routine create new schedule recurring ai job hourly daily weekdays weekly timezone prompt agent model",
      queries: ["Create a routine that runs every weekday morning.", "Schedule a recurring AI job."],
    },
    approval: { class: "edit", confirmation: "direct" },
    mcpUi: { redeemable: true, exchangeOnly: true },
  },
  routine_set_enabled: {
    search: {
      keywords: "routine pause resume enable disable turn on off scheduled recurring job",
      queries: ["Pause my daily routine.", "Resume the routine I paused."],
    },
    approval: { class: "edit", confirmation: "direct" },
    mcpUi: { redeemable: true, exchangeOnly: true },
  },
  routine_delete: {
    search: {
      keywords: "routine delete remove cancel scheduled recurring job",
      queries: ["Delete a routine.", "Remove the weekly routine."],
    },
    approval: { class: "edit", confirmation: "direct" },
    mcpUi: { redeemable: true, exchangeOnly: true },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;

/** The four routine tool ids, from the one declaration, so discovery filters never copy a literal list. */
export const ROUTINE_TOOL_IDS: ReadonlySet<string> = new Set(Object.keys(toolMetadata));
