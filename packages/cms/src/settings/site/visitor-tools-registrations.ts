/** Admin assistant adapter; no public executor or generic settings path enters these handlers. */
import { buildDomainRegistrations, indexCatalogById, ToolInputError, type AccessApprovalResource, type AgentToolDefinition, type DerivedRiskByToolId, type ToolContributor, type ToolExecutionContext, type ToolHandler, type ToolMetadataById, type ToolRegistration } from "@jini-ai/core";
import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import type { PreparedVisitorToolsChange, VisitorToolsHostContract, VisitorToolsManagementPort } from "./visitor-tools-contract.js";
import { VisitorToolsRevisionConflictError } from "./visitor-tools-write.js";

export interface VisitorToolsToolDeps { readonly workspaceId: string; readonly visitorToolsManagement?: VisitorToolsManagementPort }

/** The human card `visitor_tool_configure` asks the host's approval engine to show. */
export interface VisitorToolsConfigureCard {
  readonly toolId: string;
  readonly errorCode: string;
  readonly title: string;
  readonly description: string;
  readonly details: { label: string; value: string }[];
  readonly confirmLabel: string;
  readonly access?: { resources: AccessApprovalResource[] };
}

/** The host's approval-card engine, bound to the prepared visitor-tools change. */
export type VisitorToolsApprovalHandlerPort = (required: {
  surfaces: AssistantSurfaceDeps;
  prepare: (required: { ctx: ToolExecutionContext }) => Promise<PreparedVisitorToolsChange>;
  describe: (required: { ctx: ToolExecutionContext; prepared: PreparedVisitorToolsChange }) => VisitorToolsConfigureCard;
  run: (required: { ctx: ToolExecutionContext; prepared: PreparedVisitorToolsChange }) => Promise<unknown>;
}, optional: { ask: (required: { prepared: PreparedVisitorToolsChange }) => boolean; remembered: undefined; flag: string }) => ToolHandler;

/** Everything the host binds once for the four visitor-tools tools. */
export interface VisitorToolsToolHostPolicy {
  /** The model-facing catalog (product copy) and the module it is declared in, for drift messages. */
  readonly catalog: readonly AgentToolDefinition[];
  readonly catalogModule: string;
  /** Host search vocabulary and reviewed approval policy. */
  readonly toolMetadata: ToolMetadataById;
  readonly approvalToolHandler: VisitorToolsApprovalHandlerPort;
  readonly visitorTools: Pick<VisitorToolsHostContract, "object" | "ValidationError">;
}

/** Derived from current handlers: only configure writes. T4 must change save/delete risk with its implementation. */
export const visitorToolsDerivedRisk: DerivedRiskByToolId = new Map([
  ["visitor_tools_list", "none"], ["visitor_tool_configure", "mutates-durable-state"], ["visitor_tool_save", "none"], ["visitor_tool_delete", "none"],
]);

/** Give the model actionable revision/input guidance; infrastructure/auth faults stay failures. */
async function toolResult({ run, hostPolicy }: { run: () => Promise<unknown>; hostPolicy: VisitorToolsToolHostPolicy }, _options = {}): Promise<unknown> {
  try { return await run(); } catch (error) {
    if (error instanceof VisitorToolsRevisionConflictError) return { changed: false, code: "VISITOR_TOOLS_REVISION_CONFLICT", reload: true, note: error.message };
    if (error instanceof hostPolicy.visitorTools.ValidationError) throw new ToolInputError({ message: error.message });
    throw error;
  }
}

/** Source publication disclosures stay attached to the fixed proposal, outside editable grants. */
function publicationDetails({ tool }: PreparedVisitorToolsChange["changes"][number], _options = {}) {
  return tool.publication ? [
    { label: "Sends requests to", value: tool.publication.endpoint },
    { label: "Uses credential", value: tool.publication.credentialId },
    { label: "Shares fields", value: tool.publication.returnedFields.join(", ") },
  ] : [];
}

/** Human labels keep policy implementation fields out of the approval display. */
function accessValue({ choice }: { choice: PreparedVisitorToolsChange["changes"][number]["next"] }, _options = {}) {
  const names = { off: "Off", ask: "Ask", auto: "Auto" };
  return { Mode: names[choice.mode], "Per visitor": `${choice.limits.perIpPerHour.toLocaleString("en-US")}/hour`,
    "Whole site": `${choice.limits.perSitePerDay.toLocaleString("en-US")}/day` };
}

