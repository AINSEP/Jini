import { ToolInputError, type ToolExecutionContext } from "@jini-ai/core";
import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import { expect, it, vi } from "vitest";
import { createPublishJobStore } from "../../publish-jobs.js";
import { contributeStaticPublishTools } from "../publish-agent-tools.js";
import { optionalPublishPorts, type StaticPublishToolDeps } from "../publish-tool-deps.js";
import { executeStaticPublish, mapPublishOutcomeToToolResult, previewStaticPublish } from "../publish-tool-execution.js";
import type { LoadedDeployTarget } from "../deploy-targets/types.js";
import { createDeployHostKit } from "../deploy-targets/host-kit.js";
import { InMemoryPublishHistoryStore } from "../static-publish/publish-history.js";
import type { PublishCredentialSource, StaticPublishOutcome } from "../static-publish/types.js";
import { credentialTarget, storeFixture } from "../publish-credentials/__tests__/store-fixture.js";

const docHost = credentialTarget("docs", "docs-vendor", [
  { name: "token", label: "Token", required: true },
  { name: "region", label: "Region", required: false },
]);
const host: LoadedDeployTarget = {
  ...docHost,
  descriptor: { ...docHost.descriptor, configFields: [{ name: "repo", label: "Repository", required: true }] },
  module: { ...docHost.module, basePath: ({ repo }) => repo === "guide" ? "/docs/guide" : undefined },
};
const history = () => new InMemoryPublishHistoryStore({ peerKind: "peer", resolvePublishHistoryListLimit: ({ requested }) => requested ?? 20 });

function context(input: unknown): ToolExecutionContext {
  return { executionId: "execution-7", principal: { id: "operator" }, run: { id: "run" }, input, signal: new AbortController().signal };
}

function fixture(target = host) {
  const grants: unknown[] = [];
  const requireToolPermission: StaticPublishToolDeps["requireToolPermission"] = async ({ workspaceId, principalId, permission }, options) => {
    grants.push({ workspaceId, principalId, permission, options });
  };
  const buildOutcomeSurface = vi.fn<StaticPublishToolDeps["buildOutcomeSurface"]>(({ uri, title }) =>
    ({ type: "resource", resource: { uri, mimeType: "text/html", text: title } }));
  const { deps: store, repo, registry } = storeFixture([target]);
  const publishJobs = createPublishJobStore<StaticPublishOutcome>({});
  const credentialSource: PublishCredentialSource = {
    isConfigured: vi.fn(async () => ({ configured: false as const, reason: "Save a key first" })),
    resolve: async () => { throw new Error("readiness must not open the saved key"); },
  };
  const catalog: StaticPublishToolDeps["catalog"] = [
    { name: "deployment_preview_static_publish", sideEffects: "none" },
    { name: "deployment_get_static_publish_capabilities", sideEffects: "none" },
    { name: "deployment_get_static_publish_status", sideEffects: "none" },
    { name: "deployment_execute_static_publish", sideEffects: "mutates-durable-state" },
    { name: "deployment_generate_bucket_hosting_setup", sideEffects: "none" },
  ].map(({ name, sideEffects }) => ({ name, sideEffects: sideEffects as "none" | "mutates-durable-state", description: name, inputSchema: { type: "object" }, authorization: { permission: "deployments.read" } }));
  const historyStore = history();
  const deps = {
    catalog, workspaceId: "site", uriHost: "test.host", credentialSource, publishHistoryStore: historyStore,
    loadDeployTargets: async ({ workspaceId }: { workspaceId: string }) => { expect(workspaceId).toBe("site"); return registry; },
    assertCredentialFreeField: store.assertCredentialFreeField, vendorCredentialSetRepo: repo,
    authorize: async () => ({ allowed: true }), requireToolPermission, staticPublishPorts: { publishJobs }, buildOutcomeSurface,
    checkToolPublishConsent: async () => null,
    issueCredentialSetup: vi.fn(({ setupToolId, prefill }: { setupToolId: string; prefill: Record<string, string> }) => ({ setupToolId, prefill })),
  } as unknown as StaticPublishToolDeps;
  return { deps, buildOutcomeSurface, grants, credentialSource, publishJobs, historyStore };
}

const readGrant = { workspaceId: "site", principalId: "operator", permission: "deployments.read", options: { entityType: "site-publish" } };
const surfaces = {} as AssistantSurfaceDeps; // No card may be opened by a read or a preflight refusal.

