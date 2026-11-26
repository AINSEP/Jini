import { createHash } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
import type { Request, Response } from "express";
import type { ToolExecutionContext } from "@jini-ai/core";
import { createConsoleLogger } from "@jini-ai/core/primitives";
import { createCommentSubmitHandler } from "./comments/express/submit-handler.js";
import { createFormSubmitHandler, type CreateFormSubmitHandlerRequired } from "./forms/express/handler.js";
import { FormAttachmentSpaceError, FormDefinitionNotFoundError, FormRateLimitExceededError, FormSchemaChangedError, FormSubmissionTooFastError, FormSubmissionValidationError } from "./forms/errors.js";
import { registerFormNotifySubscriber } from "./forms/notify-subscriber.js";
import { InMemoryEventBus } from "./forms/__tests__/eventing.fixture.js";
import { InMemoryFormDefinitionRepo, InMemoryFormSubmissionRepo } from "./forms/__tests__/repo.fixture.js";
import type { FormDefinitionRecord } from "./forms/types.js";
import type { MailerSendResult } from "./forms/ports.js";
import { planCleanup } from "./content-types/cleanup.js";
import { buildMediaRegistrations, type MediaToolDeps } from "./media/tool-registrations.js";
import { InMemoryAssetBlobRepo, InMemoryAssetRenditionRepo, InMemoryMediaRepo } from "./media/repo.memory.js";
import { InMemoryBlobStore } from "./media/blob-store.memory.js";
import { uploadMedia } from "./media/media-service.js";
import { DocumentTextExtractionError } from "./media/document-text.js";
import { resolveHtmlPageEmbeds } from "./widgets/html/resolve-html-page-embeds.js";
import type { ResolveHtmlPageEmbedsDeps } from "./widgets/resolver-contracts.js";
import { InMemoryEntryRepo } from "./entries/index.js";
import { findMediaByIdOrSlug, getLatestTransformDefinition } from "./media/index.js";
import { resolvePageWidgets } from "./widgets/page-widget-resolution.js";
import { listWidgetInstances } from "./widgets/read-service.js";

const SECRET = "h-provider-private-recipient@example.test-token";
const failure = () => Object.assign(new Error(SECRET), { stack: `Error: ${SECRET}\n at ${SECRET}` });
afterEach(() => vi.restoreAllMocks());

test.each([failure(), SECRET])("H: unexpected comment failure emits safely and answers 500", async error => {
  const sink = vi.spyOn(console, "error").mockImplementation(() => {});
  const output = { status: 0, body: undefined as unknown };
  const req = { body: { body: "comment" } } as unknown as Request;
  const res = { status(code: number) { output.status = code; return this; }, json(body: unknown) { output.body = body; } } as unknown as Response;
  const handler = createCommentSubmitHandler({ workspaceId: "ws", ipHashSalt: "salt", clientIp: () => "127.0.0.1",
    rateLimiter: { check: async () => ({ allowed: true }) }, ingressPolicy: { submit: async () => { throw error; } } });
  await handler(req, res, () => {});
  expect(output).toEqual({ status: 500, body: { error: "internal error", code: "INTERNAL_ERROR" } });
  expect(sink).toHaveBeenCalledTimes(1);
  expect(sink.mock.calls[0]).toEqual(["site/comments-submit Unexpected comment submission failure.", error instanceof Error ? "Error" : "string"]);
  expect(JSON.stringify(sink.mock.calls)).not.toContain(SECRET);
});

function formDeps({ error }: { error: unknown }, _optional = {}): CreateFormSubmitHandlerRequired {
  return {
    workspaceId: "ws", submit: async () => { throw error; },
    definitionRepo: { findBySlug: async () => { throw failure(); } },
    resolveClientIp: () => "127.0.0.1", isHttpsRequest: () => false,
    targetRefusalReason: () => null,
    resultCodec: { flashCookieName: "form", encodeFlashCookie: () => undefined,
      clearResultQueryParams: () => {}, encodeResultQuery: ({ kind }) => [["result", kind]] },
  };
}

