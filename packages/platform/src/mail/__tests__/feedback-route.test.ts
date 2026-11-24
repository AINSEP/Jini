import assert from "node:assert/strict";
import { test } from "vitest";
import type { MailFeedbackParser, MailSuppressionRepoPort, MailerFeedbackEvent } from "../ports.js";
import { createMailFeedbackRoute, flattenHeaders, MAIL_FEEDBACK_MAX_BODY_BYTES } from "../feedback-route.js";
import { createPluginMailFeedbackSources, createVaultMailWebhookSecrets, mailWebhookSecretLabels, type MailAdapterSource } from "../feedback-sources.js";
import { createSiteMailFeedbackRoute } from "../sql/site-feedback-route.js";

/** The host's vault credentials are opaque to these sources. */
type CustomCredentialResolveDeps = { readonly vault: "host" };

/**
 * @file The framework-free feedback route and its sources, with fakes for every port: parser lookup
 * per request (404 when gone), vault secrets with rotation, suppression + inbox dedup through the
 * Jini ingest, header flattening, and the plugin registry reads.
 */

const BODY = new TextEncoder().encode('{"ok":true}');
const event = (eventId: string, kind: MailerFeedbackEvent["kind"], hardBounce = false): MailerFeedbackEvent => ({
  workspaceId: "ignored", providerMessageId: "m", sourceContext: { module: "unknown" }, kind, eventId, recipient: "A@X.test", hardBounce, occurredAt: "2026-10-21T00:00:00.000Z",
});

/** Verifies when the `sig` header equals one of the secrets; emits the given events for the request's workspace. */
function fakeParser(events: readonly MailerFeedbackEvent[]): MailFeedbackParser {
  return {
    verify: ({ headers, secrets }) => secrets.includes(headers.sig ?? ""),
    parse: ({ workspaceId }) => events.map((item) => ({ ...item, workspaceId })),
  };
}

function fakeRepos() {
  const seen = new Set<string>();
  const suppressed: Parameters<MailSuppressionRepoPort["suppress"]>[0][] = [];
  return {
    suppressed,
    inbox: {
      // Only a completed event is a duplicate (the ingest completes it after suppression).
      record: async ({ providerId, event: item }: { providerId: string; event: { eventId: string } }) =>
        (seen.has(`${providerId}:${item.eventId}`) ? "duplicate" as const : "inserted" as const),
      complete: async ({ providerId, eventId }: { providerId: string; eventId: string }) => { seen.add(`${providerId}:${eventId}`); },
    },
    suppression: { isSuppressed: async () => false, suppress: async (input: Parameters<MailSuppressionRepoPort["suppress"]>[0]) => { suppressed.push(input); } },
  };
}

test("flattenHeaders lower-cases names, joins repeated values and drops absent ones", () => {
  assert.deepEqual(flattenHeaders({ headers: { "Svix-Id": "a", via: ["x", "y"], gone: undefined } }), { "svix-id": "a", via: "x, y" });
});

test("the route verifies, applies suppression once per event id, and answers 404/503 by provider state", async () => {
  const repos = fakeRepos();
  let parser: MailFeedbackParser | undefined = fakeParser([event("e1", "bounced", true), event("e2", "complained"), event("e3", "delivered")]);
  let secrets: readonly string[] = [];
  const route = createMailFeedbackRoute({
    parserFor: async () => parser, secretsFor: async () => secrets, repos, resolveWorkspaceId: async () => "wa",
  });
  assert.equal(route.maxBodyBytes, MAIL_FEEDBACK_MAX_BODY_BYTES);
  const post = (sig: string) => route.handle({ providerId: "resend", rawBody: BODY, headers: { sig } });

  assert.equal((await post("s1")).status, 503, "no secret saved yet");
  secrets = ["s0", "s1"];
  assert.equal((await post("bad")).status, 401);
  assert.deepEqual(await post("s1"), { status: 200, body: { ok: true, applied: 3, duplicates: 0 } });
  assert.deepEqual(repos.suppressed, [
    { workspaceId: "wa", normalizedAddress: "a@x.test", scope: "all", reason: "bounced" },
    { workspaceId: "wa", normalizedAddress: "a@x.test", scope: "bulk", reason: "complained" },
  ]);
  assert.deepEqual((await post("s0")).body, { ok: true, applied: 0, duplicates: 3 }, "a replay (or the previous secret) changes nothing");

  parser = undefined;
  assert.equal((await post("s1")).status, 404, "a provider that lost its parser is unknown again");
});

