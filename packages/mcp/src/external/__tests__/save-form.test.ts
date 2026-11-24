import assert from "node:assert/strict";
import { test } from "vitest";

import type { ExternalMcpServerView as CanonicalExternalMcpServerView } from "@jini-ai/core/contracts/hosted-mcp";
import { parseArgs } from "../../federation/hosted/index.js";

import { buildExternalMcpSaveForm, buildExternalMcpSaveFormFields, mergeExternalMcpSavePrefill, type ExternalMcpSaveInput } from "../save-form.js";

type ExternalMcpServerView = CanonicalExternalMcpServerView<unknown>;
const APP_NAME = "host-external-mcp-save";

/**
 * @file Direct coverage for `save-form.ts`'s two decision-bearing functions —
 * `mergeExternalMcpSavePrefill` (the prefill merge) and `buildExternalMcpSaveFormFields` (the
 * per-call field list), which this repo's complexity gate previously flagged at cyclomatic 18/21 and
 * cognitive 36 before being decomposed into small named helpers. These tests pin the exact behavior
 * that decomposition had to preserve: field order, which fields appear per transport/authMode/update
 * combination, and the merge's "explicit input wins, else existing, else unset" precedence.
 */

const BASE_INPUT: ExternalMcpSaveInput = { id: "srv-1", transport: "stdio" };

