import { createHash } from 'node:crypto';
import { ToolInputError } from '@jini-ai/core';
import { describeErrorForLog } from '@jini-ai/core/model-facing-tool-errors';
import type { DeployTargetInspection } from '@jini-ai/devops/deploy/site/deploy-targets/types';
import type { FormDestinationForm } from '@jini-ai/core/contracts/site/cms-forms';
import { planStaticPublish, type StaticPublishDeps } from './adapter.js';
import { redactDeployTargetMessage, toDeployTargetCredential } from './credentials.js';
import type { StaticPublishConfig } from '@jini-ai/devops/deploy/site/static-publish/types';

export interface StaticPublishInspectionInput {
  readonly workspaceId: string;
  readonly config: StaticPublishConfig;
  readonly projectName: string;
  readonly credentialId?: string;
}
export interface StaticPublishInspection {
  readonly inspection?: DeployTargetInspection;
  readonly credentialId?: string;
  /** Internal binding only; never returned to a model or browser. */
  readonly credentialBinding?: string;
}

/** Provider inspection is an explicit authenticated READ, unlike the local readiness check.
 * Reuses the exact workspace/worksFor-aware credential resolver used by execution. Secrets remain
 * server-side; providers without inspection retain their existing non-decrypting preview behavior.
 * @complexity One registry/credential read plus the plugin's bounded inventory reads. */
export async function inspectStaticPublish({ deps, input }: { deps: StaticPublishDeps; input: StaticPublishInspectionInput }, _options = {}): Promise<StaticPublishInspection> {
  const registry = await deps.loadDeployTargets({ workspaceId: input.workspaceId });
  const plan = planStaticPublish({ registry, config: input.config });
  if (!plan.ok) throw new ToolInputError({ message: plan.message });
  if (!plan.target.module.preview) return {};
  // Callers without a project label (the admin Static Site card) keep the local-only preview they
  // had before provider inspection existed; only a domain review cannot be answered without one.
  if (!input.projectName.trim()) {
    if (!input.config.customDomain) return {};
    throw new ToolInputError({ message: 'PROJECT_NAME_REQUIRED: A custom-domain preview needs projectName. Pass the same project name to preview and execute.' });
  }
  const resolved = await resolveInspectionCredential({ deps, input });
  if (!resolved.ok) throw new ToolInputError({ message: `NO_CREDENTIALS_CONFIGURED: ${resolved.reason}` });
  const credential = toDeployTargetCredential(resolved);
  const kit = deps.hostKit ?? deps.createDeployHostKit({ observability: deps.observability });
  const forms = await previewFormDestination({ deps, input, kit });
  try {
    const hostInspection = await plan.target.module.preview({ credential, config: input.config, projectName: input.projectName, kit, ...forms.hostInput });
    return { inspection: forms.addFormLine({ inspection: hostInspection }), credentialId: resolved.credentialId,
      credentialBinding: createHash('sha256').update(JSON.stringify(credential)).digest('hex') };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Provider inspection failed. Check the connection and preview again.';
    throw new ToolInputError({ message: redactDeployTargetMessage({ message, credential: resolved, target: plan.target }) });
  }
}

/** The site's active forms for a preview: handed to the host when its deployment carries the
 * selected co-hosted receiver, otherwise core's own form line (external, off or refused). Forms
 * only: the receiver key is never read or created by a preview.
 * @complexity One forms read when the port is wired, plus a registry load and setting read with forms. */
async function previewFormDestination({ deps, input, kit }: { deps: StaticPublishDeps; input: StaticPublishInspectionInput; kit: NonNullable<StaticPublishDeps['hostKit']> }, _options = {}): Promise<{
  hostInput: { formDestination?: { readonly forms: readonly FormDestinationForm[] } };
  addFormLine: (required: { inspection: DeployTargetInspection }, options?: object) => DeployTargetInspection;
}> {
  const forms = deps.formDestination
    ? await deps.formDestination.previewInput({ workspaceId: input.workspaceId, hostingTargetId: input.config.target, projectName: input.projectName, kit })
    : {};
  const { hosting, formSubmissions } = forms;
  return { hostInput: hosting ? { formDestination: hosting } : {},
    addFormLine: ({ inspection }, _options = {}) => (formSubmissions ? { ...inspection, formSubmissions } : inspection) };
}

async function resolveInspectionCredential({ deps, input }: { deps: StaticPublishDeps; input: StaticPublishInspectionInput }, _options = {}) {
  try {
    return await deps.credentialSource.resolve({ workspaceId: input.workspaceId, target: input.config.target,
      ...(input.credentialId !== undefined ? { credentialId: input.credentialId } : {}) });
  } catch (error) {
    deps.warn('[static-publish] saved connection could not be resolved for inspection', describeErrorForLog({ err: error }));
    throw new ToolInputError({ message: 'CREDENTIAL_RESOLUTION_FAILED: The saved connection could not be opened. Reopen the secure connection form and select or repair it before previewing again.' });
  }
}
