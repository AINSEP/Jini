import assert from "node:assert/strict";
import { test } from "vitest";

import type { ImageCodecPort, MediaRecord, MediaRepoPort, TransformParams } from "../contracts/site/cms-media.js";
import type { ToolAttemptAuditSink, ToolAttemptEvent, ToolGapEntry } from "../contracts/site/daemon-tool-audit.js";
import type { ArtifactStorePort, DeployTargetCredential } from "../contracts/site/devops-deploy.js";
import type { UIResource, UIResourceUri } from "../contracts/site/protocol-mcp-ui.js";
import type { SecretsVaultService, VaultPutInput } from "../contracts/site/secrets-credential-sets.js";

/**
 * @file Type fixtures for the media, tool-audit, deploy, mcp-ui and vault-service contracts.
 * `pnpm typecheck` compiles this file, so renaming or retyping a field these object literals spell
 * in a core contract fails here. The runtime asserts only check the fixtures round-trip unchanged.
 */

const uri: UIResourceUri = "ui://fixture/1";
const resource: UIResource = { type: "resource", resource: { uri, mimeType: "text/html;profile=mcp-app", text: "<p>hi</p>" } };

const media: MediaRecord = {
  id: "m1", workspaceId: "w1", title: "Logo", slug: "logo", alt: "", caption: "", credit: "",
  source: { sha256: "abc", provenance: { kind: "upload" } }, status: "active",
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", version: 1,
  width: null, height: null, cssClass: null, htmlAttributes: null,
};
const mediaRepo: MediaRepoPort = {
  findById: async () => media, findBySlug: async () => media, list: async () => [media],
  save: async () => undefined, remove: async () => undefined,
};
const transform: TransformParams = { width: 320, fit: "cover", format: "webp", quality: 80 };
const encoded = { bytes: new Uint8Array([1]), width: 1, height: 1 };
const codec: ImageCodecPort = {
  inspect: async () => ({ width: 1, height: 1, hasAlpha: false, autoOrient: { width: 1, height: 1 } }),
  encode: async () => encoded,
  encodeTiles: async () => [{ ...encoded, top: 0 }],
};

const appended: Parameters<ToolAttemptAuditSink["append"]>[0][] = [];
const sink: ToolAttemptAuditSink = { append: async (required) => { appended.push(required); } };
const attempt: ToolAttemptEvent = {
  attemptId: "a1", executionId: null, workspaceId: "w1", runId: "r1", toolId: "t1", principalId: "p1", phase: "unknown-tool", at: "t",
};
const gap: ToolGapEntry = {
  type: "tool_gap", id: "g1", at: "t", site: "w1", chatId: "c1", runId: "r1", provider: "x", toolUsed: "Bash", summary: "s", gapLine: null,
};

const credential: DeployTargetCredential = { token: "tok", accountId: "acct" };
const store: ArtifactStorePort = {
  upload: async ({ key }) => ({ url: `https://example.test/${key}` }),
  delete: async () => undefined,
  verify: async ({ present }) => present,
};

const putInput: VaultPutInput = {
  workspaceId: "w1", kind: "vendor", ownerKey: "owner", principalId: null, binding: null,
  expectedRevision: null, provider: null, label: "Key", meta: {},
};
const vault: Pick<SecretsVaultService, "list"> = { list: async () => [] };

test("media, codec and transform contracts round-trip through the fixture ports", async () => {
  assert.equal(await mediaRepo.findBySlug({ workspaceId: "w1", slug: "logo" }), media);
  assert.equal((await codec.encode({ source: encoded.bytes, format: "webp" })).width, 1);
  assert.equal(transform.format, "webp");
  assert.equal(resource.resource.uri, uri);
});

test("tool-attempt sink, deploy and vault contracts accept their fixtures", async () => {
  await sink.append(attempt);
  assert.equal(appended[0]?.phase, "unknown-tool");
  assert.equal(gap.gapLine, null);
  assert.equal(credential.token, "tok");
  assert.equal(await store.verify({ key: "k", url: "u", present: true }), true);
  assert.deepEqual(await vault.list({ workspaceId: putInput.workspaceId, kind: putInput.kind, ownerKey: putInput.ownerKey, principalId: null }), []);
});