test("the route passes its options to the ingest (body cap, synchronous workspace resolver)", async () => {
  const repos = fakeRepos();
  const route = createMailFeedbackRoute(
    { parserFor: () => fakeParser([]), secretsFor: async () => ["s"], repos, resolveWorkspaceId: () => "wa" },
    { maxBodyBytes: 4 },
  );
  assert.equal(route.maxBodyBytes, 4);
  assert.equal((await route.handle({ providerId: "p", rawBody: BODY, headers: {} })).status, 413);
});

const adapters = (modules: Record<string, unknown>): MailAdapterSource => ({
  list: () => Object.entries(modules).map(([id, module]) => ({ descriptor: { id, label: id.toUpperCase() }, module })),
});

test("plugin sources expose a module's parser only when it has verify and parse, and its label", async () => {
  const parser = fakeParser([]);
  const sources = createPluginMailFeedbackSources({ loadAdapters: async () => adapters({ good: { feedback: parser }, half: { feedback: { verify() {} } }, none: {}, nil: null }) });
  assert.equal(await sources.parserFor({ providerId: "good" }), parser);
  assert.equal(await sources.parserFor({ providerId: "half" }), undefined);
  assert.equal(await sources.parserFor({ providerId: "none" }), undefined);
  assert.equal(await sources.parserFor({ providerId: "nil" }), undefined);
  assert.equal(await sources.parserFor({ providerId: "missing" }), undefined);
  assert.equal(await sources.labelFor({ providerId: "good" }), "GOOD");
  assert.equal(await sources.labelFor({ providerId: "missing" }), undefined);
});

test("vault secrets: current then previous label, skipping unsaved or empty ones", async () => {
  assert.deepEqual(mailWebhookSecretLabels({ providerLabel: "Resend", labelPrefix: "Site Mail" }), ["Site Mail — Resend Webhook Secret", "Site Mail — Resend Webhook Secret (previous)"]);
  const saved: Record<string, string> = { "Site Mail — Resend Webhook Secret": "cur", "Site Mail — Resend Webhook Secret (previous)": "old", "Site Mail — Blank Webhook Secret": "" };
  const asked: unknown[] = [];
  const credentials = {} as CustomCredentialResolveDeps;
  const secretsFor = createVaultMailWebhookSecrets(
    { credentials, workspaceId: "wa", labelFor: async ({ providerId }) => (providerId === "nope" ? undefined : providerId), labelPrefix: "Site Mail", resolveByLabel: async (deps, input) => {
      asked.push([deps === credentials, input.workspaceId]);
      const token = saved[input.label];
      return token === undefined ? null : { id: "c", category: "ops", baseUrl: "https://x.test", additionalHosts: [], connection: { token } };
    } },
  );
  assert.deepEqual(await secretsFor({ providerId: "Resend" }), ["cur", "old"]);
  assert.deepEqual(await secretsFor({ providerId: "Blank" }), []);
  assert.deepEqual(await secretsFor({ providerId: "nope" }), []);
  assert.deepEqual(asked[0], [true, "wa"]);
});

test("the site route wires the vault and plugin registry: a known provider with no saved secret is 503", async () => {
  const credentials = { repo: { listByWorkspace: async () => [] }, sealer: {} } as unknown as CustomCredentialResolveDeps;
  const route = createSiteMailFeedbackRoute({
    db: {} as never, workspaceId: "wa", credentials, loadAdapters: async () => adapters({ resend: { feedback: fakeParser([]) } }),
    labelPrefix: "Site Mail", resolveByLabel: async () => null,
  });
  assert.equal((await route.handle({ providerId: "resend", rawBody: BODY, headers: {} })).status, 503);
  assert.equal((await route.handle({ providerId: "other", rawBody: BODY, headers: {} })).status, 404);
});
