import { describe, expect, it } from "vitest";
import { SURFACE_DISMISSED_PARAM, SURFACE_EXCHANGE_ID_PARAM, type SurfaceAskThenReport, type SurfaceEmitter, type SurfaceExchange, type SurfaceExchangeStore, type ToolExecutionContext, type ToolExecutionOptions, type ToolHandler } from "@jini-ai/core";
import type { InstanceAuthorizeFn } from "@jini-ai/core/gated-mutations";
import type { SurfaceCardFormSpec } from "@jini-ai/core/contracts/cards";
import { createCredentialCopyRegistrations } from "../credential-copy-tool.js";
import type { CredentialCopyMessages, CredentialCopyProjectKeysPort, CredentialCopyToolHost } from "../credential-tool-host.js";

type Answer = Parameters<Parameters<SurfaceAskThenReport>[0]["handle"]>[0];
type Choice = { keyId: string; name: string; locked?: string };

const messages: CredentialCopyMessages = { ownerOnly: "owner-only", instanceRefused: "instance-refused", unexpectedField: "unexpected-field", notOffered: "not-offered",
  inputNotEmpty: "input-not-empty", keysUnavailable: "keys-unavailable", needsInteractive: "needs-interactive", cardTitle: "Pick a key", siteLabel: "Site",
  siteFallback: "this site", cardDescription: "card-desc", emptyCardDescription: "empty-desc", lockedLabel: ({ names }) => `locked: ${names.join(", ")}`,
  outcomes: { dismissed: "dismissed-msg", interrupted: "interrupted-msg", nothingToPick: "nothing-msg" }, fieldLabel: "Key", fieldPlaceholder: "Choose",
  newKeyLabel: "Enter a new key", submitLabel: "Use", cancelLabel: "Cancel" };
const CHOICES: Choice[] = [{ keyId: "k1", name: "Alpha" }, { keyId: "k2", name: "Beta", locked: "Expired" }, { keyId: "k3", name: "Gamma", locked: "Expired" }];
const EMIT: SurfaceEmitter = async () => undefined;

interface RigOptions { projectKeys?: Partial<CredentialCopyProjectKeysPort> | null; answer?: Answer; deny?: string[]; instance?: InstanceAuthorizeFn; saveNew?: ToolHandler; choices?: Choice[]; site?: { name: string } | null }

/** One registration over recording fakes: RBAC, project keys, exchange store and the card protocol. */
function rig(_over: RigOptions = {}) {
  const authorizeCalls: { principalId: string; permission: string }[] = [];
  const forms: SurfaceCardFormSpec[] = [];
  const emissions: unknown[] = [];
  const uses: unknown[] = [];
  const opened: unknown[] = [];
  let closes = 0;
  const ask: SurfaceAskThenReport = async ({ confirmationEmission, handle }) => {
    emissions.push(confirmationEmission);
    return (await handle(_over.answer ?? { status: "received", params: { credentialId: "k1", [SURFACE_EXCHANGE_ID_PARAM]: "ex-1" } })).result;
  };
  const host: CredentialCopyToolHost<SurfaceCardFormSpec> = {
    vocabulary: { toolId: "key_copy", domain: "keys", catalogModule: "keys-catalog", ownerPermission: "keys.own", newKeyValue: "__new__", cardPath: "key-picker" },
    cardIdentity: { uriNamespace: "jini" }, metadata: {}, derivedRisk: new Map([["key_copy", "mutates-durable-state"]]), messages,
    catalog: [{ name: "key_copy", description: "Copy a key", sideEffects: "mutates-durable-state", authorization: { permission: "keys.own" }, inputSchema: { type: "object" } }],
    protocol: { askThenReport: ask, buildFormSurface: spec => { forms.push(spec); return spec; } },
  };
  const keys: CredentialCopyProjectKeysPort = { ...(_over.site === null ? {} : { site: _over.site ?? { name: "Blog" } }), listChoices: async () => _over.choices ?? CHOICES, permissionFor: async ({ keyId }) => `keys.${keyId}`,
    use: async input => { uses.push(input); return { keyId: `used-${input.keyId}` }; }, savedResult: async ({ result }) => ({ saved: result }), ..._over.projectKeys };
  const exchange: Partial<SurfaceExchange> = { id: "ex-1", close: () => { closes += 1; } };
  const store: Partial<SurfaceExchangeStore> = { open: input => { opened.push(input); return exchange as SurfaceExchange; } };
  const surfaceExchanges = store as SurfaceExchangeStore;
  const [registration] = createCredentialCopyRegistrations({ host, surfaces: { surfaceExchanges }, deps: {
    workspaceId: "ws-1", ownerPrincipalId: Promise.resolve("owner"),
    authorize: async ({ principalId, permission }) => { authorizeCalls.push({ principalId, permission }); return _over.deny?.includes(permission) ? { allowed: false, reason: "no_grant" } : { allowed: true, reason: "ok" }; },
    gatedMutations: { gatewayDeps: _over.instance ? { authorizeInstance: _over.instance } : {} },
    ...(_over.projectKeys === null ? {} : { projectKeys: keys }),
  } }, _over.saveNew ? { saveNew: _over.saveNew } : {});
  const run = (ctx: { input?: unknown; principalId?: string; signal?: AbortSignal } = {}, options: ToolExecutionOptions = { emitSurface: EMIT }) => {
    const context = { executionId: "x1", input: "input" in ctx ? ctx.input : {}, principal: { id: ctx.principalId ?? "owner" }, signal: ctx.signal ?? new AbortController().signal };
    if (!registration) throw new Error("no registration");
    return registration.handler(context as Partial<ToolExecutionContext> as ToolExecutionContext, options);
  };
  return { run, authorizeCalls, forms, emissions, uses, opened, closes: () => closes };
}

