import assert from "node:assert/strict";
import test from "node:test";
import actions from "../deploy-ops/github-actions.mjs";

const sha = "a".repeat(40);
test("host-provided workflow reaches the dispatch URL and summary without a vendor default", async () => {
  const sends = [];
  const ctx = { fail: message => { throw new Error(message); }, nowIso: () => "2026-10-22T00:00:00Z", get: async () => ({ json: { sha } }), send: async request => { sends.push(request); return { json: { workflow_run_id: 42 } }; } };
  const result = await actions.deploy(ctx, { target: "example/site", workflowFile: "example-pipeline.yaml", workflowFiles: ["example-pipeline.yaml"] });
  assert.equal(sends[0].url, "https://api.github.com/repos/example/site/actions/workflows/example-pipeline.yaml/dispatches");
  assert.equal(sends[0].body.inputs.expected_sha, sha);
  assert.match(result.summary, /^Dispatched example-pipeline.yaml /);
});
test("missing, ambiguous, disabled and escaping workflow selections dispatch nothing", async () => {
  const ctx = { fail: message => { throw new Error(message); }, get: async () => assert.fail('must not fetch'), send: async () => assert.fail('must not dispatch') };
  for (const input of [
    {}, { workflowFiles: ['one.yml', 'two.yml'] },
    { workflowFile: 'disabled.yml', workflowFiles: ['active.yml'] },
    ...['', '../escape.yml', 'a/b.yml', 'file.yml?x', 7].map(workflowFile => ({ workflowFile, workflowFiles: ['active.yml'] })),
  ]) {
    const result = await actions.deploy(ctx, { target: 'example/site', ...input });
    assert.equal(result.started, false);
    assert.match(result.summary, /^Nothing dispatched:/);
  }
});

test("an explicit declared choice disambiguates several workflows", async () => {
  const sends = [];
  const ctx = { fail: message => { throw new Error(message); }, nowIso: () => '2026-10-22T00:00:00Z', get: async () => ({ json: { sha } }), send: async request => { sends.push(request); return { json: { workflow_run_id: 42 } }; } };
  const result = await actions.deploy(ctx, { target: 'example/site', workflowFile: 'two.yml', workflowFiles: ['one.yml', 'two.yml'] });
  assert.equal(result.started, true);
  assert.match(sends[0].url, /two.yml/);
});
