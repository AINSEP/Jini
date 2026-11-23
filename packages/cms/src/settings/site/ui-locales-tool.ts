import { ToolInputError } from "@jini-ai/core";
import { buildDomainRegistrations, indexCatalogById, requireNoInput, type AgentToolDefinition, type AgentToolSideEffect, type ToolRegistration } from "@jini-ai/core";
import { adaptLegacyAuthorize, requireToolPermission } from "../../core/tools/args.js";
import type { AuthorizeFn } from "@jini-ai/core/contracts/events";

/** n05's real gap: supported admin language codes were only discoverable by shell reads.
 * Uses the canonical kernel catalog contract shared by the native feature tools. */
export const uiLocalesAgentToolCatalog: AgentToolDefinition[] = [{
  name: "settings_list_ui_locales",
  description:
    "Lists the languages and exact locale codes offered by the admin interface language selector. " +
    "Call before switching your admin language to Spanish, Portuguese, Italian, Polish, German, or English, " +
    "or to check which UI languages are supported; Portuguese uses pt-BR, not pt. " +
    "Returns {locales:[{code,label}],setting:'core.language.locale',scope:'user',writeTool:'settings_set_ui_preference'}. " +
    "Then read settings_get_effective (namespace core.language) and use settings_set_ui_preference with " +
    "setting core.language.locale and value equal to a returned code. This list is read-only and takes no arguments; " +
    "access requires settings.read. Offered options do not guarantee complete translation coverage. " +
    "The preference changes only the calling operator's admin menus and labels; it does not translate public site content, " +
    "set a visitor-facing site language, or change the language of assistant replies.",
  sideEffects: "none",
  authorization: { permission: "settings.read" },
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
}];

export const uiLocalesDerivedRisk: ReadonlyMap<string, AgentToolSideEffect> = new Map<string, AgentToolSideEffect>([
  // -> requireToolPermission + a copy of the host's offered locales; no setting or other durable state is written.
  ["settings_list_ui_locales", "none"],
]);

/** One admin-interface language option, exactly as the host's selector offers it. */
export interface UiLocaleOption {
  readonly code: string;
  readonly label: string;
}

/**
 * The tool's deps: the existing workspace authorization port plus the host's offered locale list
 * (product copy the host owns — the engine never ships its own language set).
 */
export interface UiLocalesToolDeps {
  authorize: AuthorizeFn;
  workspaceId: string;
  locales: readonly UiLocaleOption[];
}

/**
 * Builds a permission-gated, read-only language-option registration. Host tool metadata (search
 * vocabulary, approval policy) is not bound here: the host applies it with `withToolMetadata`.
 * @param deps - The existing workspace authorization port and the host's offered locales; no repository access is needed.
 * @returns One registration returning selector options and existing preference-write coordinates.
 * @throws {ToolInputError} For supplied arguments; {ForbiddenError} when settings.read is denied.
 * @complexity O(n) time and space to copy n offered locale options, with one authorization call.
 * @example buildUiLocalesRegistrations({ authorize, workspaceId: "ws-main", locales: [{ code: "en", label: "English" }] })
 */
export function buildUiLocalesRegistrations(deps: UiLocalesToolDeps): ToolRegistration[] {
  return buildDomainRegistrations({
    domain: "settings-ui-locales",
    catalogModule: "settings/site/ui-locales-tool.ts",
    catalog: indexCatalogById({ catalog: uiLocalesAgentToolCatalog }),
    derivedRisk: uiLocalesDerivedRisk,
    handlers: {
      settings_list_ui_locales: async (ctx) => {
        // The shared no-input reader treats an empty array as a record; this schema accepts objects only.
        if (Array.isArray(ctx.input)) throw new ToolInputError({ message: "this tool accepts no input — omit 'input' or pass {}" });
        requireNoInput({ input: ctx.input });
        await requireToolPermission({
          authorize: adaptLegacyAuthorize({ authorize: deps.authorize }),
          workspaceId: deps.workspaceId,
          principalId: ctx.principal.id,
          permission: "settings.read",
        }, { entityType: "setting-value" });
        return {
          locales: deps.locales.map((locale) => ({ ...locale })),
          setting: "core.language.locale",
          scope: "user",
          writeTool: "settings_set_ui_preference",
        };
      },
    },
  });
}

