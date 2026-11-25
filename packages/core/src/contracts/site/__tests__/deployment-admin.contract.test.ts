import { expect, test } from "vitest";
import type { DeploymentDestination, DeployRunDestination, StaticDeploymentDestination } from "../deployment-admin.js";

test("deployment destinations retain static, deploy and host peer arms", () => {
  const staticDestination = {
    id: "static", kind: "static", lastPublishedAt: "2026-11-25", label: "Static",
    url: "https://static.example", target: "custom", projectName: "site", configFields: {},
  } satisfies StaticDeploymentDestination;
  const deployDestination = {
    id: "deploy", kind: "deploy", status: "confirmed", statusMessage: "Ready",
    target: "custom", label: "Deploy", url: "https://deploy.example", lastPublishedAt: "2026-11-25",
    linkedPeerId: "peer",
  } satisfies DeployRunDestination;
  const peer = { kind: "x" } satisfies DeploymentDestination<{ kind: "x" }>;
  expect([staticDestination.kind, deployDestination.kind, peer.kind]).toEqual(["static", "deploy", "x"]);
  expect(staticDestination).not.toHaveProperty("credentialId");
  expect(deployDestination.linkedPeerId).toBe("peer");
});
