import { describe, it, expect } from "vitest";

import {
  PUBLISH_BACKSTOP_PERMISSION,
  PUBLISH_CONTENT_APPLY_PERMISSION,
  PUBLISH_CONTENT_READ_PERMISSION,
  registerPublishContentPermissionGrants,
  type PublishContentGrantCopy,
} from "../permissions.js";

const copy: PublishContentGrantCopy = {
  backstopDescription: "backstop description",
  backstopReason: "backstop reason",
  readReason: "read reason",
  applyReason: "apply reason",
};

function fixture() {
  const grants: { role: string; permission: string; reason: string }[] = [];
  const catalog: { id: string; owner: string; description: string }[] = [];
  registerPublishContentPermissionGrants({
    registry: { roleGrants: { register: (grant) => void grants.push(grant) } },
    registerPermission: (entry) => void catalog.push(entry),
    copy,
  });
  return { grants, catalog };
}

describe("registerPublishContentPermissionGrants", () => {
  it("names the three permissions with stable ids", () => {
    expect([PUBLISH_CONTENT_READ_PERMISSION, PUBLISH_CONTENT_APPLY_PERMISSION, PUBLISH_BACKSTOP_PERMISSION]).toEqual([
      "publish_content.read", "publish_content.apply", "publish.backstop",
    ]);
  });

  it("registers exactly the backstop catalog entry, with the injected description", () => {
    expect(fixture().catalog).toEqual([{ id: "publish.backstop", owner: "publish-content", description: "backstop description" }]);
  });

  it("grants each permission to the built-in admin role only, carrying the injected reason", () => {
    expect(fixture().grants).toEqual([
      { role: "admin", permission: "publish.backstop", reason: "backstop reason" },
      { role: "admin", permission: "publish_content.read", reason: "read reason" },
      { role: "admin", permission: "publish_content.apply", reason: "apply reason" },
    ]);
  });
});
