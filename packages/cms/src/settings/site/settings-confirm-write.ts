/** The human card behind the settings value-write tools' protected keys (`confirmWrite`). */
import type { AccessApprovalResource, ToolExecutionContext, ToolExecutionOptions, ToolHandler } from "@jini-ai/core";
import type { SettingsWriteConfirmation } from "@jini-ai/core/settings";
import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import type { SurfaceDetail } from "@jini-ai/core/contracts/cards";
import { prepareChatExecutionWrite } from "./chat-execution-write.js";
import type { SettingsToolDeps, ValidateRuntimeSelectionPort } from "./tool-deps.js";

/** The host's wording for the settings card (product copy the engine never ships). */
export interface SettingsConfirmWriteCopy {
  /** Prefix for the refusal code when no human can be asked. */
  readonly errorCode: string;
  readonly setTitle: string;
  readonly clearTitle: string;
  /** Appended verbatim to the protecting rule's reason. */
  readonly descriptionSuffix: string;
  /** The proposed value shown for a clear. */
  readonly clearProposed: string;
  readonly confirmLabel: string;
  readonly labels: {
    readonly plugin: string; readonly pluginVersion: string; readonly setting: string;
    readonly scope: string; readonly resultingSelection: string;
  };
}

/** The card the host's approval engine shows for one protected write. */
export interface SettingsConfirmCard {
  readonly toolId: string;
  readonly errorCode: string;
  readonly title: string;
  readonly description: string;
  readonly access: { resources: AccessApprovalResource[] };
  readonly details: SurfaceDetail[];
  readonly confirmLabel: string;
}

/** The invoking plugin's admitted identity, fixed before the card is shown. */
export interface SettingsConfirmPrepared {
  identityKey: string | undefined;
  identity: { key: string; label: string; version?: string } | undefined;
}

/** The host's approval-card engine, bound to one protected settings write. */
export type SettingsConfirmApprovalHandlerPort = (required: {
  surfaces: AssistantSurfaceDeps;
  prepare: (required: { ctx: ToolExecutionContext }) => Promise<SettingsConfirmPrepared>;
  describe: (required: { ctx: ToolExecutionContext; prepared: SettingsConfirmPrepared }) => SettingsConfirmCard;
  run: (required: { ctx: ToolExecutionContext; prepared: SettingsConfirmPrepared }) => Promise<unknown>;
}, optional: { declined: () => unknown }) => ToolHandler;

/** A `SettingsToolDeps.confirmWrite` implementation. `options` is
 * declared optional so this still type-checks against a @jini-ai/cms whose confirmWrite takes one argument. */
export type SettingsConfirmWriteFn = (request: SettingsWriteConfirmation, options?: ToolExecutionOptions) => Promise<boolean>;

/** Build the settings tools' `confirmWrite` over the host's card transport, wording and runtime check.
 * Card parameters carry only a decision, never replacement setting coordinates or values.
 * @returns A confirmWrite resolving to the human decision; transport and storage failures propagate.
 * @complexity O(1) construction; one bounded card exchange per protected write.
 * @example buildSettingsRegistrations({ ...routeDeps, confirmWrite: settingsConfirmWrite({ surfaces, routeDeps, approvalToolHandler, validateRuntimeSelection, copy }) })
 */
export function settingsConfirmWrite({ surfaces, routeDeps, approvalToolHandler, validateRuntimeSelection, copy }: {
  surfaces: AssistantSurfaceDeps;
  routeDeps: SettingsToolDeps;
  approvalToolHandler: SettingsConfirmApprovalHandlerPort;
  /** The agent runtime's selection validator, bound by the host (the same one its composer uses). */
  validateRuntimeSelection: ValidateRuntimeSelectionPort;
  copy: SettingsConfirmWriteCopy;
}, _options = {}): SettingsConfirmWriteFn {
  // `options` carries the transport's emitSurface; without it the card has no way to reach a human.
  // Declared optional so this still type-checks against a @jini-ai/cms whose confirmWrite takes one argument.
  return async ({ ctx, toolId, namespace, key, scope, previous, expectedRevisionSeq, value, reason }, options) => {
    const request = { ctx, toolId, namespace, key, scope, value };
    const selectionSnapshot = await prepareChatExecutionWrite({ deps: routeDeps, request, validateRuntimeSelection });
    // Enabling a plugin does not approve later setting changes; preserve its admitted identity
    // across the fresh card while the settings owner retains authorization and revision checks.
    const handler = approvalToolHandler({ surfaces,
      prepare: async ({ ctx: snapshot }) => {
        const identity = await routeDeps.approvalIdentityForRun?.({ ctx: snapshot });
        return { identityKey: identity?.key, identity };
      },
      describe: ({ prepared }) => {
        return { toolId, errorCode: copy.errorCode,
          title: toolId === "settings_set_value" ? copy.setTitle : copy.clearTitle,
          description: reason + copy.descriptionSuffix,
          access: { resources: [{
            id: `${namespace}.${key}:${scope}`, label: `${namespace}.${key}`,
            scope: { personId: ctx.principal.id, siteId: routeDeps.workspaceId },
            previous, proposed: toolId === "settings_clear_value" ? copy.clearProposed : value ?? null,
            revision: String(expectedRevisionSeq),
          }] },
          details: [...(prepared.identity ? [{ label: copy.labels.plugin, value: prepared.identity.label },
            ...(prepared.identity.version ? [{ label: copy.labels.pluginVersion, value: prepared.identity.version }] : [])] : []), { label: copy.labels.setting, value: `${namespace}.${key}` }, { label: copy.labels.scope, value: scope },
            ...(selectionSnapshot !== null ? [{ label: copy.labels.resultingSelection, value: JSON.parse(selectionSnapshot) }] : [])],
          confirmLabel: copy.confirmLabel,
        };
      },
      // The settings owner retains fresh authorization, layer-sequence and definition-version checks.
      run: async ({ ctx: snapshot, prepared }) => {
        // The model/effort depends on the selected runtime too. Consent must not drift to a
        // different selection if another picker changes it while this card is held open.
        const currentSelection = await prepareChatExecutionWrite({ deps: routeDeps, request: { ...request, ctx: snapshot }, validateRuntimeSelection });
        const currentKey = (await routeDeps.approvalIdentityForRun?.({ ctx: snapshot }))?.key;
        return { confirmed: !snapshot.signal.aborted && currentKey === prepared.identityKey && currentSelection === selectionSnapshot };
      },
    }, { declined: () => ({ confirmed: false }) });
    // No credentials enter this description; they use the secret-card engine and separate stores.
    const result = await handler(ctx, options) as { confirmed: boolean; key?: string };
    return result.confirmed;
  };
}
