import { expect, it } from "vitest";
import type { ExternalMcpToolApprovalDto } from "@jini-ai/core/contracts/site/cms-external-mcp";
import { formatGrantedAt, groupAlwaysAllow } from "../always-allow-rules.js";

const approval = (serverId: string, toolName: string, grantedAt: string): ExternalMcpToolApprovalDto =>
  ({ serverId, toolName, grantedAt, grantedByPrincipalId: "approver" });

it("sorts by roster label, groups by server and gives colliding tool slugs distinct handles", () => {
  const groups = groupAlwaysAllow([
    approval("aa", "list", "2026-09-01"),
    approval("gone", "list", "2026-09-02"),
    approval("zz", "get_file", "2026-09-03"),
    approval("zz", "get-file", "2026-09-04"),
    approval("backup", "view", "2026-09-05"),
  ], [{ serverId: "aa", label: "Zulu" }, { serverId: "zz", label: "Alpha" }, { serverId: "backup", label: "" }, { serverId: "unused", label: "Unused" }]);
  expect(groups).toEqual([
    { serverId: "zz", label: "Alpha", handle: "always-allow-server-zz", tools: [
      { toolName: "get_file", grantedAt: "2026-09-03", revokeHandle: "always-allow-server-zz-revoke-get-file" },
      { toolName: "get-file", grantedAt: "2026-09-04", revokeHandle: "always-allow-server-zz-revoke-get-file-2" },
    ] },
    { serverId: "backup", label: "backup", handle: "always-allow-server-backup", tools: [
      { toolName: "view", grantedAt: "2026-09-05", revokeHandle: "always-allow-server-backup-revoke-view" },
    ] },
    { serverId: "gone", label: "gone", handle: "always-allow-server-gone", tools: [
      { toolName: "list", grantedAt: "2026-09-02", revokeHandle: "always-allow-server-gone-revoke-list" },
    ] },
    { serverId: "aa", label: "Zulu", handle: "always-allow-server-aa", tools: [
      { toolName: "list", grantedAt: "2026-09-01", revokeHandle: "always-allow-server-aa-revoke-list" },
    ] },
  ]);
});

it("formats granted dates for the viewer and preserves an unparseable timestamp", () => {
  const grantedAt = "2026-09-28T12:00:00.000Z";
  expect(formatGrantedAt({ grantedAt, locale: "en-US" })).toBe("Sep 28, 2026");
  expect(formatGrantedAt({ grantedAt, locale: "ja-JP" })).toBe("2026年9月28日");
  expect(formatGrantedAt({ grantedAt: "legacy", locale: "en-US" })).toBe("legacy");
});