function existingView(overrides: Partial<ExternalMcpServerView> = {}): ExternalMcpServerView {
  return {
    serverId: "srv-1",
    label: "Existing Label",
    provisionedByPluginId: null,
    transport: "stdio",
    authMode: "api_key",
    enabled: true,
    command: "npx some-server",
    url: null,
    args: ["--flag"],
    allowedToolNames: ["tool_a", "tool_b"],
    writeAllowedToolNames: [],
    writeGrantsUpdatedByPrincipalId: null,
    writeGrantsUpdatedAt: null,
    envNames: [],
    hasAccessToken: false,
    accessTokenEnvName: null,
    version: 1,
    oauth: { providerId: null, grant: null, clientId: null, scopes: ["read", "write"], status: "disconnected", expiresAt: null, tokenEnvName: null, hasStoredToken: false },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// mergeExternalMcpSavePrefill
// ---------------------------------------------------------------------------

test("mergeExternalMcpSavePrefill: with no existing row, returns the input untouched", () => {
  const result = mergeExternalMcpSavePrefill({ input: BASE_INPUT, existing: undefined });
  assert.equal(result, BASE_INPUT);
});

test("mergeExternalMcpSavePrefill: explicit input fields win over the existing row's values", () => {
  const input: ExternalMcpSaveInput = { id: "srv-1", transport: "stdio", label: "New Label", command: "node new-server.js" };
  const result = mergeExternalMcpSavePrefill({ input, existing: existingView() });
  assert.equal(result.label, "New Label");
  assert.equal(result.command, "node new-server.js");
});

test("mergeExternalMcpSavePrefill: unset input fields fall back to the existing row's values, joining array fields", () => {
  const result = mergeExternalMcpSavePrefill({ input: BASE_INPUT, existing: existingView() });
  assert.equal(result.label, "Existing Label");
  assert.equal(result.command, "npx some-server");
  assert.equal(result.args, "--flag");
  assert.equal(result.allowedToolNames, "tool_a, tool_b");
  assert.equal(result.authMode, "api_key");
  const args = ["-y", "some-pkg"];
  const multi = mergeExternalMcpSavePrefill({ input: BASE_INPUT, existing: existingView({ args }) });
  assert.equal(multi.args, "-y some-pkg");
});

test("mergeExternalMcpSavePrefill: HTTP updates retain the existing URL unless input overrides it", () => {
  const input: ExternalMcpSaveInput = { id: "srv-1", transport: "streamable_http" };
  const existing = existingView({ transport: "streamable_http", url: "https://old.example/mcp" });
  assert.equal(mergeExternalMcpSavePrefill({ input, existing }).url, "https://old.example/mcp");
  assert.equal(mergeExternalMcpSavePrefill({ input: { ...input, url: "https://new.example/mcp" }, existing }).url, "https://new.example/mcp");
});

test("mergeExternalMcpSavePrefill: an existing row's write grants prefill writeAllowedToolNames — an update's form does not start from a blank that would read as 'no write access'", () => {
  const result = mergeExternalMcpSavePrefill({ input: BASE_INPUT, existing: existingView({ writeAllowedToolNames: ["tool_a"] }) });
  assert.equal(result.writeAllowedToolNames, "tool_a");
});

test("mergeExternalMcpSavePrefill: a row with no write grants prefills an empty writeAllowedToolNames, not undefined", () => {
  const result = mergeExternalMcpSavePrefill({ input: BASE_INPUT, existing: existingView({ writeAllowedToolNames: [] }) });
  assert.equal(result.writeAllowedToolNames, "");
});

test("mergeExternalMcpSavePrefill: explicit input writeAllowedToolNames wins over the existing row's value", () => {
  const input: ExternalMcpSaveInput = { id: "srv-1", transport: "stdio", writeAllowedToolNames: "tool_b" };
  const result = mergeExternalMcpSavePrefill({ input, existing: existingView({ writeAllowedToolNames: ["tool_a"] }) });
  assert.equal(result.writeAllowedToolNames, "tool_b");
});

test("mergeExternalMcpSavePrefill: a null existing OAuth field falls back to unset (undefined), not null", () => {
  const result = mergeExternalMcpSavePrefill({ input: BASE_INPUT, existing: existingView() });
  assert.equal(result.oauthProviderId, undefined);
  assert.equal(result.oauthGrant, undefined);
  assert.equal(result.oauthClientId, undefined);
  assert.equal(result.oauthTokenEnvName, undefined);
  assert.equal(result.oauthScopes, "read write");
});

test("mergeExternalMcpSavePrefill: a non-null existing OAuth field is used as fallback", () => {
  const result = mergeExternalMcpSavePrefill(
    {
      input: BASE_INPUT,
      existing: existingView({ oauth: { providerId: "google", grant: "device_code", clientId: "client-1", scopes: [], status: "connected", expiresAt: null, tokenEnvName: "TOKEN_ENV", hasStoredToken: true } }),
    },
  );
  assert.equal(result.oauthProviderId, "google");
  assert.equal(result.oauthGrant, "device_code");
  assert.equal(result.oauthClientId, "client-1");
  assert.equal(result.oauthTokenEnvName, "TOKEN_ENV");
});

test("mergeExternalMcpSavePrefill: OAuth endpoint fields are never merged from existing — carried through from input as-is", () => {
  const input: ExternalMcpSaveInput = { id: "srv-1", transport: "stdio", oauthAuthorizationEndpoint: "https://example.com/authorize" };
  const result = mergeExternalMcpSavePrefill({ input, existing: existingView() });
  assert.equal(result.oauthAuthorizationEndpoint, "https://example.com/authorize");
  assert.equal(result.oauthTokenEndpoint, undefined);
  assert.equal(result.oauthDeviceAuthorizationEndpoint, undefined);
});

// ---------------------------------------------------------------------------
// buildExternalMcpSaveFormFields
// ---------------------------------------------------------------------------

function fieldNames(input: ExternalMcpSaveInput, isUpdate: boolean): string[] {
  return buildExternalMcpSaveFormFields({ input, isUpdate }).map((f) => f.name);
}

test("stdio, create: id, label, command, args, env and static token fields — in that order, no oauth fields", () => {
  assert.deepEqual(fieldNames({ id: "srv-1", transport: "stdio" }, false), ["id", "label", "command", "args", "env", "accessToken", "accessTokenEnvName"]);
});

test("stdio, update: id field is omitted", () => {
  assert.deepEqual(fieldNames({ id: "srv-1", transport: "stdio" }, true), ["label", "command", "args", "env", "accessToken", "accessTokenEnvName"]);
});

test("streamable_http transport: url field instead of command/args, and no env field", () => {
  assert.deepEqual(fieldNames({ id: "srv-1", transport: "streamable_http" }, false), ["id", "label", "url", "accessToken"]);
});

test("oauth + stdio: oauth core fields, then the stdio-only token-env field, then the endpoint fields", () => {
  assert.deepEqual(fieldNames({ id: "srv-1", transport: "stdio", authMode: "oauth" }, false), [
    "id",
    "label",
    "command",
    "args",
    "env",
    "oauthProviderId",
    "oauthGrant",
    "oauthClientId",
    "oauthClientSecret",
    "oauthScopes",
    "oauthTokenEnvName",
    "oauthAuthorizationEndpoint",
    "oauthTokenEndpoint",
    "oauthDeviceAuthorizationEndpoint",
  ]);
});

test("oauth + streamable_http: no oauthTokenEnvName field (stdio-only)", () => {
  const names = fieldNames({ id: "srv-1", transport: "streamable_http", authMode: "oauth" }, false);
  assert.ok(!names.includes("oauthTokenEnvName"));
  assert.deepEqual(names, ["id", "label", "url", "oauthProviderId", "oauthGrant", "oauthClientId", "oauthClientSecret", "oauthScopes", "oauthAuthorizationEndpoint", "oauthTokenEndpoint", "oauthDeviceAuthorizationEndpoint"]);
});

test("a provided value pre-fills the field; an omitted value leaves no `value` key at all", () => {
  const fields = buildExternalMcpSaveFormFields({ input: { id: "srv-1", transport: "stdio", label: "My Server" }, isUpdate: false });
  const label = fields.find((f) => f.name === "label") as { value?: string };
  const command = fields.find((f) => f.name === "command") as { value?: string };
  assert.equal(label.value, "My Server");
  assert.equal("value" in command, false);
});

test("writeAllowedToolNames: the proposed value is disclosed read-only; omission grants no write access", () => {
  const withValue = buildExternalMcpSaveForm({ save: { id: "srv-1", transport: "stdio", writeAllowedToolNames: "tool_a" }, isUpdate: false , appName: APP_NAME });
  const withoutValue = buildExternalMcpSaveForm({ save: { id: "srv-1", transport: "stdio" }, isUpdate: false , appName: APP_NAME });
  assert.equal(withValue.details?.find(detail => detail.label === "May write")?.value, "tool_a");
  assert.equal(withoutValue.details?.find(detail => detail.label === "May write")?.value, "None");
  assert.equal(withValue.fields.some(field => field.name === "writeAllowedToolNames"), false);
});

test("env field's hint differs between create and update", () => {
  const createEnv = buildExternalMcpSaveFormFields({ input: { id: "srv-1", transport: "stdio" }, isUpdate: false }).find((f) => f.name === "env") as { hint?: string };
  const updateEnv = buildExternalMcpSaveFormFields({ input: { id: "srv-1", transport: "stdio" }, isUpdate: true }).find((f) => f.name === "env") as { hint?: string };
  assert.equal(createEnv.hint, undefined);
  assert.equal(updateEnv.hint, "Leave blank to keep the stored values.");
});

test("oauthClientSecret's hint differs between create and update", () => {
  const createSecret = buildExternalMcpSaveFormFields({ input: { id: "srv-1", transport: "stdio", authMode: "oauth" }, isUpdate: false }).find((f) => f.name === "oauthClientSecret") as { hint?: string };
  const updateSecret = buildExternalMcpSaveFormFields({ input: { id: "srv-1", transport: "stdio", authMode: "oauth" }, isUpdate: true }).find((f) => f.name === "oauthClientSecret") as { hint?: string };
  assert.equal(createSecret.hint, "Leave blank if this provider needs none (a public/PKCE client).");
  assert.equal(updateSecret.hint, "Leave blank to keep the stored secret.");
});

test("neither env nor secret fields ever carry a `value` key, regardless of input", () => {
  const fields = buildExternalMcpSaveFormFields({ input: { id: "srv-1", transport: "stdio", authMode: "oauth" }, isUpdate: false });
  const env = fields.find((f) => f.name === "env");
  const secret = fields.find((f) => f.name === "oauthClientSecret");
  assert.ok(env && secret);
  assert.equal("value" in env, false);
  assert.equal("value" in secret, false);
});

// ---------------------------------------------------------------------------
// `required` flags — the rule these restate lives in `external-mcp-store.ts`'s
// `assertOAuthClientId` / `resolveOAuthTokenEnvName` / `assertOAuthGrant`, and is mirrored on the
// admin side by `apps/admin/src/features/settings/rules.ts`'s `buildExternalMcpFieldSpecs`. A form
// that marks a field required the store would happily accept empty is unsubmittable by any amount
// of operator effort — which is exactly what a hosted server with no developer console hits.

function requiredOf(input: ExternalMcpSaveInput, isUpdate: boolean, name: string): boolean | undefined {
  const field = buildExternalMcpSaveFormFields({ input, isUpdate }).find((f) => f.name === name) as { required?: boolean } | undefined;
  return field?.required;
}

test("streamable_http + oauth: Client ID is NOT required — the row registers itself by RFC 7591", () => {
  assert.notEqual(requiredOf({ id: "srv-1", transport: "streamable_http", authMode: "oauth" }, false, "oauthClientId"), true);
});

test("streamable_http + oauth: Client ID says so, rather than leaving the human hunting for one", () => {
  const field = buildExternalMcpSaveFormFields({ input: { id: "srv-1", transport: "streamable_http", authMode: "oauth" }, isUpdate: false }).find(
    (f) => f.name === "oauthClientId",
  ) as { placeholder?: string };
  assert.equal(field.placeholder, "leave blank to register with this server automatically");
});

test("stdio + oauth: Client ID IS required — there is no URL to discover from", () => {
  assert.equal(requiredOf({ id: "srv-1", transport: "stdio", authMode: "oauth" }, false, "oauthClientId"), true);
  assert.equal(
    (buildExternalMcpSaveFormFields({ input: { id: "srv-1", transport: "stdio", authMode: "oauth" }, isUpdate: false }).find((f) => f.name === "oauthClientId") as {
      placeholder?: string;
    }).placeholder,
    undefined,
  );
});

test("the fields the store genuinely rejects when empty stay required", () => {
  assert.equal(requiredOf({ id: "srv-1", transport: "stdio" }, false, "id"), true);
  assert.equal(requiredOf({ id: "srv-1", transport: "stdio" }, false, "command"), true);
  assert.equal(requiredOf({ id: "srv-1", transport: "streamable_http" }, false, "url"), true);
  assert.equal(requiredOf({ id: "srv-1", transport: "stdio", authMode: "oauth" }, false, "oauthGrant"), true);
  assert.equal(requiredOf({ id: "srv-1", transport: "stdio", authMode: "oauth" }, false, "oauthTokenEnvName"), true);
});

test("streamable_http + oauth: Sign-in method is NOT required — it is detected from the server", () => {
  assert.notEqual(requiredOf({ id: "srv-1", transport: "streamable_http", authMode: "oauth" }, false, "oauthGrant"), true);
});

test("streamable_http + oauth: Sign-in method says so, rather than leaving the human guessing", () => {
  const field = buildExternalMcpSaveFormFields({ input: { id: "srv-1", transport: "streamable_http", authMode: "oauth" }, isUpdate: false }).find(
    (f) => f.name === "oauthGrant",
  ) as { hint?: string };
  assert.equal(field.hint, "Detected from the server unless overridden.");
});

test("stdio + oauth: Sign-in method carries no such hint — there is no server to detect it from", () => {
  const field = buildExternalMcpSaveFormFields({ input: { id: "srv-1", transport: "stdio", authMode: "oauth" }, isUpdate: false }).find(
    (f) => f.name === "oauthGrant",
  ) as { hint?: string };
  assert.equal(field.hint, undefined);
});

test("every other oauth field the store treats as optional is rendered optional", () => {
  const http: ExternalMcpSaveInput = { id: "srv-1", transport: "streamable_http", authMode: "oauth" };
  for (const name of ["oauthProviderId", "oauthClientSecret", "oauthScopes", "oauthAuthorizationEndpoint", "oauthTokenEndpoint", "oauthDeviceAuthorizationEndpoint"]) {
    assert.notEqual(requiredOf(http, false, name), true, `${name} must not be required`);
  }
});

test("a self-configuring remote connection's identity hints do not tell it to supply endpoints", () => {
  const fields = buildExternalMcpSaveFormFields({ input: { id: "srv-1", transport: "streamable_http", authMode: "oauth" }, isUpdate: false });
  const hintOf = (name: string) => (fields.find((f) => f.name === name) as { hint?: string }).hint;
  assert.equal(hintOf("oauthProviderId"), "Leave blank unless this server is a registered provider — a hosted server discovers its own endpoints.");
  assert.equal(hintOf("oauthAuthorizationEndpoint"), "Leave blank unless discovery against this server's URL fails.");
  assert.equal(hintOf("oauthTokenEndpoint"), "Leave blank unless discovery against this server's URL fails.");
  assert.equal(hintOf("oauthDeviceAuthorizationEndpoint"), "Leave blank unless discovery against this server's URL fails.");
});

test("a stdio connection still gets the hints that tell it to supply its own endpoints", () => {
  const fields = buildExternalMcpSaveFormFields({ input: { id: "srv-1", transport: "stdio", authMode: "oauth" }, isUpdate: false });
  const hintOf = (name: string) => (fields.find((f) => f.name === name) as { hint?: string }).hint;
  assert.equal(hintOf("oauthProviderId"), "Leave blank to use your own endpoints below.");
  assert.equal(hintOf("oauthAuthorizationEndpoint"), "Needed for Browser sign-in, unless Provider ID is set.");
  assert.equal(hintOf("oauthTokenEndpoint"), "Needed unless Provider ID is set.");
  assert.equal(hintOf("oauthDeviceAuthorizationEndpoint"), "Needed for Device code, unless Provider ID is set.");
});

test("explicit prefill values, including empty strings, win over every stored value", () => {
  const input: ExternalMcpSaveInput = {
    id: "srv-1", transport: "streamable_http", enabled: false, label: "", command: "node", args: "",
    url: "https://new.example/mcp", allowedToolNames: "", writeAllowedToolNames: "",
    authMode: "oauth", accessTokenEnvName: "NEW_TOKEN", oauthProviderId: "new-provider",
    oauthGrant: "authorization_code", oauthClientId: "new-client", oauthScopes: "",
    oauthTokenEnvName: "NEW_OAUTH_TOKEN", oauthAuthorizationEndpoint: "https://new.example/auth",
    oauthTokenEndpoint: "https://new.example/token", oauthDeviceAuthorizationEndpoint: "https://new.example/device",
  };
  const existing = existingView({ accessTokenEnvName: "OLD_TOKEN" });
  assert.deepEqual(mergeExternalMcpSavePrefill({ input, existing }), input);
  assert.equal(mergeExternalMcpSavePrefill({ input: BASE_INPUT, existing }).accessTokenEnvName, "OLD_TOKEN");
  assert.equal(mergeExternalMcpSavePrefill({ input: BASE_INPUT, existing: existingView() }).accessTokenEnvName, undefined);
});

test("static_env explicitly selects token entry and none omits credential fields", () => {
  for (const isUpdate of [false, true]) {
    const fields = buildExternalMcpSaveFormFields({ input: { ...BASE_INPUT, authMode: "static_env", accessTokenEnvName: "API_TOKEN" }, isUpdate });
    const token = fields.find(field => field.name === "accessToken")!;
    assert.equal(token.hint, isUpdate ? "Leave blank to keep the stored token." : "Enter the API key or bearer token for this server.");
    assert.equal(Object.hasOwn(token, "value"), false);
    assert.equal((fields.find(field => field.name === "accessTokenEnvName") as { value: string }).value, "API_TOKEN");
  }
  const form = buildExternalMcpSaveForm({ save: { ...BASE_INPUT, authMode: "none" }, isUpdate: false , appName: APP_NAME }, {});
  assert.deepEqual(form.details, [{ label: "Connection type", value: "Local command (stdio)" }, { label: "Credentials", value: "None needed" }, { label: "Allowed tools", value: "None" }, { label: "May write", value: "None" }, { label: "Local access", value: "Saving lets chats start the command below on this computer as your OS user." }]);
  assert.deepEqual(form.fields.map(field => field.name), ["id", "label", "command", "args", "env"]);
});

// L155 pins: the merge's complete field contract, including explicit blank clears.
for (const override of [undefined, "", "replacement"]) test(`prefill applies ${String(override)} consistently across every optional field`, () => {
  const fallback = {
    label: "Existing Label", command: "npx some-server", args: "--flag", url: "https://stored.example/mcp",
    allowedToolNames: "tool_a, tool_b", writeAllowedToolNames: "tool_b", authMode: "oauth",
    accessTokenEnvName: "STATIC_TOKEN", oauthProviderId: "provider", oauthGrant: "device_code",
    oauthClientId: "client", oauthScopes: "read write", oauthTokenEnvName: "OAUTH_TOKEN",
    oauthAuthorizationEndpoint: undefined, oauthTokenEndpoint: undefined, oauthDeviceAuthorizationEndpoint: undefined,
  };
  const existing = existingView({ url: fallback.url, authMode: "oauth", accessTokenEnvName: fallback.accessTokenEnvName,
    writeAllowedToolNames: ["tool_b"], oauth: { providerId: "provider", grant: "device_code", clientId: "client",
      scopes: ["read", "write"], tokenEnvName: "OAUTH_TOKEN", status: "connected", expiresAt: null, hasStoredToken: true } });
  const overrides = Object.fromEntries(Object.keys(fallback).map(key => [key, override]));
  const input: ExternalMcpSaveInput = { ...BASE_INPUT, ...overrides };
  const before = structuredClone(existing);
  assert.deepEqual(mergeExternalMcpSavePrefill({ input, existing }), {
    id: BASE_INPUT.id, transport: BASE_INPUT.transport, enabled: true,
    ...Object.fromEntries(Object.entries(fallback).map(([key, value]) => [key, override ?? value])),
  });
  assert.deepEqual(existing, before);
  assert.deepEqual(input, { ...BASE_INPUT, ...overrides });
});

test("common form fields preserve blank prefills, required flags, order and permission hints", () => {
  for (const transport of ["stdio", "streamable_http"]) {
    const fields = buildExternalMcpSaveFormFields({ input: { id: "server", transport, label: "", url: "", allowedToolNames: "", writeAllowedToolNames: "" }, isUpdate: false });
    assert.deepEqual(fields.slice(0, 2), [
      { kind: "string", name: "id", label: "ID", required: true, value: "server", hint: "Lowercase letters, digits and dashes." },
      { kind: "string", name: "label", label: "Display name", value: "" },
    ]);
    assert.deepEqual(fields.filter(field => ["allowedToolNames", "writeAllowedToolNames"].includes(field.name)), []);
    const form = buildExternalMcpSaveForm({ save: { id: "server", transport, allowedToolNames: "read", writeAllowedToolNames: "" }, isUpdate: false , appName: APP_NAME });
    assert.deepEqual(form.details?.filter(detail => ["Allowed tools", "May write"].includes(detail.label)), [
      { label: "Allowed tools", value: "read" }, { label: "May write", value: "None" },
    ]);
    if (transport === "streamable_http") assert.deepEqual(fields[2], { kind: "string", name: "url", label: "URL", required: true, value: "", placeholder: "https://…" });
  }
});


test("save cards disclose site-wide access, local OS execution and the tool allowlist", () => {
  const local = buildExternalMcpSaveForm({ save: { ...BASE_INPUT, command: "node", allowedToolNames: "read" }, isUpdate: false , appName: APP_NAME });
  assert.match(local.description!, /Saved for the whole site: every chat and agent can use it, with approvals/);
  assert.ok(local.details?.some(detail => detail.value === "Saving lets chats start node on this computer as your OS user."));
  assert.deepEqual(local.details?.find(detail => detail.label === "Allowed tools"), { label: "Allowed tools", value: "read" });
  assert.equal(local.fields.some(field => field.name === "allowedToolNames"), false);
  const hosted = buildExternalMcpSaveForm({ save: { ...BASE_INPUT, transport: "streamable_http" }, isUpdate: true , appName: APP_NAME });
  assert.match(hosted.description!, /Saved for the whole site/);
  assert.equal(hosted.details?.some(detail => detail.label === "Local access"), false);
});

test("save prefill preserves disabled state and an explicit toggle wins", () => {
  const existing = existingView({ enabled: false });
  assert.equal(mergeExternalMcpSavePrefill({ input: BASE_INPUT, existing }).enabled, false);
  assert.equal(mergeExternalMcpSavePrefill({ input: { ...BASE_INPUT, enabled: true }, existing }).enabled, true);
});


test("unchanged argument prefills preserve empty arguments alongside literal equals and Windows paths", () => {
  const args = ["", "--name=x", "C:\\Users\\John Smith\\server", ""];
  const before = existingView({ args });
  const prefill = mergeExternalMcpSavePrefill({ input: BASE_INPUT, existing: before });
  assert.deepEqual(parseArgs({ raw: prefill.args! }), args);
  assert.deepEqual(before.args, args, "prefill does not mutate the stored view");
});

test("buildExternalMcpSaveForm: the MCP-UI app identity is the host's injected app name", () => {
  const form = buildExternalMcpSaveForm({ save: BASE_INPUT, isUpdate: false, appName: APP_NAME });
  assert.deepEqual(form.app, { appName: APP_NAME, appVersion: "1" });
});
