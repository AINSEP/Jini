/** Closed admin input parsing and publication decisions shared by both admin transports. */
import type { VisitorToolChoice, VisitorToolDescriptor, VisitorToolsConfigureInput } from "@jini-ai/core/contracts/site/site-assistant-visitor-tools-management";
import type { VisitorToolsHostContract } from "./visitor-tools-contract.js";

const MODE_RANK = { off: 0, ask: 1, auto: 2 } as const;

/** Require a positive safe integer; zero cannot disable quotas (use Off). @complexity O(1). */
function positiveLimit({ value, visitorTools }: { value: unknown; visitorTools: VisitorToolsHostContract }, _options = {}): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new visitorTools.ValidationError("Limits must be positive safe whole numbers.");
  return value as number;
}

/** Parse a partial limit patch; omitted dimensions retain their current value. @complexity O(1). */
function limitsPatch({ value, visitorTools }: { value: unknown; visitorTools: VisitorToolsHostContract }, _options = {}) {
  const input = visitorTools.object({ value, keys: ["perIpPerHour", "perSitePerDay"] });
  if (!Object.keys(input).length) throw new visitorTools.ValidationError("Supply at least one limit.");
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, positiveLimit({ value, visitorTools })]));
}

/** Validate the optional mode independently of the partial-update shape. */
function parseMode({ value, visitorTools }: { value: unknown; visitorTools: VisitorToolsHostContract }, _options = {}): VisitorToolsConfigureInput["mode"] {
  if (value === undefined) return undefined;
  if (value !== "auto" && value !== "ask" && value !== "off") throw new visitorTools.ValidationError("Mode must be auto, ask or off.");
  return value;
}

/** Parse the complete transport contract; approval/identity flags cannot enter through input.
 * @throws the host's `visitorTools.ValidationError` for unknown/invalid fields. @complexity O(1).
 * @example parseVisitorToolsConfigure({ value: {toolId:"site", expectedRevisionSeq:0, mode:"off"}, visitorTools });
 */
export function parseVisitorToolsConfigure({ value, visitorTools }: { value: unknown; visitorTools: VisitorToolsHostContract }, _options = {}): VisitorToolsConfigureInput {
  const input = visitorTools.object({ value, keys: ["toolId", "expectedRevisionSeq", "mode", "limits"] });
  if (typeof input.toolId !== "string" || !/^[a-z][a-z0-9_.]{0,127}$/.test(input.toolId)) throw new visitorTools.ValidationError("Use a toolId from visitor_tools_list, or site.");
  if (!Number.isSafeInteger(input.expectedRevisionSeq) || (input.expectedRevisionSeq as number) < 0) throw new visitorTools.ValidationError("List visitor tools first and supply expectedRevisionSeq.");
  const mode = parseMode({ value: input.mode, visitorTools });
  if (input.mode === undefined && input.limits === undefined) throw new visitorTools.ValidationError("Supply mode or limits.");
  return { toolId: input.toolId, expectedRevisionSeq: input.expectedRevisionSeq as number,
    ...(mode === undefined ? {} : { mode }),
    ...(input.limits === undefined ? {} : { limits: limitsPatch({ value: input.limits, visitorTools }) }) };
}

/** Publication requires a fresh human card; reductions and reviewed public reads run directly.
 * MOVE: Saved plugin escalation grants never authorize publishing data to anonymous visitors.
 * @complexity O(1); two quota dimensions.
 * @example visitorToolsNeedsApproval({ tool, previous, next, visitorTools });
 */
export function visitorToolsNeedsApproval({ tool, previous, next, visitorTools }: {
  tool: VisitorToolDescriptor; previous: VisitorToolChoice; next: VisitorToolChoice; visitorTools: Pick<VisitorToolsHostContract, "defaultLimits">;
}, _options = {}): boolean {
  const defaults = visitorTools.defaultLimits;
  const raisedAboveDefaults = (Object.keys(defaults) as (keyof typeof defaults)[])
    .some(key => next.limits[key] > previous.limits[key] && next.limits[key] > defaults[key]);
  if (raisedAboveDefaults) return true;
  if (MODE_RANK[next.mode] <= MODE_RANK[previous.mode]) return false;
  return tool.source !== "builtin" || tool.effect !== "read";
}