async function sendForm({ error, html = false }: { error: unknown; html?: boolean }, optional: Parameters<typeof createFormSubmitHandler>[1] = {}) {
  const output = { status: 0, body: undefined as unknown, headers: {} as Record<string, string> };
  const req = { params: { slug: "contact" }, body: {}, protocol: "http",
    get: (name: string) => name === "accept" && html ? "text/html" : name === "host" ? "site.test" : undefined } as unknown as Request;
  const res = { status(code: number) { output.status = code; return this; },
    json(body: unknown) { output.body = body; return this; }, send(body: unknown) { output.body = body; return this; },
    type() { return this; }, set(name: string, value: string) { output.headers[name] = value; return this; },
    redirect(code: number, location: string) { output.status = code; output.body = location; }, cookie() {} } as unknown as Response;
  await createFormSubmitHandler(formDeps({ error }), optional)(req, res);
  return output;
}

const errors = [
  [new FormSubmissionTooFastError(), 422, "FORMS_SUBMISSION_TOO_FAST", "Please wait a moment, then submit again."],
  [new FormDefinitionNotFoundError({ message: SECRET }), 404, "FORMS_DEFINITION_NOT_FOUND", "Form was not found."],
  [new FormSubmissionValidationError({ message: SECRET, fieldErrors: [{ field: "name", reason: "required" }] }), 400, "FORMS_SUBMISSION_VALIDATION_ERROR", "Please check the form fields and try again."],
  [new FormRateLimitExceededError({ message: SECRET, retryAfterSeconds: 12 }), 429, "FORMS_RATE_LIMIT_EXCEEDED", "Too many submissions. Please try again later."],
  [new FormAttachmentSpaceError({ answers: { name: "Ada" }, fields: [], message: SECRET }), 507, "FORMS_ATTACHMENT_SPACE", "There is no room for another attachment. Your answers are kept below. Your form has not been sent."],
  [new FormSchemaChangedError({ fields: [], schemaHash: "a".repeat(64), draft: { answers: { name: "Ada" }, truncated: false, truncatedFields: [] } }), 409, "FORMS_SCHEMA_CHANGED", "This form changed while you were filling it in. Your form has not been sent. Your previous answers are kept below. Please review the updated form."],
] as const;

test.each(errors)("H: %s uses operation-owned public copy with status %i", async (error, status, code, copy) => {
  error.message = SECRET;
  error.stack = SECRET;
  const output = await sendForm({ error });
  expect(output.status).toBe(status);
  expect(output.body).toMatchObject({ code, error: copy });
  expect(JSON.stringify(output)).not.toContain(SECRET);
  if (error instanceof FormSubmissionValidationError) expect(output.body).toMatchObject({ details: { fieldErrors: error.fieldErrors } });
  if (error instanceof FormRateLimitExceededError) expect(output.body).toMatchObject({ details: { retryAfterSeconds: 12 } });
  if (error instanceof FormAttachmentSpaceError || error instanceof FormSchemaChangedError) {
    expect(output.body).toMatchObject({ answers: { name: "Ada" } });
    const page = await sendForm({ error, html: true });
    expect(page.status).toBe(status);
    expect(String(page.body)).toContain(copy);
    expect(String(page.body)).not.toContain(SECRET);
  }
});

test("H: trusted host attachment copy comes from handler construction", async () => {
  const output = await sendForm({ error: errors[4][0] }, { attachmentSpaceMessage: "This site needs more attachment space." });
  expect(output.body).toMatchObject({ error: "This site needs more attachment space.", answers: { name: "Ada" } });
});

test("H: failed retry lookup emits one safe diagnostic and preserves the validation redirect", async () => {
  const sink = vi.spyOn(console, "error").mockImplementation(() => {});
  const output = await sendForm({ error: errors[2][0], html: true });
  expect(output.status).toBe(303);
  expect(output.body).toBe("/?result=validation");
  expect(sink).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(sink.mock.calls)).not.toContain(SECRET);
});

