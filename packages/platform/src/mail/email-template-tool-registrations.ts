import { requireExpectedVersion } from "@jini-ai/core/optimistic-concurrency";
import { toolMetadata } from "@jini-ai/core/tool-metadata/email-templates";
import { buildDomainRegistrations, indexCatalogById, requireInputRecord, type AgentToolSideEffect, type DerivedRiskByToolId, type ToolExecutionContext, type ToolRegistration } from "@jini-ai/core";
import { forbiddenRule, withModelFacingErrors } from "@jini-ai/core/model-facing-tool-errors";
import type { ToolContributor } from "@jini-ai/core";
import {
  createEmailTemplate,
  editEmailTemplate,
  EmailTemplateInputError,
  EmailTemplateNotFoundError,
  EmailTemplateVersionConflictError,
  getEmailTemplate,
  listEmailTemplates,
  previewEmailTemplate,
  requireText,
} from "@jini-ai/platform/mail/email-template-operations";
import type { EmailTemplateStore } from "./email-template-operations.js";

export interface EmailTemplatesToolDeps {
  workspaceId: string;
  editHtmlPermission: string;
  catalog: readonly import('@jini-ai/core').AgentToolDefinition[];
  requirePermission(input: { ctx: ToolExecutionContext; name: string }): Promise<unknown>;
  emailTemplateStore(): EmailTemplateStore;
  ForbiddenError: abstract new (...args: never[]) => Error;
}

export const emailTemplatesDerivedRisk: DerivedRiskByToolId = new Map<string, AgentToolSideEffect>([
  // -> postRepo.listHtmlByKind only.
  ["email_template_list", "none"],
  // -> postRepo.findById only.
  ["email_template_get", "none"],
  // -> postRepo.save + PagesHtmlDocumentStore.ensureHtmlFormat: one new draft row, its revisions.
  ["email_template_create", "mutates-durable-state"],
  // -> PagesHtmlDocumentStore.write: one compare-and-set body write plus its revision.
  ["email_template_edit", "mutates-durable-state"],
  // -> postRepo.findById at most; renders in memory and sends nothing.
  ["email_template_preview", "none"],
]);

function permission({ deps, ctx, name }: { deps: EmailTemplatesToolDeps; ctx: ToolExecutionContext; name: string }, _options = {}): Promise<unknown> {
  return deps.requirePermission({ ctx, name });
}

/**
 * The assistant half of email templates; every handler is a permission check plus one shared
 * operation from `operations.ts`, the same call the admin route makes.
 * @returns The five registrations.
 * @complexity O(1) per call beyond the operation's own cost.
 */
export function buildEmailTemplatesRegistrations(deps: EmailTemplatesToolDeps): ToolRegistration[] {
  return buildDomainRegistrations({ metadata: toolMetadata, domain: "email-templates", catalogModule: "@jini-ai/platform/mail/email-template-agent-tools", catalog: indexCatalogById({ catalog: deps.catalog }), derivedRisk: emailTemplatesDerivedRisk, handlers: withModelFacingErrors({ handlers: {
    email_template_list: async ctx => {
      requireInputRecord({ input: ctx.input });
      await permission({ deps, ctx, name: "content.read" });
      return listEmailTemplates({ store: deps.emailTemplateStore(), input: requireInputRecord({ input: ctx.input }) });
    },
    email_template_get: async ctx => {
      const input = requireInputRecord({ input: ctx.input });
      await permission({ deps, ctx, name: "content.read" });
      return getEmailTemplate({ store: deps.emailTemplateStore(), id: requireText({ value: input.id, key: "id", max: 200 }) });
    },
    email_template_create: async ctx => {
      const input = requireInputRecord({ input: ctx.input });
      await permission({ deps, ctx, name: deps.editHtmlPermission });
      ctx.signal.throwIfAborted();
      return createEmailTemplate({ store: deps.emailTemplateStore(), input, actorId: ctx.principal.id });
    },
    email_template_edit: async ctx => {
      const input = requireInputRecord({ input: ctx.input });
      await permission({ deps, ctx, name: deps.editHtmlPermission });
      return editEmailTemplate({ store: deps.emailTemplateStore(), input: { ...input, expectedVersion: requireExpectedVersion({ value: input.expectedVersion, readToolId: "email_template_get" }) }, actorId: ctx.principal.id });
    },
    email_template_preview: async ctx => {
      const input = requireInputRecord({ input: ctx.input });
      await permission({ deps, ctx, name: "content.read" });
      return previewEmailTemplate({ store: deps.emailTemplateStore(), input });
    },
  }, rules: [
    forbiddenRule({ domainPrefix: "EMAIL_TEMPLATES", error: deps.ForbiddenError }),
    { error: EmailTemplateNotFoundError, code: "EMAIL_TEMPLATES_NOT_FOUND" },
    { error: EmailTemplateInputError, code: "EMAIL_TEMPLATES_INVALID_INPUT" },
    { error: EmailTemplateVersionConflictError, code: "EMAIL_TEMPLATES_VERSION_CONFLICT" },
  ] }) });
}

/** Contributes the email-template tools; registered once by `tool-catalog-manifest.ts`. */
export function contributeEmailTemplatesTools(): ToolContributor<EmailTemplatesToolDeps, unknown> {
  return { domain: "email-templates", build: buildEmailTemplatesRegistrations, risk: emailTemplatesDerivedRisk };
}