it("status looks up only this site's retained publish and replaces its outcome with model-facing facts", async () => {
  const { deps, publishJobs, grants } = fixture();
  const contribution = contributeStaticPublishTools();
  expect(contribution.domain).toBe("static-publish");
  const registrations = contribution.build(deps, surfaces);
  const status = registrations.find(item => item.descriptor.id === "deployment_get_static_publish_status");
  if (!status) throw new Error("publish status tool is not registered");
  expect(status.descriptor.readOnly).toBe(true);
  expect(registrations.find(item => item.descriptor.id === "deployment_execute_static_publish")?.descriptor.readOnly).toBe(false);
  const now = "2026-10-01T00:00:00Z";
  publishJobs.begin({ scopeId: "site", jobId: "here", requestId: "execution-7", target: "docs", startedAtIso: now });
  expect(await status.handler(context({}))).toMatchObject({ jobId: "here", status: "running" });
  publishJobs.settle({ jobId: "here", status: "completed", finishedAtIso: now,
    result: { ok: true, url: "https://docs.example.test", targetId: "docs", status: "ready", credentialId: "not-for-tool-output" } });
  publishJobs.begin({ scopeId: "another-site", jobId: "elsewhere", startedAtIso: now, target: "docs" });
  const local = await status.handler(context({ executionId: "execution-7" }));
  expect(local).toMatchObject({ jobId: "here", status: "completed", result: {
    published: true, target: "docs", reachable: true, url: "https://docs.example.test", status: "ready",
  } });
  expect(JSON.stringify(local)).not.toContain("not-for-tool-output");
  expect(await status.handler(context({ jobId: "elsewhere" }))).toMatchObject({
    code: "PUBLISH_JOB_NOT_FOUND", message: expect.stringContaining("A restart clears job snapshots"),
  });
  await expect(status.handler(context({ target: "docs" }))).rejects.toThrow("Unknown publish-status field 'target'");
  expect(grants).toEqual([readGrant, readGrant, readGrant]);
});

it("hosting setup passes only verified non-secret fields and preserves the plugin's user-facing refusal", async () => {
  const result = { steps: [{ title: "Enable hosting", description: "Choose the static endpoint" }], warning: "Propagation can take time" };
  const hostingSetup = vi.fn<NonNullable<LoadedDeployTarget["module"]["hostingSetup"]>>()
    .mockReturnValueOnce(result).mockImplementationOnce(() => { throw "Region must be west"; });
  const { deps, grants } = fixture({ ...host, module: { ...host.module, hostingSetup } });
  const tool = contributeStaticPublishTools().build(deps, surfaces).find(item => item.descriptor.id === "deployment_generate_bucket_hosting_setup");
  if (!tool) throw new Error("hosting setup tool is not registered");
  expect(await tool.handler(context({ target: "docs", region: "west" }))).toEqual(result);
  await expect(tool.handler(context({ target: "docs", region: "east" }))).rejects.toThrow("Region must be west");
  await expect(tool.handler(context({ target: "docs", token: "never-accept-chat-token" }))).rejects.toThrow("'token' is secret");
  expect(hostingSetup.mock.calls).toEqual([[{ fields: { region: "west" } }], [{ fields: { region: "east" } }]]);
  expect(grants).toEqual([readGrant, readGrant]);
});

it("keeps optional publish collaborators by identity and omits every absent wire key", () => {
  expect(optionalPublishPorts({ deps: {} })).toEqual({});
  const notCalled = () => { throw new Error("binding must not use the collaborator"); };
  const ports = {
    buildTarget: notCalled, publicPageSecurityHeaders: notCalled, pluginExportHosts: notCalled,
    hostKit: createDeployHostKit({ fetchFn: notCalled, createReachability: notCalled, createSigV4Client: notCalled, now: notCalled, sleep: notCalled }),
    formDestination: { previewInput: notCalled, prepare: notCalled },
    tracker: { capture: notCalled, error: notCalled, trace: notCalled, metric: notCalled },
    observability: {
      trackRequest: notCalled, trackDbQuery: notCalled, trackOutboundCall: notCalled, trackAgentRun: notCalled,
      trackOperation: notCalled, reportError: notCalled, metric: notCalled,
    },
  } satisfies Parameters<typeof optionalPublishPorts>[0]["deps"];
  expect(optionalPublishPorts({ deps: ports })).toEqual(ports);
  for (const [key, value] of Object.entries(ports)) expect(Object.getOwnPropertyDescriptor(optionalPublishPorts({ deps: ports }), key)?.value).toBe(value);
});

