import assert from "node:assert/strict";
import test from "node:test";

import github from "../targets/github-pages.mjs";
import { createFakeDeployHostKit } from "../../__tests__/fake-deploy-host-kit.mjs";

// Split out of Tovu's content/agent-plugins/__tests__/hosting-public-urls.test.mjs (2026-11-02), which
// imported five plugins at once; the host kit is now the fake one.

test("GitHub Pages uses the remote site's custom URL and the platform default for a new Pages site", async () => {
  for (const [status, body, expected] of [[200, { html_url: "https://custom.example/" }, "https://custom.example/"], [404, {}, "https://owner.github.io/repo"]]) {
    const kit = { ...createFakeDeployHostKit(), fetch: async () => Response.json(body, { status }) };
    const target = github.create({ credential: { token: "synthetic" }, config: { owner: "owner", repo: "repo" }, kit });
    assert.equal(await target.resolvePublicUrl({ projectName: "zoran" }), expected);
  }
});

test('a new owner Pages site uses the hostname root, unlike a project Pages site', async () => {
  const calls = [];
  const kit = { ...createFakeDeployHostKit(), fetch: async (url, init) => {
    calls.push({ url, method: init.method });
    return Response.json({}, { status: 404 });
  } };
  const target = github.create({ credential: { token: 'synthetic' }, config: { owner: 'Owner', repo: 'OWNER.github.io' }, kit });
  assert.equal(await target.resolvePublicUrl({ projectName: 'fixture' }), 'https://owner.github.io');
  assert.deepEqual(calls, [{ url: 'https://api.github.com/repos/Owner/OWNER.github.io/pages', method: undefined }]);
});