describe("credential copy tool admission", () => {
  it.each([[{ a: 1 }], [null], [[]], ["text"]])("refuses model input %j: the selection comes only from the card", async input => {
    const r = rig();
    await expect(r.run({ input })).rejects.toThrow("input-not-empty");
    expect(r.authorizeCalls).toEqual([]);
  });
  it("refuses anyone but the installation owner before any permission check", async () => {
    const r = rig();
    await expect(r.run({ principalId: "guest" })).rejects.toThrow("owner-only");
    expect(r.authorizeCalls).toEqual([]);
  });
  it("propagates the owner's RBAC denial", async () => {
    await expect(rig({ deny: ["keys.own"] }).run()).rejects.toThrow("principal 'owner' is not authorized for 'keys.own' (no_grant)");
  });
  it("asks the instance gate with the owner permission and refuses when it says no", async () => {
    const asked: unknown[] = [];
    await expect(rig({ instance: async input => { asked.push(input); return { allowed: false, reason: "paused" }; } }).run()).rejects.toThrow("instance-refused");
    expect(asked).toEqual([{ principalId: "owner", permission: "keys.own" }]);
  });
  it("needs an interactive transport to show the card", async () => {
    await expect(rig().run({}, {})).rejects.toThrow("needs-interactive");
  });
});

describe("credential copy tool without project keys", () => {
  it("refuses when there is neither a key inventory nor a normal key card", async () => {
    await expect(rig({ projectKeys: null }).run()).rejects.toThrow("keys-unavailable");
  });
  it("falls back to the normal key card with empty input and re-admits the owner afterwards", async () => {
    const seen: unknown[] = [];
    const r = rig({ projectKeys: null, saveNew: async ctx => { seen.push(ctx.input); return { saved: "plain" }; } });
    expect(await r.run()).toEqual({ saved: "plain" });
    expect([seen, r.authorizeCalls.length]).toEqual([[{}], 2]);
  });
  it("stops after the normal key card when the call was aborted meanwhile", async () => {
    const controller = new AbortController();
    const r = rig({ projectKeys: null, saveNew: async () => { controller.abort(new Error("cancelled")); return {}; } });
    await expect(r.run({ signal: controller.signal })).rejects.toThrow("cancelled");
    expect(r.authorizeCalls).toHaveLength(1);
  });
});

