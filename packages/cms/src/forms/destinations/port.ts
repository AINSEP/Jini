import { assertSubmitUrl } from "./rewrite-actions.js";
import { selectFormReceiver, type FormReceiverSelection } from "./select.js";
import type { FormDestinationRegistry, LoadedFormDestination } from "../index.js";
import type { FormDestinationCredential, FormDestinationForm, FormReceiverPlan, FormReceiverPort, FormSubmissionsInspection } from "@jini-ai/core/contracts/site/cms-forms";

/**
 * @file The publish-side form receiver port static publishing calls: the site's active forms, the
 * receiver its `core.forms` setting selects for this host (`./select.ts`), that receiver's key
 * (`./key-store.ts`), and, for an external receiver, the destination's own `prepare`. Static
 * publishing sees only the result, so no form or vendor logic lives in hosting.
 */
export interface FormDestinationPortDeps {
  readonly listForms: (required: { readonly workspaceId: string }) => Promise<readonly FormDestinationForm[]>;
  readonly hasExistingKey: (required: { workspaceId: string; hostingTargetId: string }) => Promise<boolean>;
  readonly readExistingKey: (required: { workspaceId: string; hostingTargetId: string }) => Promise<string | undefined>;
  readonly resolveCredential: (required: { workspaceId: string; label: string }) => Promise<FormDestinationCredential | null>;
  readonly formReceiverKey: (required: { workspaceId: string; scope: Extract<FormReceiverSelection, { scope: unknown }>["scope"] }, optional?: { newSecret?: () => string }) => Promise<{ secret: string; save: NonNullable<FormReceiverPlan["save"]> }>;
  readonly noReceiverMessage: (required: { reason: string }) => string;
  readonly missingCredentialMessage: (required: { id: string; label: string }) => string;
  readonly loadRegistry: (required: { readonly workspaceId: string }) => Promise<FormDestinationRegistry>;
  /** The site's `core.forms` `receiver` value; undefined = unset (auto). */
  readonly readSetting: (required: { readonly workspaceId: string }) => Promise<string | undefined>;
}
type PortInput = Parameters<FormReceiverPort["prepare"]>[0];

/** Build the receiver port; an empty form list retains only a previously saved receiver key.
 * @complexity O(1) to build; calls read forms and either registry/settings or existing key metadata.
 * @overallScore 98 — Minor: the existing shared credential API lists metadata to detect a saved key. */
export function createFormDestinationPort(required: FormDestinationPortDeps, optional: { newSecret?: () => string } = {}): FormReceiverPort {
  return {
    async previewInput(input) {
      const forms = await required.listForms({ workspaceId: input.workspaceId });
      if (forms.length === 0) {
        const saved = await required.hasExistingKey({ workspaceId: input.workspaceId, hostingTargetId: input.hostingTargetId });
        return saved ? { hosting: { forms } } : {};
      }
      return previewFor({ deps: required, input, forms, selection: await selectFor({ deps: required, input }) });
    },
    async prepare(input) {
      const forms = await required.listForms({ workspaceId: input.workspaceId });
      // A provider switch can leave pending answers in the old co-hosted receiver. Retain its
      // existing key without creating a key or provisioning a new receiver for form-less sites.
      if (forms.length === 0) {
        const saved = await required.readExistingKey({ workspaceId: input.workspaceId, hostingTargetId: input.hostingTargetId });
        return { hosting: { forms, ...(saved ? { secret: saved } : {}) } };
      }
      return planFor({ deps: required, input, forms, selection: await selectFor({ deps: required, input }) }, optional);
    },
  };
}

/** @complexity One registry load plus one setting read. */
async function selectFor({ deps, input }: { deps: FormDestinationPortDeps; input: PortInput }, _optional = {}): Promise<FormReceiverSelection> {
  const [registry, setting] = await Promise.all([deps.loadRegistry({ workspaceId: input.workspaceId }), deps.readSetting({ workspaceId: input.workspaceId })]);
  return selectFormReceiver({ registry, setting, hostingTargetId: input.hostingTargetId });
}

/** What a preview hands the host, or the form line core answers itself. Never touches the key.
 * @complexity O(1) plus an external destination's own preview. */
