import type { JsonObject } from "@jini-ai/core/primitives";
import type { FormDefinitionReadPort, FormDefinitionView } from "./ports.js";
import type { WidgetResolveResult, WidgetResolver } from "../types.js";

/**
 * @file `contact-form` widget resolver (SPEC-043 REQ-36..39, ADR-047 Debate Fold-In Amendment 4).
 *
 * Purpose:
 * A thin, READ-ONLY adapter over `src/forms/`'s definition read side. Imports ONLY the read-only
 * `FormDefinitionRepoPort` type, through `forms/index.ts` (ADR-009 §1's barrel; the type is
 * declared in `forms/ports.ts`) — never the Forms library's own submission write path or its
 * outbox-driven mail-notification module — so this file can never persist a submission, send
 * mail, rate-limit, or duplicate any part of the Forms pipeline (INV-08, hard invariant; verified
 * by a code-review-level grep over this whole package for those two module names, which must
 * return nothing).
 *
 * REQ-37 ("reads the referenced Forms definition's declared field vocabulary — never a hardcoded
 * field-type list") is honored here: `definition.fields` (Forms' own `FieldDescriptor[]`) is passed
 * through as IR props verbatim, not re-enumerated against a widget-local field-kind switch. The
 * actual submission still posts to Forms' existing public route unmodified (REQ-37's second half) —
 * that is a render-component/route concern, out of this resolver's scope (no HTTP route exists yet
 * for widgets in this slice; see the implementation report's scope-boundary notes).
 */
export interface ContactFormResolverDeps {
  formDefinitionRepo: FormDefinitionReadPort;
}

export function createContactFormResolver(deps: ContactFormResolverDeps, _optional = {}): WidgetResolver {
  return {
    async resolveMany(instances, context) {
      const results = new Map<string, WidgetResolveResult>();
      // Sequential: one instance's lookups finish before the next instance's lookups start.
      for (const instance of instances) {
        results.set(instance.id, await resolveContactForm({ repo: deps.formDefinitionRepo, config: instance.config, workspaceId: context.workspaceId }));
      }
      return results;
    },
  };
}

/** A config value when it is a string; any other value counts as absent. */
function configString({ config, key }: { config: JsonObject; key: string }): string | undefined {
  const value = config[key];
  return typeof value === "string" ? value : undefined;
}

/** Resolve one instance's config to its IR, or to the failure-isolation placeholder for it. */
async function resolveContactForm({ repo, config, workspaceId }: { repo: FormDefinitionReadPort; config: JsonObject; workspaceId: string }): Promise<WidgetResolveResult> {
  const formDefinitionId = configString({ config, key: "formDefinitionId" });
  const formDefinitionRef = configString({ config, key: "formDefinitionRef" });
  if (!formDefinitionId && !formDefinitionRef) return { ok: false, reason: "invalid-config" };

  const definition = await findDefinition({ repo, workspaceId, id: formDefinitionId ?? formDefinitionRef!, slugFallback: formDefinitionRef });
  // REQ-38/EC-05: a disabled, trashed (`findById` hides it) or purged definition is the same
  // failure-isolation placeholder, never an error.
  if (!definition || definition.status !== "active") return { ok: false, reason: "target-disabled" };

  return {
    ok: true,
    ir: { componentId: "contact-form", props: contactFormProps({ definition, successMessage: configString({ config, key: "successMessage" }) ?? null }) },
    dependencyKeys: [definition.id],
  };
}

/** Look the definition up by id; only a miss with an authored ref falls back to the slug lookup. */
async function findDefinition(
  { repo, workspaceId, id, slugFallback }: { repo: FormDefinitionReadPort; workspaceId: string; id: string; slugFallback: string | undefined },
): Promise<FormDefinitionView | null> {
  const byId = await repo.findById({ workspaceId, id });
  if (byId || !slugFallback) return byId;
  return repo.findBySlug({ workspaceId, slug: slugFallback });
}

/** The render component's props for an active definition. */
function contactFormProps({ definition, successMessage }: { definition: FormDefinitionView; successMessage: string | null }): JsonObject {
  return {
    formDefinitionId: definition.id,
    // Closes this file's own previously-disclosed deferral ("the actual submission still
    // posts to Forms' existing public route unmodified... that is a render-component/route
    // concern, out of this resolver's scope") — the render component built for SPEC-043's
    // routes/UI slice (`server/http/site/render.ts`'s `renderWidgetContactForm`) needs the
    // definition's `slug` to build `POST /forms/:slug/submit`'s URL (REQ-37's second half).
    slug: definition.slug,
    // REQ-37: Forms' own declared field vocabulary, passed through verbatim — never a
    // hardcoded field-type list. Cast: FieldDescriptor[] has no index signature of its
    // own, but every field is plain JSON-serializable data (SPEC-010 forms/types.ts).
    fields: definition.fields as unknown as JsonObject,
    ...(definition.mode === "html" ? {
      mode: "html", html: definition.html ?? "",
    } : {}),
    successMessage,
  };
}
