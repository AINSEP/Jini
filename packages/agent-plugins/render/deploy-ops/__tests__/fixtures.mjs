// Simulated from public Render API docs. No recorded responses, live keys or network.
import assert from "node:assert/strict";
export const API = "https://api.render.com/v1";
export const TARGET = "srv-test123";
export const RUN = "dep-test123";
export const AT = "2026-10-24T12:00:00.000Z";
export const SERVICE = { id: TARGET, name: "Tovu", type: "web_service", ownerId: "tea-owner123" };
export function response(json, status = 200, extra = {}) { return { status, json, text: JSON.stringify(json), ...extra }; }
/** Strict ordered fake: every request must match a scripted method, URL and optional body. */
export function context(steps = []) {
  const calls = [];
  async function request(method, url, body) {
    calls.push({ method, url, ...(body === undefined ? {} : { body }) });
    const step = steps[calls.length - 1];
    assert.ok(step, `Unexpected ${method} ${url}`);
    assert.equal(method, step.method ?? "GET");
    assert.equal(url, step.url);
    if (Object.hasOwn(step, "body")) assert.deepEqual(body, step.body);
    if (step.error) throw step.error;
    return step.response ?? response(step.json);
  }
  return { calls, nowIso: () => AT, fail: message => { throw new Error(message); }, get: url => request("GET", url), send: ({ method, url, body }) => request(method, url, body), done: () => assert.equal(calls.length, steps.length) };
}