test.each(["throws", "refuses", "string"])("H: notification %s logs safely and continues recipients and siblings", async kind => {
  const bus = new InMemoryEventBus();
  const definitions = new InMemoryFormDefinitionRepo();
  const submissions = new InMemoryFormSubmissionRepo();
  const definition: FormDefinitionRecord = { id: "def", workspaceId: "ws", name: "Contact", slug: "contact", fields: [],
    notify: { enabled: true, recipients: [SECRET, "second@example.test"] }, status: "active", version: 1,
    createdAt: "2026-01-01", updatedAt: "2026-01-01" };
  await definitions.create(definition);
  await submissions.create({ id: "sub", workspaceId: "ws", formDefinitionId: "def", data: {}, sourceIp: null, submittedAt: "2026-01-01" });
  const sink = vi.spyOn(console, "warn").mockImplementation(() => {});
  let deliveries = 0;
  let siblings = 0;
  const send = async (): Promise<MailerSendResult> => {
    deliveries++;
    if (deliveries > 1) return { ok: true, providerMessageId: "sent", acceptedAt: "2026-01-01" };
    if (kind === "throws") throw failure();
    if (kind === "string") throw SECRET;
    return { ok: false, errorCode: "SUPPRESSED", message: SECRET, retryable: false };
  };
  await registerFormNotifySubscriber({ bus, sender: { email: "sender@example.test" }, logger: createConsoleLogger({ prefix: "forms" }),
    formDefinitionRepo: definitions, formSubmissionRepo: submissions,
    mailer: { send } });
  await bus.subscribe({ eventName: "form.submission.received", handler: async () => { siblings++; } });
  await bus.publish({ id: "event", name: "form.submission.received", workspaceId: "ws", occurredAt: "2026-01-01",
    payload: { workspaceId: "ws", formDefinitionId: "def", submissionId: "sub" } });
  expect([deliveries, siblings]).toEqual([2, 1]);
  expect(sink).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(sink.mock.calls)).not.toContain(SECRET);
});

test("H: cleanup gateway refusal preserves reason without reflecting adapter text", async () => {
  let plans = 0;
  const result = await planCleanup({ deps: {
    clock: { nowMs: () => Date.parse("2026-11-01") }, authorize: async () => ({ allowed: true, reason: "matched" }),
    repo: { findByKey: async () => ({ status: "tombstone", tombstonedAt: "2026-01-01" }) },
    gateway: { plan: async () => { plans++; return { ok: false, error: failure() }; } },
  }, input: { workspaceId: "ws", actorId: "actor", contentTypeKey: "article", exportReference: "export" } });
  expect(plans).toBe(1);
  expect(result.ok).toBe(false);
  if (!result.ok) expect([result.error.reason, result.error.message]).toEqual(["gateway_rejected", "The cleanup gateway refused the plan for content type article (Error)."]);
});