it("preview validates descriptor fields before readiness and forwards only the selected credential id", async () => {
  const { deps, grants, credentialSource } = fixture();
  const preview = (input: unknown) => previewStaticPublish({ deps, credentialSource, ctx: context(input) });
  const unknown = preview({ target: "off" });
  await expect(unknown).rejects.toThrow(ToolInputError);
  await expect(unknown).rejects.toThrow("publish target 'off' is not available; choose one of: docs");
  await expect(preview({ target: "docs", repo: "guide", outputDir: "/unexpected" })).rejects.toThrow("'outputDir' is not a field of docs. It takes: repo.");
  await expect(preview({ target: "docs", repo: 19 })).rejects.toThrow("'repo' must be a string");
  await expect(preview({ target: "docs", repo: "guide", credentialId: " " })).rejects.toThrow("credentialId must be a non-empty string");
  expect(credentialSource.isConfigured).not.toHaveBeenCalled();
  expect(await preview({ target: "docs", repo: " " })).toEqual({
    target: "docs", valid: false, validationError: "'repo' (non-empty string) is required for target 'docs'", basePath: null, credentialsConfigured: false, credentialGuidance: "Save a key first",
  });
  expect(await preview({ target: "docs", repo: "guide", credentialId: "selected" })).toEqual({
    target: "docs", valid: true, basePath: "/docs/guide", credentialsConfigured: false, credentialGuidance: "Save a key first",
  });
  expect(credentialSource.isConfigured).toHaveBeenNthCalledWith(1, { workspaceId: "site", target: "docs" });
  expect(credentialSource.isConfigured).toHaveBeenNthCalledWith(2, { workspaceId: "site", target: "docs", credentialId: "selected" });
  expect(grants).toEqual(Array.from({ length: 5 }, () => readGrant));
});

it("execute refuses invalid configuration, missing consent and unavailable credentials before dispatch", async () => {
  const { deps, credentialSource, historyStore, publishJobs, grants } = fixture();
  const execute = (input: unknown, dependencies = deps) =>
    executeStaticPublish({ deps: dependencies, surfaces, credentialSource, historyStore, inputCtx: context(input), optional: {} });
  await expect(execute({ target: "docs", projectName: "Guide" })).rejects.toThrow(
    "deployment_execute_static_publish: 'repo' (non-empty string) is required for target 'docs'");
  const valid = { target: "docs", projectName: "Guide", repo: "guide" };
  expect(await execute(valid, { ...deps, checkToolPublishConsent: async () => ({ code: "CONSENT_REQUIRED", hint: "Review the publish policy" }) })).toEqual({
    published: false, cancelled: false, code: "CONSENT_REQUIRED", hint: "Review the publish policy",
  });
  expect(credentialSource.isConfigured).not.toHaveBeenCalled();
  expect(await execute(valid)).toMatchObject({
    published: false, cancelled: false, reason: "no-credential",
    credentialSetup: { setupToolId: "credential_save", prefill: { kind: "publish-host", target: "docs" } },
    message: expect.stringContaining("(Save a key first)"),
  });
  expect(publishJobs.latest()).toBeUndefined();
  expect(grants).toEqual(Array.from({ length: 3 }, () => ({ ...readGrant, permission: "deployments.publish" })));
});