async function previewFor(
  required: { deps: FormDestinationPortDeps; input: PortInput; forms: readonly FormDestinationForm[]; selection: FormReceiverSelection },
  _optional: Record<string, never> = {},
): Promise<Awaited<ReturnType<FormReceiverPort["previewInput"]>>> {
  const { deps, input, forms, selection } = required;
  if (selection.kind === "co-hosted") return { hosting: { forms } };
  if (selection.kind === "none") return { formSubmissions: off({ forms, message: deps.noReceiverMessage({ reason: selection.reason }) }) };
  if (selection.kind === "refused") return { formSubmissions: off({ forms, message: `Form submissions: ${selection.message}.` }) };
  try {
    const credential = await destinationCredential({ deps, workspaceId: input.workspaceId, destination: selection.destination });
    const { module, descriptor } = selection.destination;
    return { formSubmissions: module.preview
      ? await module.preview({ kit: input.kit, forms, site: { projectName: input.projectName }, ...(credential ? { credential } : {}) })
      : { status: "on", forms: forms.length, message: `Form submissions: on (${forms.length} forms), received by ${descriptor.label}.`, changes: [] } };
  } catch (error) {
    return { formSubmissions: off({ forms, message: `Form submissions: ${error instanceof Error ? error.message : String(error)}.` }) };
  }
}

/** What a publish does with the forms. Throws a person-facing Error for a refused selection.
 * @complexity One key read, plus an external destination's own prepare. */
async function planFor(
  required: { deps: FormDestinationPortDeps; input: PortInput; forms: readonly FormDestinationForm[]; selection: FormReceiverSelection },
  optional: { newSecret?: () => string },
): Promise<FormReceiverPlan> {
  const { deps, input, forms, selection } = required;
  if (selection.kind === "none") return {};
  if (selection.kind === "refused") throw new Error(selection.message);
  const key = await deps.formReceiverKey({ workspaceId: input.workspaceId, scope: selection.scope }, optional);
  if (selection.kind === "co-hosted") return { hosting: { forms, secret: key.secret }, save: key.save };
  const submitUrl = await prepareExternal({ deps, input, forms, destination: selection.destination, secret: key.secret });
  // The key's base URL is the external receiver's origin, not the published site's.
  return { submitUrl, save: () => key.save({ url: submitUrl }) };
}

/** Runs an external destination's `prepare` and validates the address it returns. Errors never carry the key.
 * @complexity One credential open plus the destination's own prepare. */
async function prepareExternal(
  required: { deps: FormDestinationPortDeps; input: PortInput; forms: readonly FormDestinationForm[]; destination: LoadedFormDestination; secret: string },
  _optional: Record<string, never> = {},
): Promise<string> {
  const { deps, input, forms, destination, secret } = required;
  try {
    const credential = await destinationCredential({ deps, workspaceId: input.workspaceId, destination });
    if (!destination.module.prepare) throw new Error("destination has no receiver preparation method");
    const prepared = await destination.module.prepare({ kit: input.kit, forms, secret, site: { projectName: input.projectName }, ...(credential ? { credential } : {}) });
    return assertSubmitUrl({ submitUrl: prepared.submitUrl });
  } catch (error) {
    throw new Error(`form destination '${destination.descriptor.id}' could not prepare its receiver: ${(error instanceof Error ? error.message : String(error)).replaceAll(secret, "[redacted]")}`);
  }
}

/** The destination's own saved connection, when its descriptor names one. @complexity One vault list plus one open. */
async function destinationCredential(
  required: { deps: FormDestinationPortDeps; workspaceId: string; destination: LoadedFormDestination },
  _optional: Record<string, never> = {},
): Promise<FormDestinationCredential | undefined> {
  const { id, credentialLabel: label } = required.destination.descriptor;
  if (!label) return undefined;
  const saved = await required.deps.resolveCredential({ workspaceId: required.workspaceId, label });
  if (!saved) throw new Error(required.deps.missingCredentialMessage({ id, label }));
  return { token: saved.token, baseUrl: saved.baseUrl, ...(saved.username ? { username: saved.username } : {}) };
}

function off({ forms, message }: { forms: readonly FormDestinationForm[]; message: string }, _optional = {}): FormSubmissionsInspection {
  return { status: "off", forms: forms.length, message, changes: [] };
}