describe("credential copy tool key picker", () => {
  it("offers unlocked keys, names locked ones by reason, and grants the picked key after re-checking its permission", async () => {
    const r = rig();
    expect(await r.run()).toEqual({ granted: true, credentialId: "used-k1" });
    expect(r.forms[0]).toMatchObject({ uri: "ui://jini/key-picker/ex-1", title: "Pick a key", description: "card-desc", toolName: "key_copy", submitLabel: "Use",
      details: [{ label: "Site", value: "Blog" }, { label: "locked: Beta, Gamma", value: "Expired" }], baseParams: { [SURFACE_EXCHANGE_ID_PARAM]: "ex-1" },
      cancel: { label: "Cancel", toolName: "key_copy", params: { [SURFACE_EXCHANGE_ID_PARAM]: "ex-1", [SURFACE_DISMISSED_PARAM]: true } } });
    expect(r.forms[0]?.fields[0]).toMatchObject({ name: "credentialId", required: true, options: [{ value: "k1", label: "Alpha" }, { value: "__new__", label: "Enter a new key" }] });
    expect(r.emissions).toEqual([{ channel: "mcp-ui", payload: { resource: r.forms[0] } }]);
    expect(r.opened).toEqual([{ binding: { toolId: "key_copy", principalId: "owner", channel: "mcp-ui" }, emit: EMIT }]);
    expect(r.authorizeCalls.map(c => c.permission)).toEqual(["keys.own", "keys.own", "keys.k1"]);
    expect([r.uses, r.closes()]).toEqual([[{ keyId: "k1", use: true }], 1]);
  });
  it("falls back to the generic site name and the empty description when nothing can be picked; dismissing then means nothing-to-pick", async () => {
    const r = rig({ choices: [CHOICES[1] as Choice], site: null, answer: { status: "received", params: { [SURFACE_DISMISSED_PARAM]: true } } });
    expect(await r.run()).toEqual({ granted: false, reason: "nothing-to-pick", message: "nothing-msg" });
    expect(r.forms[0]).toMatchObject({ description: "empty-desc", details: [{ label: "Site", value: "this site" }, { label: "locked: Beta", value: "Expired" }] });
  });
  it("reports a dismissal with keys on offer, and an expired card as interrupted", async () => {
    expect(await rig({ answer: { status: "received", params: { [SURFACE_DISMISSED_PARAM]: true } } }).run()).toEqual({ granted: false, reason: "dismissed", message: "dismissed-msg" });
    expect(await rig({ answer: { status: "expired" } }).run()).toEqual({ granted: false, reason: "interrupted", message: "interrupted-msg" });
  });
  it("closes the exchange at once and reports interrupted when the call is aborted while the card opens", async () => {
    const controller = new AbortController();
    const r = rig({ projectKeys: { listChoices: async () => { controller.abort(); return CHOICES; } } });
    expect(await r.run({ signal: controller.signal })).toEqual({ granted: false, reason: "interrupted", message: "interrupted-msg" });
    expect([r.uses, r.closes()]).toEqual([[], 2]);
  });
  it("refuses an extra submitted field and a key that was not offered", async () => {
    await expect(rig({ answer: { status: "received", params: { credentialId: "k1", siteId: "other" } } }).run()).rejects.toThrow("unexpected-field");
    const locked = rig({ answer: { status: "received", params: { credentialId: "k2" } } });
    await expect(locked.run()).rejects.toThrow("not-offered");
    expect(locked.closes()).toBe(1);
  });
  it("stops before use when the call is aborted after the permission re-check", async () => {
    const controller = new AbortController();
    const r = rig({ projectKeys: { permissionFor: async () => { controller.abort(new Error("gone")); return "keys.k1"; } } });
    await expect(r.run({ signal: controller.signal })).rejects.toThrow("gone");
    expect(r.uses).toEqual([]);
  });
  it("hands a new-key choice to the normal key card and returns its saved result through the project keys port", async () => {
    const r = rig({ answer: { status: "received", params: { credentialId: "__new__" } }, saveNew: async () => ({ id: "new-1" }) });
    expect(await r.run()).toEqual({ saved: { id: "new-1" } });
    expect(r.authorizeCalls.map(c => c.permission)).toEqual(["keys.own", "keys.own", "keys.own"]);
  });
  it("reports a new-key choice as such when no normal key card is wired", async () => {
    expect(await rig({ answer: { status: "received", params: { credentialId: "__new__" } } }).run()).toEqual({ granted: false, newKey: true });
  });
  it("proceeds when the instance gate allows", async () => {
    expect(await rig({ instance: async () => ({ allowed: true, reason: "ok" }) }).run()).toEqual({ granted: true, credentialId: "used-k1" });
  });
});