it.each([
  {
    label: "provider failed", value: { ok: false, code: "NO_CREDENTIALS_CONFIGURED", message: "Connect Docs first", credentialSetup: { setupToolId: "credential_save" } },
    result: { published: false, cancelled: false, code: "NO_CREDENTIALS_CONFIGURED", message: "Connect Docs first", credentialSetup: { setupToolId: "credential_save" } },
    card: { title: "Publish failed", state: "failure", message: "Connect Docs first" },
  },
  {
    label: "uploaded but not yet reachable", value: { ok: "partial", targetId: "docs", url: "https://docs.example.test", status: "uploaded", message: "DNS pending", consentWarning: "Review allowed origins" },
    result: { published: true, target: "docs", url: "https://docs.example.test", status: "uploaded", reachable: false, message: "DNS pending", consentWarning: "Review allowed origins" },
    card: { title: "Uploaded, not live yet", state: "partial", message: "DNS pending Review allowed origins", openLinkUrl: "https://docs.example.test", openLinkLabel: "Open when ready" },
  },
  {
    label: "live", value: { ok: true, targetId: "docs", url: "https://docs.example.test", status: "ready", basePath: "/guide", deploymentId: "deploy-7", providerMetadata: { repo: "guide" } },
    result: { published: true, target: "docs", url: "https://docs.example.test", status: "ready", reachable: true, basePath: "/guide", deploymentId: "deploy-7", providerMetadata: { repo: "guide" } },
    card: { title: "Published", state: "success", message: "Published live at https://docs.example.test.", openLinkUrl: "https://docs.example.test", openLinkLabel: "Open site" },
  },
] satisfies ReadonlyArray<{ label: string; value: StaticPublishOutcome; result: object; card: { title: string } & Record<string, unknown> }>)("maps $label to a distinct tool result and outcome card", ({ value, result, card }) => {
  const { deps, buildOutcomeSurface } = fixture();
  const mapped = mapPublishOutcomeToToolResult({ deps, outcome: value, exchange: { id: "dialog-7" }, config: { target: "docs" },
    detailRows: [{ label: "Repository", value: "guide" }], projectName: "Guide" });
  const uri = "ui://test.host/deployment-execute-static-publish/dialog-7";
  expect(mapped.result).toEqual(result);
  expect(buildOutcomeSurface).toHaveBeenCalledExactlyOnceWith({
    uri, ...card, preferredFrameSize: ["100%", "360px"],
    details: [{ label: "Target", value: "docs" }, { label: "Project name", value: "Guide" }, { label: "Repository", value: "guide" }],
  });
  expect(mapped.outcome).toEqual({ channel: "mcp-ui", payload: { resource: { type: "resource", resource: { uri, mimeType: "text/html", text: card.title } } } });
});

