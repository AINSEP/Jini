/**
 * @file Widgets' agent-tool wiring: maps `agent-tools.ts`'s twelve catalog entries onto the
 * read/write/region/embed services, as `ToolRegistration`s. The entire catalog is wired —
 * `purgeWidgetInstance` is deliberately absent from the catalog rather than present-but-unwired; see
 * `agent-tools.ts`'s own header. The handlers live in `tool-handlers.instances.ts` and
 * `tool-handlers.areas.ts`; this file is the deps/risk/error vocabulary they share plus the id ->
 * handler table.
 *
 * Authorization shape, which is mixed here and deliberately so: every mutating handler's underlying
 * function (`createWidgetInstance`, `updateWidgetInstance`, `trashWidgetInstance`,
 * `mutateWidgetAreaPlacements`, `insertWidgetEmbed`, `removeWidgetEmbed`, `reorderWidgetEmbeds`)
 * calls `requireWidgetPermission` as its own first line (the SAME gate for a human route or an AI
 * tool route), so those handlers must NOT re-check. The 3 tools with no such service-layer wrapper
 * to delegate to — `widgets_list_regions`/`widgets_get_region` (reads) and `widgets_bind_region`,
 * whose own `bindWidgetArea` is deliberately gate-free, being designed to double as boot/theme-
 * activation seeding — call the SAME `requireWidgetPermission` helper inline instead. One evaluator
 * either way, just relocated. This domain calls the widgets-specific helper rather than the kit's
 * generic `requireToolPermission` precisely so both paths reach the identical gate function.
 */
import { buildDomainRegistrations, indexCatalogById, ToolInputError, withSchemaOnRejection, type AgentToolSideEffect, type ToolHandler, type ToolRegistration } from "@jini-ai/core";
import { hostReadRef, resolveHostReadRefs, resolveHostReadText, type HostReadVocabulary } from "../core/tools/host-read-vocabulary.js";
import { widgetsAgentToolCatalog } from "./agent-tools.js";
import { WidgetEmbedReorderCountMismatchError } from "./embed-service.js";
import { WidgetAreaConflictError, WidgetAreaNotFoundError, WidgetConfigValidationError, WidgetEmbedGuardrailError, WidgetEmbedHostNotFoundError, WidgetEmbedHostUnsupportedError, WidgetEmbedPlacementNotFoundError, WidgetForbiddenError, WidgetInstanceNotFoundError, WidgetTypeUnregisteredError, WidgetVersionConflictError } from "./errors.js";
import { widgetsBindRegionHandler, widgetsGetRegionHandler, widgetsInsertEmbedHandler, widgetsListRegionsHandler, widgetsRemoveEmbedHandler, widgetsReorderEmbedsHandler, widgetsSetRegionPlacementsHandler } from "./tool-handlers.areas.js";
import { widgetsCreateInstanceHandler, widgetsGetInstanceHandler, widgetsListInstancesHandler, widgetsTrashInstanceHandler, widgetsUpdateInstanceHandler } from "./tool-handlers.instances.js";
import type { WidgetsHandlerArgs, WidgetsPackageToolDeps, WidgetsSchemaGuard } from "./tool-handlers.types.js";

const MUTATES_DURABLE_STATE = "mutates-durable-state";


/**
 * This wiring layer's OWN risk classification, authored from what each handler below actually
 * calls. See `DerivedRiskByToolId` in the kit for why it is independent of the catalog's own
 * `sideEffects` declaration.
 */
export const widgetsDerivedRisk: ReadonlyMap<string, AgentToolSideEffect> = new Map<string, AgentToolSideEffect>([
  // -> listWidgetInstances (read-service.ts): entryRepo.listByWorkspace only, no write.
  ["widgets_list_instances", "none"],
  // -> getWidgetInstance (read-service.ts) + entryRefsRepo.findByTarget: reads only.
  ["widgets_get_instance", "none"],
  // -> widgetBindingRepo.listByWorkspace + entryRepo.findById: reads only.
  ["widgets_list_regions", "none"],
  // -> widgetBindingRepo.findByRegion + entryRepo.findById (+ per-placement resolution): reads only.
  ["widgets_get_region", "none"],
  // -> createWidgetInstance (write-service.ts): createEntry + entry_refs extraction in one tx.
  ["widgets_create_instance", MUTATES_DURABLE_STATE],
  // -> updateWidgetInstance (write-service.ts): updateEntry + entry_refs extraction.
  ["widgets_update_instance", MUTATES_DURABLE_STATE],
  // -> trashWidgetInstance (write-service.ts): moves it to the Trash (restorable). Never a purge:
  //    a permanent delete exists only as the Trash screen's purge.
  ["widgets_trash_instance", MUTATES_DURABLE_STATE],
  // -> bindWidgetArea (region-area-service.ts): createEntry (maybe) + bindingRepo.upsert.
  ["widgets_bind_region", MUTATES_DURABLE_STATE],
  // -> mutateWidgetAreaPlacements (region-area-service.ts): updateEntry + bindingRepo.upsert.
  ["widgets_set_region_placements", MUTATES_DURABLE_STATE],
  // -> insertWidgetEmbed (embed-service.ts): updateEntry (bodyJson) + entry_refs extraction.
  ["widgets_insert_embed", MUTATES_DURABLE_STATE],
  // -> removeWidgetEmbed (embed-service.ts): updateEntry (bodyJson) + entry_refs extraction.
  ["widgets_remove_embed", MUTATES_DURABLE_STATE],
  // -> reorderWidgetEmbeds (embed-service.ts): updateEntry (bodyJson) + entry_refs extraction.
  ["widgets_reorder_embeds", MUTATES_DURABLE_STATE],
]);

