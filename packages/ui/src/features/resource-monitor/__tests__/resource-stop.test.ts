import assert from "node:assert/strict";
import { test } from "vitest";
import { createResourceStop } from "../resource-stop.js";

const sites = [
  { id: "local-running", status: "running" },
  { id: "local-stopped", status: "stopped" },
  { id: "external-running", status: "running", externalUrl: "http://127.0.0.1:4000" },
];

test("stops a locally managed running site through the power owner, once per press", () => {
  const toggled: string[] = [];
  const onStop = createResourceStop({ projects: sites, power: { toggle: (site) => { toggled.push(site.id); } } });
  onStop({ id: "local-running" });
  assert.deepEqual(toggled, ["local-running"]);
});

test("ignores stopped, externally served and unknown sites", () => {
  const toggled: string[] = [];
  const onStop = createResourceStop({ projects: sites, power: { toggle: (site) => { toggled.push(site.id); } } });
  onStop({ id: "local-stopped" });
  onStop({ id: "external-running" });
  onStop({ id: "missing" });
  assert.deepEqual(toggled, []);
});
