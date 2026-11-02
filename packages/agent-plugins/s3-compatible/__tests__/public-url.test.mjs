import assert from "node:assert/strict";
import test from "node:test";

import s3 from "../targets/s3-compatible.mjs";
import { createFakeDeployHostKit } from "./fake-deploy-host-kit.mjs";

// Split out of Tovu's content/agent-plugins/__tests__/hosting-public-urls.test.mjs (2026-11-02), which
// imported five plugins at once; the host kit is now the fake one.

test("S3-compatible resolves the configured public URL without remote effects", async () => {
  const kit = { ...createFakeDeployHostKit(), fetch: async () => assert.fail("resolving S3's configured URL needs no request") };
  const target = s3.create({ credential: { accessKeyId: "key", token: "secret", bucket: "bucket", region: "region", publicUrl: "https://storage.example/site" }, config: {}, kit });
  assert.equal(await target.resolvePublicUrl({ projectName: "zoran" }), "https://storage.example/site");
});