/**
 * The Widgets rejections worth decorating with the published schema: config/type/embed SHAPE
 * problems only. A `WidgetForbiddenError` or `WidgetReferencedError` is not a shape problem
 * retrying the SAME input would ever resolve.
 */
function isWidgetsShapeRejection({ error }: { error: unknown }, _optional = {}): boolean {
  return (
    error instanceof WidgetConfigValidationError ||
    error instanceof WidgetTypeUnregisteredError ||
    error instanceof WidgetEmbedGuardrailError ||
    error instanceof WidgetEmbedReorderCountMismatchError
  );
}

/**
 * Re-classifies every typed not-found/conflict/forbidden domain error this handler map can throw
 * as a `ToolInputError` on its way to the model, and passes anything else through untouched.
 *
 * `WidgetForbiddenError` used to be the one class explicitly passed through untouched here, on the
 * theory that a `403` isn't caller-input. That left the model unable to tell "you lack permission"
 * from "the server broke" — both surfaced as the same redacted `INTERNAL_ERROR` — and the product owner's
 * ruling ("always say the real reason ... so I can improve it or people can see the errors")
 * overrides that theory: the message already names the missing permission and the reason
 * (`requireWidgetPermission` in `authorize-helper.ts` builds it), so there is real, actionable
 * signal here worth letting through, same as every other case below.
 *
 * Same reasoning as the post tools' conflict reclassification: `@jini-ai/daemon`'s `ToolExecutor` tags any rejection that is not `instanceof
 * ToolInputError` as `errorKind: 'internal'`, and the delegated-tool-call transport SEC-005-
 * redacts an `'internal'` failure into a message-stripped `INTERNAL_ERROR` 500. Unlike Posts,
 * which reclassifies its one conflict type at each call site, this wraps the WHOLE handler map
 * once (see the `buildDomainRegistrations` call below) so all 12 widgets tools get it — including
 * the 3 embed handlers with the wrong-table host-lookup bug this reclassification was written
 * alongside, and the read/region/instance handlers that had the SAME redaction bug independent of
 * that lookup bug (see the fix plan's §3 sibling-arms table). A code prefix before `:` is prepended
 * so the model (and a host's HTTP/tool parity test) can match the same code the HTTP arm returns,
 * without this layer importing that HTTP-only module.
 *
 * `WIDGETS_FORBIDDEN` has full HTTP-side parity too: the HTTP arm returns `code:
 * "WIDGETS_FORBIDDEN"`, matching `errors.ts`'s own class doc and every sibling prefix in this
 * function (which all match their class doc verbatim). It used to return the generic `FORBIDDEN`
 * instead — a drift fixed once a parity test was extended to cover this class too.
 *
 * @complexity O(1).
 */
function toModelFacingWidgetsError({ err }: { err: unknown }, optional: { hostReads?: HostReadVocabulary | undefined } = {}): unknown {
  if (err instanceof ToolInputError) return err;
  if (err instanceof WidgetForbiddenError) {
    return new ToolInputError({ message: `WIDGETS_FORBIDDEN: ${err.message}` });
  }
  if (err instanceof WidgetInstanceNotFoundError) {
    return new ToolInputError({ message: `WIDGETS_INSTANCE_NOT_FOUND: ${err.message}` });
  }
  if (err instanceof WidgetAreaNotFoundError) {
    return new ToolInputError({ message: `WIDGETS_AREA_NOT_FOUND: ${err.message}` });
  }
  if (err instanceof WidgetEmbedHostNotFoundError) {
    return new ToolInputError({ message: `WIDGETS_EMBED_HOST_NOT_FOUND: ${err.message}` });
  }
  if (err instanceof WidgetEmbedHostUnsupportedError) {
    return new ToolInputError({ message: `WIDGETS_EMBED_HOST_UNSUPPORTED: ${err.message}` });
  }
  if (err instanceof WidgetEmbedPlacementNotFoundError) {
    return new ToolInputError({ message: `WIDGETS_EMBED_PLACEMENT_NOT_FOUND: ${err.message}` });
  }
  const conflict = toModelFacingWidgetsConflictError({ err }, optional);
  if (conflict) return conflict;
  return err;
}

