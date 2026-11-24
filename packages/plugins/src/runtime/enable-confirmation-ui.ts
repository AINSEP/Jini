import type { AccessApprovalResource } from '@jini-ai/core';
import type { HumanConfirmSpec } from '@jini-ai/core/contracts/site/human-confirm';
import { PLUGINS_SET_ENABLED_TOOL_ID, type PluginFamily } from './agent-tools.js';


/** What the dialog needs to describe truthfully what is about to be switched on. */
export interface EnableConfirmationSubject {
  readonly family: PluginFamily;
  readonly pluginId: string;
  /** The human-readable name, when the family's read model has one distinct from the id. */
  readonly label?: string;
  readonly version?: string;
  /** Site plugins: capability entries beyond the owner's last approval (all of them the first time). */
  readonly adds?: readonly string[];
  readonly previousEnabled?: boolean | null;
  readonly revision?: string;
  readonly resources?: readonly Omit<AccessApprovalResource, 'scope'>[];
}


/** Per-family wording. Kept as data rather than branches inside the builder so the two families'
 *  copy can be read side by side and neither can silently inherit the other's claims. */
const FAMILY_COPY: Record<PluginFamily, { readonly noun: string; readonly warning: string }> = {
  "agent-plugin": {
    noun: "Agent Plugin",
    warning:
      "This lets the assistant use this plugin's guidance and tools. Each action still follows your access settings.",
  },
  "site-runtime": {
    noun: "site plugin",
    warning:
      "It gets full server access: it can run code on your site and change its database. Enable it only if you trust it.",
  },
};


/**
 * Describes the enable-confirmation dialog for the shared approval transport.
 *
 * @param spec.subject - What the human is being asked about. The plugin is NAMED, because a dialog
 * that says "enable this plugin?" without saying which one is not consent.
 * @complexity O(n) in the rendered field lengths.
 */
export function describeEnableApproval({ subject, scope }: { subject: EnableConfirmationSubject; scope?: AccessApprovalResource['scope'] }, _optional = {}): HumanConfirmSpec {
  const copy = FAMILY_COPY[subject.family];
  const explanation = copy.warning + " Only the listed access is turned on. A browser sign-in may still be needed to connect your account.";
  // An Agent Plugin's sentence explains; only a site plugin's (full server access) is a real warning.
  const explain = subject.family === "agent-plugin" ? { notice: explanation } : { warning: explanation };
  return {
    toolId: PLUGINS_SET_ENABLED_TOOL_ID, errorCode: "PLUGINS",
    // The title names the plugin; nothing below repeats it unless its id differs from the name shown.
    title: `Enable ${subject.label ?? subject.pluginId}?`,
    description: `This turns on this ${copy.noun} for this workspace.`,
    ...(scope ? { access: { resources: pluginEnableAccessResources({ subject, scope }) },
      // The plugin's own access rows (family, capabilities) restate Kind and Adds below; its other resources still show.
      accessRowsStatedInDetails: [pluginResourceId(subject)] } : {}),
    details: [
      ...(subject.label !== undefined && subject.label !== subject.pluginId ? [{ label: "Plugin", value: subject.pluginId }] : []),
      { label: "Kind", value: copy.noun },
      ...(subject.version === undefined ? [] : [{ label: "Version", value: subject.version }]),
      ...(subject.adds?.length ? [{ label: "Adds", value: subject.adds.join(", ") }] : []),
    ],
    ...explain, confirmLabel: "Enable",
    // Cancelling posts back and resolves the parked call immediately, rather than stranding it.
    cancelLabel: "Cancel",
  };
}


function pluginResourceId(subject: EnableConfirmationSubject, _options = {}): string {
  return `plugin:${subject.family}:${subject.pluginId}`;
}


/** Translate the frozen domain proposal into the common access disclosure. */
function pluginEnableAccessResources({ subject, scope }: { subject: EnableConfirmationSubject; scope: AccessApprovalResource['scope'] }, _options = {}): readonly AccessApprovalResource[] {
  return [{ id: pluginResourceId(subject), label: subject.label ?? subject.pluginId,
    scope, previous: { enabled: subject.previousEnabled ?? null }, proposed: { enabled: true, family: subject.family, capabilities: subject.adds ?? [] }, revision: subject.revision ?? null },
    ...(subject.resources ?? []).map(resource => ({ ...resource, scope }))];
}
