import assert from "node:assert/strict";
import test from "node:test";

import netlify from "../targets/netlify.mjs";
import { createFakeDeployHostKit } from "../../__tests__/fake-deploy-host-kit.mjs";

// Split out of Tovu's content/agent-plugins/__tests__/hosting-public-urls.test.mjs (2026-11-02), which
// imported five plugins at once; the host kit is now the fake one.

test("Netlify resolves its existing site through the same site owner used by publishing", async () => {
  const calls = [];
  const kit = { ...createFakeDeployHostKit(), fetch: async (url, init) => { calls.push({ url, init }); return Response.json([{ id: "n1", name: "jini-zoran", ssl_url: "https://actual.netlify.app" }]); } };
  const target = netlify.create({ credential: { token: "synthetic" }, config: {}, kit });
  assert.equal(await target.resolvePublicUrl({ projectName: "zoran" }), "https://actual.netlify.app");
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).searchParams.get("name"), "jini-zoran");
});

test('a resolved Netlify site without a public URL is not returned as a usable destination', async () => {
  const urls = [];
  const kit = { ...createFakeDeployHostKit(), fetch: async url => {
    urls.push(url);
    return Response.json([{ id: 'n1', name: 'jini-zoran' }]);
  } };
  const target = netlify.create({ credential: { token: 'synthetic' }, config: {}, kit });
  await assert.rejects(target.resolvePublicUrl({ projectName: 'zoran' }), {
    status: 502, message: "Netlify did not report the site's public URL.",
  });
  assert.deepEqual(urls.map(url => [new URL(url).pathname, new URL(url).searchParams.get('name')]), [['/api/v1/sites', 'jini-zoran']]);
});