test.each(["DOCUMENT_TEXT_UNAVAILABLE", "DOCUMENT_TEXT_FAILED"] as const)("H: library read %s returns fixed copy", async code => {
  const mediaRepo = new InMemoryMediaRepo({});
  const blobRepo = new InMemoryAssetBlobRepo({});
  const blobStore = new InMemoryBlobStore();
  const bytes = Buffer.from("%PDF-1.7\n%%EOF");
  const deps: MediaToolDeps = { createHash, workspaceId: "ws", authorize: async () => ({ allowed: true, reason: "matched" }),
    clock: { nowMs: () => 0 }, idGen: { newId: () => "id" }, mediaRepo, assetBlobRepo: blobRepo,
    assetRenditionRepo: new InMemoryAssetRenditionRepo({}), blobStore,
    documentTextExtractors: [{ contentType: "application/pdf", extract: async () => { throw new DocumentTextExtractionError({ code, message: SECRET, cause: failure() }); } }] };
  const { media } = await uploadMedia({ deps: { createHash, clock: deps.clock, idGen: deps.idGen, mediaRepo, blobRepo,
    renditionRepo: deps.assetRenditionRepo, blobStore }, input: { workspaceId: "ws", kind: "document", filename: "guide.pdf",
    contentType: "application/octet-stream", bytes, createdByPrincipal: "actor" } });
  const tool = buildMediaRegistrations(deps).find(row => row.descriptor.id === "library_read")!;
  const context: ToolExecutionContext = { executionId: "exec", principal: { id: "actor" }, run: { id: "run" }, input: { documentId: media.id }, signal: new AbortController().signal };
  const result = await tool.handler(context);
  expect(result).toEqual({ untrusted: true, error: { code, message: code === "DOCUMENT_TEXT_UNAVAILABLE" ? "No document-text extractor is installed for this file's format; see install." : "The document-text extractor could not read this file." } });
  expect(await mediaRepo.findById({ workspaceId: "ws", id: media.id })).not.toBeNull();
});

test("H: unknown widget warnings deduplicate by type and leave placeholder output", async () => {
  const sink = vi.spyOn(console, "warn").mockImplementation(() => {});
  const unexpected = async (): Promise<never> => { throw failure(); };
  const deps: ResolveHtmlPageEmbedsDeps = { entryRepo: new InMemoryEntryRepo(), host: {
    media: { findMediaByIdOrSlug, getLatestTransformDefinition, publicTransformName: "public" },
    posts: { isTrashed: () => false, isVersionConflict: (_error): _error is Error & { currentVersion: number } => false,
      isNotFound: () => false, updatePost: unexpected, restorePostForward: unexpected, findPublishedPostById: unexpected, findPublishedPostBySlug: unexpected } } };
  const marker = `<div data-embed-config='{"type":"${SECRET}","id":"x"}'></div>`;
  const result = await resolveHtmlPageEmbeds({ deps, input: { workspaceId: "ws", html: marker + marker } });
  expect(result.size).toBe(0);
  expect(sink).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(sink.mock.calls)).not.toContain(SECRET);
});

test("H: repeated unresolved widget references share one load and produce separate placeholders", async () => {
  const entryRepo = new InMemoryEntryRepo();
  const load = vi.spyOn(entryRepo, "listByWorkspace");
  const result = await resolvePageWidgets({ deps: { entryRepo, bindingRepo: {
    findByRegion: async () => null, listByWorkspace: async () => [], markInactive: async () => {}, rebuildForWorkspace: async () => {},
    upsert: async () => { throw new Error("unused"); },
  } }, input: { workspaceId: "ws", resolvedRegions: [], pageBodyJson: { type: "doc", content: ["one", "two"].map(placementId => ({
    type: "widgetEmbed", attrs: { placementId, widgetEntryId: "missing" },
  })) } } });
  expect(load).toHaveBeenCalledTimes(1);
  expect([...result.inlineResolved]).toEqual(["one", "two"].map(id => [id, { componentId: "widget-placeholder", props: {} }]));
});

test("H: malformed widget rows emit safely and keep skipped-row outcomes", async () => {
  const entryRepo = new InMemoryEntryRepo();
  await entryRepo.save({ id: "broken", workspaceId: "ws", type: "widget", slug: "broken", status: "draft", title: "Broken",
    bodyJson: null, fieldsJson: SECRET, publishedAt: null, createdAt: "2026-01-01", updatedAt: "2026-01-01", version: 1 });
  const sink = vi.spyOn(console, "warn").mockImplementation(() => {});
  const result = await listWidgetInstances({ deps: { entryRepo, authorize: async () => ({ allowed: true, reason: "matched" }) },
    input: { workspaceId: "ws", actor: { principalId: "actor" } } });
  expect(result).toEqual({ instances: [], skippedCount: 1, skippedIds: ["broken"] });
  expect(sink).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(sink.mock.calls)).not.toContain(SECRET);
});
