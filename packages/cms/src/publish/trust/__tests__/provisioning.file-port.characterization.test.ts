import assert from "node:assert/strict";
import { test } from "vitest";

import { PUBLISH_TRUST_GRANT_VERSION, type PublishTrustGrant } from "../grant.js";
import { createFileProvisioning, type ProvisioningCodec, type ProvisioningFileIo } from "../provisioning.js";

/**
 * @file The file-backed provisioning port against a codec that keeps OTHER content in the file.
 *
 * The committed-JSON codec ignores the file it is encoding into, so no suite could see an edit
 * being decoded from one version of a file and written back into another. This fake codec stores
 * the grant document on one line of a two-line file and preserves the other line, which is what a
 * provider config file does. Written before `createFileProvisioning` is split (publish-engine P0.6).
 */

const GRANT: PublishTrustGrant = {
  version: PUBLISH_TRUST_GRANT_VERSION,
  sourceInstallationId: "source-1",
  publicKeys: [{ publicKeyB64u: "key-1", generation: 1 }],
  workspaceId: "ws-1",
  entityTypes: ["post"],
  capabilities: ["publish_content.read", "publish_content.apply"],
  notAfter: "2099-01-01T00:00:00.000Z",
};

/** A fake codec: line 1 is someone else's setting, line 2 is `grants=<document>`. */
function twoLineCodec(): { codec: ProvisioningCodec; encodedInto: (string | null)[] } {
  const encodedInto: (string | null)[] = [];
  const codec: ProvisioningCodec = {
    kind: "two-line",
    defaultPath: "deploy/two-line.conf",
    pretty: false,
    nextStep: "Deploy.",
    decode: ({ fileContents }) => fileContents?.split("\n")[1]?.replace(/^grants=/, "") ?? null,
    encode: ({ fileContents, document }) => {
      encodedInto.push(fileContents);
      return { ok: true, contents: `${fileContents?.split("\n")[0] ?? "other=missing"}\ngrants=${document}` };
    },
  };
  return { codec, encodedInto };
}

/** A fake file whose contents change after every read, as a file edited by someone else would. */
function changingFile(versions: string[]): { io: ProvisioningFileIo; reads: number; written: string[] } {
  const state = { reads: 0, written: [] as string[] };
  const io: ProvisioningFileIo = {
    read: async () => versions[Math.min(state.reads++, versions.length - 1)] ?? null,
    write: async ({ contents }) => { state.written.push(contents); },
  };
  return { io, get reads() { return state.reads; }, written: state.written };
}

test("an edit is encoded back into the same file contents it was decoded from, read exactly once", async () => {
  const { codec, encodedInto } = twoLineCodec();
  const file = changingFile(["other=first\ngrants=[]", "other=second\ngrants=[]"]);
  const port = createFileProvisioning({ io: file.io, codec, path: "/site/deploy/two-line.conf" });

  const result = await port.connect({ grant: GRANT });

  assert.equal(result.ok, true);
  assert.equal(file.reads, 1);
  assert.deepEqual(encodedInto, ["other=first\ngrants=[]"]);
  assert.equal(file.written.length, 1);
  assert.equal(file.written[0]?.split("\n")[0], "other=first");
  assert.deepEqual(JSON.parse(file.written[0]?.split("\n")[1]?.replace(/^grants=/, "") ?? "null"), [GRANT]);
});

test("a codec that cannot encode stops the edit: nothing is written and the reason is reported", async () => {
  const events: unknown[] = [];
  const { codec } = twoLineCodec();
  const refusing: ProvisioningCodec = { ...codec, encode: () => ({ ok: false, reason: "the file has no place for grants" }) };
  const file = changingFile(["other=first\ngrants=[]"]);
  const port = createFileProvisioning({ io: file.io, codec: refusing, path: "/p", onEvent: (event) => events.push(event) });

  const result = await port.connect({ grant: GRANT });

  assert.deepEqual(result, { ok: false, reason: "the file has no place for grants" });
  assert.deepEqual(file.written, []);
  assert.deepEqual(events, [{ kind: "error", target: port.target, reason: "the file has no place for grants" }]);
});

test("the port's target names the codec kind, the path it was given and the codec's next step", () => {
  const { codec } = twoLineCodec();
  const port = createFileProvisioning({ io: changingFile([]).io, codec, path: "/site/deploy/two-line.conf" });

  assert.deepEqual(port.target, { kind: "two-line", path: "/site/deploy/two-line.conf", nextStep: "Deploy." });
});