it("approval rechecks consent and reserves one scoped publish job before background resolution", async () => {
  const { deps: base, publishJobs, historyStore, grants } = fixture();
  const readiness = vi.fn<PublishCredentialSource["isConfigured"]>(async () => ({ configured: true, basis: { id: "selected", revision: 1 } }));
  let revoke = true;
  const consent = vi.fn<StaticPublishToolDeps["checkToolPublishConsent"]>(async () => {
    const sinceReview = revoke && consent.mock.calls.length === 2;
    return sinceReview ? { code: "CONSENT_REVOKED" } : null;
  });
  const card = vi.fn<StaticPublishToolDeps["toolApprovalConfirmation"]>(() => ({
    toolId: "publish-proposal", errorCode: "PUBLISH", title: "Publish the guide?", details: [], confirmLabel: "Publish",
  }));
  const approvalToolHandler: StaticPublishToolDeps["approvalToolHandler"] = (steps, options) => async (ctx, optional = {}) => {
    expect(options).toEqual({ flag: "published" });
    const prepared = await steps.prepare({ ctx }, optional);
    expect(await steps.describe({ ctx, prepared }, optional)).toEqual({
      toolId: "deployment_execute_static_publish", errorCode: "PUBLISH", title: "Publish the guide?", details: [], confirmLabel: "Publish",
    });
    return steps.run({ ctx, prepared, confirmer: { id: "operator", kind: "user" } }, optional);
  };
  let release!: (value: { ok: false; reason: string }) => void;
  const runtime = new Promise<{ ok: false; reason: string }>(resolve => { release = resolve; });
  const resolve = vi.fn<PublishCredentialSource["resolve"]>(() => runtime);
  const credentialSource: PublishCredentialSource = { isConfigured: readiness, resolve };
  const exportSiteBound = vi.fn<StaticPublishToolDeps["exportSiteBound"]>(async () => { throw new Error("refused key cannot reach export"); });
  const deps = { ...base, approvalToolHandler, exportSiteBound, checkToolPublishConsent: consent, toolApprovalConfirmation: card,
    resolveOperatorLocale: async () => "en", clock: { nowMs: () => 0 }, idGen: { newId: () => "job-7" }, publishOutputRootDir: "/not-used",
    staticPublishPorts: { ...base.staticPublishPorts, issueCredentialSetup: base.issueCredentialSetup, createNoopTracker: () => ({
      trace: async ({ run }: { run: (span: { setOutcome(): void }) => Promise<unknown> }) => run({ setOutcome() {} }),
    }) },
  } as unknown as StaticPublishToolDeps;
  let emitted!: (value: unknown) => void;
  const finish = new Promise<unknown>(resolve => { emitted = resolve; });
  const options = { emitSurface: async (emission: unknown) => { emitted(emission); } };
  const input = { target: "docs", projectName: "Guide", repo: "guide", credentialId: "selected" };
  const execute = () => executeStaticPublish({ deps, surfaces, credentialSource, historyStore, inputCtx: context(input), optional: options });
  expect(await execute()).toEqual({ published: false, cancelled: false, code: "CONSENT_REVOKED" });
  expect(resolve).not.toHaveBeenCalled();
  expect(publishJobs.latest()).toBeUndefined();

  revoke = false;
  const accepted = await execute();
  expect(accepted).toMatchObject({
    published: false, accepted: true, jobId: "job-7", status: "running",
    progress: { phase: "exporting", deploymentCreated: false, uploadedFiles: 0 },
    message: expect.stringContaining("Do not publish again while it is running"),
  });
  expect(await execute()).toMatchObject({ published: false, cancelled: false, code: "ALREADY_RUNNING", jobId: "job-7" });
  expect(resolve).toHaveBeenCalledExactlyOnceWith({ workspaceId: "site", target: "docs", credentialId: "selected" });
  release({ ok: false, reason: "Selected key was removed after review" });
  await expect(finish).resolves.toEqual({
    channel: "mcp-ui", payload: { resource: { type: "resource", resource: {
      uri: "ui://test.host/deployment-execute-static-publish/job-7", mimeType: "text/html", text: "Publish failed",
    } } },
  });
  expect(publishJobs.get({ scopeId: "site", requestId: "execution-7" })).toMatchObject({
    jobId: "job-7", status: "errored", result: { ok: false, code: "NO_CREDENTIALS_CONFIGURED", message: "Selected key was removed after review" },
  });
  expect(exportSiteBound).not.toHaveBeenCalled();
  expect(grants).toEqual(Array.from({ length: 6 }, () => ({ ...readGrant, permission: "deployments.publish" })));
});

it("authenticated preview gives the plugin the exact saved connection but returns only its inspection", async () => {
  const inspection = { resourceName: "docs guide", targetId: "docs", hostingChanges: [{ kind: "enable-preview" }] };
  const preview = vi.fn<NonNullable<LoadedDeployTarget["module"]["preview"]>>(async () => inspection);
  const target = { ...host, module: { ...host.module, preview } };
  const { deps, grants } = fixture(target);
  const unreachable = () => { throw new Error("unexpected network or timing operation"); };
  const kit = createDeployHostKit({ fetchFn: unreachable, createReachability: unreachable, createSigV4Client: unreachable, now: () => 0, sleep: unreachable });
  const resolve = vi.fn<PublishCredentialSource["resolve"]>(async () => ({
    ok: true, token: "private-fixture-token", region: "west", basis: { id: "selected", revision: 4 }, credentialId: "selected",
  }));
  const isConfigured = vi.fn<PublishCredentialSource["isConfigured"]>(async () => ({ configured: true, basis: { id: "selected", revision: 4 } }));
  const result = await previewStaticPublish({
    deps: { ...deps, hostKit: kit }, credentialSource: { isConfigured, resolve },
    ctx: context({ target: "docs", repo: "guide", projectName: "Guide", credentialId: "selected" }),
  });
  expect(grants).toEqual([readGrant]);
  expect(isConfigured).toHaveBeenCalledExactlyOnceWith({ workspaceId: "site", target: "docs", credentialId: "selected" });
  expect(resolve).toHaveBeenCalledExactlyOnceWith({ workspaceId: "site", target: "docs", credentialId: "selected" });
  expect(preview).toHaveBeenCalledExactlyOnceWith({
    kit, config: { target: "docs", repo: "guide" }, projectName: "Guide", credential: { token: "private-fixture-token", region: "west" },
  });
  expect(result).toEqual({ target: "docs", valid: true, basePath: "/docs/guide", credentialsConfigured: true, providerInspection: inspection });
});