/** The two optimistic-concurrency refusals of {@link toModelFacingWidgetsError}, split out to keep
 * its branch count within the complexity limit. `undefined` when `err` is neither. */
function toModelFacingWidgetsConflictError({ err }: { err: unknown }, { hostReads }: { hostReads?: HostReadVocabulary | undefined } = {}): ToolInputError | undefined {
  if (err instanceof WidgetVersionConflictError) {
    return new ToolInputError({ message: `WIDGETS_VERSION_CONFLICT: ${err.message}. Nothing was written. Re-read the host or instance to get its current version (${err.currentVersion}) and resend with that as baseVersion.` });
  }
  if (err instanceof WidgetAreaConflictError) {
    return new ToolInputError({ message: `WIDGETS_AREA_CONFLICT: ${err.message}. Nothing was written. Call ${resolveHostReadText({ text: hostReadRef({ entity: "widget_region" }) }, { hostReads })} to get the current baseVersion (${err.currentVersion}) and resend.` });
  }
  return undefined;
}

const withWidgetsSchema = ({ catalog }: { catalog: Parameters<typeof withSchemaOnRejection>[0]["catalog"] }): WidgetsSchemaGuard => ({ toolId, fn }) =>
  withSchemaOnRejection({ toolId, catalog, isShapeRejection: ({ error }) => isWidgetsShapeRejection({ error }), fn });

/**
 * Builds Widgets' tool registrations over the host's deps: the id -> handler table, wrapped once so
 * every handler reports its typed domain errors to the model as a `ToolInputError`.
 *
 * Every handler gets `toModelFacingWidgetsError` — see that function's doc comment for why this
 * wraps the whole map once here rather than per call site. The inner `deps.wrapHookRefusals`
 * covers the 3 embed tools on a post/page host (`updatePost` runs the plugin save hook): a plugin
 * refusal becomes the host's fixed refusal message naming the plugin, which
 * `toModelFacingWidgetsError` then passes through as the `ToolInputError` it already is. The
 * wrapper is a dep because the refusal class and its wording are the host's.
 *
 * No host tool metadata is applied here: a host binds its own search vocabulary and approval policy
 * (`withToolMetadata` in `@jini-ai/core`) over the result.
 *
 * @param required.deps - The host's route deps slice, composers and hook-refusal wrapper.
 * @param optional.hostReads - How the host names its read tools in model-facing text (neutral wording when absent).
 * @returns One registration per catalog entry, in catalog order.
 * @complexity O(t) in the twelve tools.
 */
export function buildWidgetsToolRegistrations(
  { deps }: { deps: WidgetsPackageToolDeps },
  { hostReads }: { hostReads?: HostReadVocabulary | undefined } = {},
): ToolRegistration[] {
  const catalog = indexCatalogById({ catalog: resolveHostReadRefs({ value: widgetsAgentToolCatalog }, { hostReads }) });
  const args: WidgetsHandlerArgs = { deps, withSchema: withWidgetsSchema({ catalog }) };
  const handlers: Record<string, ToolHandler> = {
    widgets_list_instances: widgetsListInstancesHandler(args),
    widgets_get_instance: widgetsGetInstanceHandler(args),
    widgets_list_regions: widgetsListRegionsHandler(args),
    widgets_get_region: widgetsGetRegionHandler(args),
    widgets_create_instance: widgetsCreateInstanceHandler(args),
    widgets_update_instance: widgetsUpdateInstanceHandler(args),
    widgets_trash_instance: widgetsTrashInstanceHandler(args),
    widgets_bind_region: widgetsBindRegionHandler(args),
    widgets_set_region_placements: widgetsSetRegionPlacementsHandler(args),
    widgets_insert_embed: widgetsInsertEmbedHandler(args),
    widgets_remove_embed: widgetsRemoveEmbedHandler(args),
    widgets_reorder_embeds: widgetsReorderEmbedsHandler(args),
  };

  const modelFacingHandlers: Record<string, ToolHandler> = Object.fromEntries(
    Object.entries(deps.wrapHookRefusals(handlers)).map(([toolId, handler]) => [
      toolId,
      async (ctx) => {
        try {
          return await handler(ctx);
        } catch (err) {
          throw toModelFacingWidgetsError({ err }, { hostReads });
        }
      },
    ])
  );

  // No `unwiredToolIds`: Widgets wires its ENTIRE catalog, same tripwire discipline as Forms.
  return buildDomainRegistrations({
    domain: "widgets",
    catalogModule: "widgets/agent-tools.ts",
    catalog,
    handlers: modelFacingHandlers,
    derivedRisk: widgetsDerivedRisk,
  });
}
