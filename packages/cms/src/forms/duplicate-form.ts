import { AGENT_TOOL_PRINCIPAL_KIND, ToolInputError } from "@jini-ai/core";
import { FormDefinitionNotFoundError } from "./errors.js";
import { deriveAvailableFormSlug } from "./duplicate-slug.js";
import type { FormAuthoring } from "./fields-json.js";
import type { FormDefinitionRecord } from "./types.js";
import { formsDeps, toFormDefinitionView } from "./tool-handlers.definitions.js";
import type { FormsPackageToolDeps } from "./tool-handlers.types.js";

/** What `duplicateFormDefinition` takes: the deps (including the host's name search) and the duplicate request. */
export interface DuplicateFormRequired {
  deps: FormsPackageToolDeps;
  input: { principalId: string; id: string; overrides: { title?: string; slug?: string; status?: string } };
}

/**
 * Forms' `"form"` implementation of `content_duplicate` — see
 * the host's duplicate-resource registry for the contract, and
 * the post tools' `duplicatePostOrPage` for the sibling `"post"`/`"page"`
 * one. This is the resource that proves the generic tool's seam is real rather than a post-shaped
 * hole with a `resource` parameter bolted on: it gates on `admin.forms.manage`, NOT the
 * `content.write` post/page use, so a caller permitted to copy a page is not thereby permitted to
 * copy a form.
 *
 * No separate upfront read check, unlike `duplicatePostOrPage`'s `content.read` one: reading a form
 * definition IS `admin.forms.manage` in this domain (`forms_list_definitions` gates on exactly that
 * permission), which `content_duplicate`'s own outer gate has already established before this runs.
 * A second identical check would be the duplicate evaluator ADR-021 §2 forbids.
 *
 * What is copied: `name` (defaulting to the source's own name with a numeric suffix — see
 * the host's numeric-suffix name search (`deps.deriveDuplicateName`) for the owner's ruling — never
 * `"Copy of <source name>"`), every field descriptor, and the notify config — all deep-copied, so
 * editing the copy can never reach back into the source row. `slug` is derived FROM that (possibly
 * numbered) name (see `duplicate-slug.ts` for why Forms needs derivation where Posts does not), so
 * `"Contact Us 2"` yields `"contact-us-2"` and the two stay in step.
 *
 * @complexity O(f) in the source's field count, plus one `formDefinitionRepo.list()` scan for the
 * default name (skipped entirely when the caller supplies an explicit `overrides.title` — see
 * {@link deriveDefaultDuplicateFormName}) plus one repo read per slug candidate tried.
 */
/**
 * Derives `content_duplicate`'s default name for a form copy — see
 * the host's numeric-suffix name search (`deps.deriveDuplicateName`) for the owner's ruling.
 * Only ever called when the caller supplied no explicit `overrides.title`.
 *
 * @complexity One `formDefinitionRepo.list()` scan (3 forms at current scale, read live 2026-09-08 —
 * see the shared module's own header for why this is an accepted O(n) scan rather than a new port
 * method), then `deriveDuplicateName`'s own bounded search.
 */
async function deriveDefaultDuplicateFormName(
  { routeDeps }: { routeDeps: FormsPackageToolDeps },
  source: FormDefinitionRecord,
): Promise<string> {
  const existingNames = new Set(
    (await routeDeps.formDefinitionRepo.list({ workspaceId: routeDeps.workspaceId })).map((form) => form.name)
  );
  return routeDeps.deriveDuplicateName(
    { sourceName: source.name },
    { isTaken: async ({ candidate }) => existingNames.has(candidate) }
  );
}

export async function duplicateFormDefinition(
  { deps: routeDeps, input }: DuplicateFormRequired,
  _optional = {},
): Promise<Record<string, unknown>> {
  // Rejected rather than ignored. `content_duplicate`'s `status` override is spelled in post/page's
  // vocabulary (`draft`/`published`), which a form definition has no equivalent of — its statuses are
  // `active`/`disabled`, flipped by `forms_set_definition_status`. Silently dropping the field would
  // leave a caller believing it had set something.
  if (input.overrides.status !== undefined) {
    throw new ToolInputError({ message:
      "content_duplicate: resource 'form' does not support the 'status' override — a form definition is " +
        "active/disabled, not draft/published. Overrides honored for 'form': title (the copy's name) and " +
        "slug. The copy inherits the source's own active/disabled state; use forms_set_definition_status " +
        "to change it afterwards."
    });
  }

  const source = await routeDeps.formDefinitionRepo.findById({ workspaceId: routeDeps.workspaceId, id: input.id });
  if (!source) throw new FormDefinitionNotFoundError({ message: `form definition '${input.id}' was not found` });

  const name = input.overrides.title ?? (await deriveDefaultDuplicateFormName({ routeDeps }, source));
  const slug =
    input.overrides.slug ??
    (await deriveAvailableFormSlug(
      { name, ...routeDeps.slugPolicy,
        // `isSlugTaken`, not `findBySlug` — trash-blind, so a trashed form's slug is correctly
        // reported as taken instead of offered to the copy and then colliding on the DB unique
        // index (decision 3, ADS-memory/reports/2026-09-21-t8f-trash-forms-plan.md §B).
        isTaken: async (candidate) =>
          routeDeps.formDefinitionRepo.isSlugTaken({ workspaceId: routeDeps.workspaceId, slug: candidate }),
      }, {}
    ));

  const actor = { id: input.principalId, kind: AGENT_TOOL_PRINCIPAL_KIND };
  const provider = (source as FormDefinitionRecord & FormAuthoring).provider;
  const { definition } = await routeDeps.formWrites.create({
    deps: formsDeps(routeDeps),
    input: {
      workspaceId: routeDeps.workspaceId,
      actor,
      name,
      slug,
      // Deep-copied, not shared: `fields` and `notify.recipients` are arrays of objects the source
      // row still owns, and a shallow copy would make an edit to the copy's fields mutate the
      // source's — the same class of silent shared-state corruption `duplicate-embeds.ts` exists
      // to prevent on the post side.
      fields: source.fields.map((field) => ({ ...field })),
      ...((source as { mode?: string }).mode === "html" ? { mode: "html" as const, html: (source as { html?: string }).html ?? "" } : {}),
      ...(provider ? { provider: structuredClone(provider) } : {}),
      notify: { enabled: source.notify.enabled, recipients: [...source.notify.recipients] },
    },
  });

  // `createFormDefinition` always creates `active`. A copy of a DISABLED form must not come back
  // live — the same "a copy is never more exposed than its source" rule that makes a duplicated
  // published page default to draft. Two commands rather than one because `createFormDefinition`
  // takes no status; a failure here surfaces to the caller rather than silently leaving an active
  // copy, and the copy is a fresh row nothing references yet, so the window is inert.
  if (source.status === "disabled") {
    const { definition: disabled } = await routeDeps.formWrites.setStatus({
      deps: formsDeps(routeDeps),
      input: { workspaceId: routeDeps.workspaceId, actor, formId: definition.id, status: "disabled" },
    });
    return { definition: toFormDefinitionView(disabled) };
  }

  return { definition: toFormDefinitionView(definition) };
}