/** Both the settings revision and source-owned contract remain bound by apply's comparison. */
function accessResource({ change, prepared, personId, siteId }: {
  change: PreparedVisitorToolsChange["changes"][number]; prepared: PreparedVisitorToolsChange; personId: string; siteId: string;
}, _options = {}): AccessApprovalResource {
  return { id: change.tool.id, label: change.tool.title, scope: { personId, siteId },
    previous: accessValue({ choice: change.previous }), proposed: accessValue({ choice: change.next }),
    revision: `${prepared.revisionSeq}:${change.tool.sourceRevision}` };
}

/** Build the reviewed four-tool catalog with the shared approval engine and an always-fresh card.
 * @throws ToolInputError for invalid input/uncomposed roots; permission/storage errors propagate.
 * @complexity O(1) registration; service operations are bounded to 128 tools.
 * @example buildVisitorToolsRegistrations({ deps: {workspaceId, visitorToolsManagement}, surfaces: {surfaceExchanges}, hostPolicy });
 */
export function buildVisitorToolsRegistrations({ deps, surfaces, hostPolicy }: {
  deps: VisitorToolsToolDeps; surfaces: AssistantSurfaceDeps; hostPolicy: VisitorToolsToolHostPolicy;
}, _options = {}): ToolRegistration[] {
  const { object } = hostPolicy.visitorTools;
  const service = (): VisitorToolsManagementPort => {
    if (!deps.visitorToolsManagement) throw new ToolInputError({ message: "Visitor-tools management is unavailable in this server." });
    return deps.visitorToolsManagement;
  };
  const configure = hostPolicy.approvalToolHandler({ surfaces,
    prepare: ({ ctx }) => service().prepare({ callerPrincipalId: ctx.principal.id, input: ctx.input }),
    describe: ({ ctx, prepared }) => ({ toolId: "visitor_tool_configure", errorCode: "VISITOR_TOOLS", title: "Change public visitor tool access?",
      description: "This changes what anonymous visitors may access. Your confirmation applies only to these changes and is never remembered.",
      details: prepared.changes.flatMap(change => publicationDetails(change)), confirmLabel: "Confirm public access",
      ...(prepared.requiresApproval ? { access: { resources: prepared.changes.map(change => accessResource({ change, prepared, personId: ctx.principal.id, siteId: deps.workspaceId })) } } : {}),
    }),
    run: ({ ctx, prepared }) => service().apply({ callerPrincipalId: ctx.principal.id, prepared }),
  }, { ask: ({ prepared }) => prepared.requiresApproval, remembered: undefined, flag: "changed" });
  const result = (run: () => Promise<unknown>) => toolResult({ run, hostPolicy });
  return buildDomainRegistrations({ domain: "visitor-tools", catalogModule: hostPolicy.catalogModule, metadata: hostPolicy.toolMetadata,
    catalog: indexCatalogById({ catalog: [...hostPolicy.catalog] }), derivedRisk: visitorToolsDerivedRisk,
    handlers: {
      visitor_tools_list: ctx => result(async () => {
        object({ value: ctx.input, keys: [] });
        return service().list({ callerPrincipalId: ctx.principal.id });
      }),
      visitor_tool_configure: (ctx, options) => result(() => configure(ctx, options)),
      visitor_tool_save: ctx => result(async () => {
        object({ value: ctx.input, keys: [] });
        await service().list({ callerPrincipalId: ctx.principal.id });
        return { available: false, code: "VISITOR_TOOLS_T4_REQUIRED" };
      }),
      visitor_tool_delete: ctx => result(async () => {
        const input = object({ value: ctx.input, keys: ["toolId"] });
        if (typeof input.toolId !== "string" || !input.toolId.trim()) throw new ToolInputError({ message: "Supply a created toolId. Deletion is deferred to T4." });
        await service().list({ callerPrincipalId: ctx.principal.id });
        return { available: false, code: "VISITOR_TOOLS_T4_REQUIRED" };
      }),
    } });
}

/** Explicit composition registration, with no import-time mutation; the host binds `hostPolicy` once. */
export function contributeVisitorTools({ hostPolicy }: { hostPolicy: VisitorToolsToolHostPolicy }, _options = {}): ToolContributor<VisitorToolsToolDeps, AssistantSurfaceDeps> {
  return { domain: "visitor-tools", build: (deps, surfaces) => buildVisitorToolsRegistrations({ deps, surfaces, hostPolicy }), risk: visitorToolsDerivedRisk };
}
