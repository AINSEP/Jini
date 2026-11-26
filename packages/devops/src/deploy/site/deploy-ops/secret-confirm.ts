import type { ToolExecutionContext, ToolExecutionOptions, ToolHandler } from '@jini-ai/core';
import type { ChatDeleteSurfaceDeps } from '@jini-ai/core/contracts/site/daemon-surface-exchanges';
import type { HumanConfirmSpec } from '@jini-ai/core/contracts/site/human-confirm';
import type { SecretConfirm, SecretConfirmRequest, SecretNotConfirmed } from '../../ops-tool-contracts.js';

type Permit = (permission: string) => Promise<void>;
const TAKES_EFFECT: Record<SecretConfirmRequest["appliesOn"], string> = { "next-deploy": "on the next deploy", "vendor-restart": "after the platform restarts the app", immediately: "immediately" };
/** The card names exactly what runs; the permission is re-checked after the human answers. Literal tool ids keep the MCP-UI allowlist scan exact. */
export function secretConfirm({ ctx, surfaces, options, permit, deps }: { ctx: ToolExecutionContext; surfaces: ChatDeleteSurfaceDeps | undefined; options: ToolExecutionOptions | undefined; permit: Permit; deps: {
  removeDescription: string; replaceDescription: string;
  notConfirmedResult(input: { confirmed: false; reason: string }): SecretNotConfirmed;
  approvalToolHandler(steps: {
    surfaces: ChatDeleteSurfaceDeps;
    prepare(): Promise<SecretConfirmRequest>;
    describe(input: { prepared: SecretConfirmRequest }): HumanConfirmSpec;
    run(input: { ctx: ToolExecutionContext }): ReturnType<SecretConfirm>;
  }, optional: { declined(input: { reason: string }): Awaited<ReturnType<SecretConfirm>> }): ToolHandler;
} }, _options = {}): SecretConfirm | undefined {
  if (!surfaces) return undefined;
  const { approvalToolHandler, notConfirmedResult } = deps;
  const details = (request: SecretConfirmRequest) => [
    { label: "Count", value: "1" }, { label: "Platform", value: request.platform }, { label: "Target", value: request.target }, { label: "Secret", value: request.name },
    ...(request.source ? [{ label: "New value from", value: request.source }, { label: "Current value", value: request.comparison === "different" ? "different from the new value" : "could not be read to compare" }] : []),
    { label: "Takes effect", value: TAKES_EFFECT[request.appliesOn] },
  ];
  return async request => {
    // Only public target/name/source metadata enters the generic description. Values remain
    // inside the secret-card/provider engine; a create still needs no replacement approval.
    return approvalToolHandler({ surfaces,
      prepare: async () => request,
      describe: ({ prepared }) => prepared.action === "remove"
        ? { toolId: "deployment_ops_unset_secret", errorCode: "DEPLOY_OPS", title: `Remove secret ${prepared.name} from ${prepared.target}?`, description: deps.removeDescription, details: details(prepared), warning: "An app that still reads this variable may fail to boot after the next deploy.", danger: true, confirmLabel: "Remove secret" }
        : { toolId: "deployment_ops_set_secret", errorCode: "DEPLOY_OPS", title: `Replace secret ${prepared.name} on ${prepared.target}?`, description: deps.replaceDescription, details: details(prepared), danger: true, confirmLabel: "Replace secret" },
      run: async ({ ctx: snapshot }) => {
        await permit("custom-credentials.write");
        return snapshot.signal.aborted ? { confirmed: false, result: notConfirmedResult({ confirmed: false, reason: "abandoned" }) } : { confirmed: true };
      },
    }, { declined: ({ reason }) => ({ confirmed: false, result: notConfirmedResult({ confirmed: false, reason }) }) })(ctx, options) as ReturnType<SecretConfirm>;
  };
}

