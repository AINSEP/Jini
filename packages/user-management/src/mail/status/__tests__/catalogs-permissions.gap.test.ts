import { expect, it } from "vitest";
import { MAIL_CAPTURE_CLEAR_PERMISSION } from "@jini-ai/core/contracts/mail";
import { isKnownPermission, listPermissions } from "../../../core/permissions.js";
import { mailStatusAgentToolCatalog } from "../agent-tools.js";
import { mailDeliveryAgentToolCatalog } from "../delivery-agent-tools.js";
import {
  MAIL_ACTIVITY_READ_PERMISSION,
  MAIL_PERMISSION_IDS,
  MAIL_STATUS_PERMISSION,
  MAIL_SUPPRESSIONS_MANAGE_PERMISSION,
  registerMailPermissionGrants,
} from "../permissions.js";

type CatalogEntry = { name: string; sideEffects: string; authorization: { permission: string }; inputSchema: { additionalProperties: boolean; properties: Record<string, unknown>; required?: readonly string[] } };
const catalogs: readonly CatalogEntry[] = [...mailStatusAgentToolCatalog, ...mailDeliveryAgentToolCatalog];

it("registers the three mail permissions under the mail owner and grants only activity read to the admin role", () => {
  expect(isKnownPermission({ id: MAIL_ACTIVITY_READ_PERMISSION })).toBe(false);
  const grants: { role: string; permission: string; reason: string }[] = [];
  registerMailPermissionGrants({ registry: { roleGrants: { register: grant => { grants.push(grant); } } } });
  const mail = listPermissions({}).filter(descriptor => descriptor.owner === "mail");
  expect(mail).toEqual([
    { id: "mail.activity.read", owner: "mail", description: "See who this site emailed and each send's outcome and provider feedback." },
    { id: "mail.suppressions.manage", owner: "mail", description: "Remove an address from the do-not-send list (owner only; the grant alone is not enough)." },
    { id: "mail.capture.clear", owner: "mail", description: "Delete every captured test email of this site (owner only)." },
  ]);
  expect(grants.map(({ role, permission }) => ({ role, permission }))).toEqual([{ role: "admin", permission: "mail.activity.read" }]);
  expect(grants[0]?.reason).toContain("editor and viewer do not hold it");
});

it("the permission id map names each role's id once", () => {
  expect(MAIL_PERMISSION_IDS).toEqual({ activityRead: "mail.activity.read", status: "admin.forms.manage", suppressionsManage: "mail.suppressions.manage" });
});

it("every mail tool is gated by the status permission, a registered mail permission or the workspace settings write", () => {
  const allowed = new Set([MAIL_STATUS_PERMISSION, MAIL_ACTIVITY_READ_PERMISSION, MAIL_SUPPRESSIONS_MANAGE_PERMISSION, MAIL_CAPTURE_CLEAR_PERMISSION, "settings.workspace.write"]);
  for (const tool of catalogs) expect(allowed.has(tool.authorization.permission), tool.name).toBe(true);
  expect(Object.fromEntries(mailStatusAgentToolCatalog.map(tool => [tool.name, tool.authorization.permission]))).toEqual({
    system_get_mail_status: MAIL_STATUS_PERMISSION, mail_set_provider: "settings.workspace.write", mail_send_test: MAIL_STATUS_PERMISSION,
  });
});

it("owner-only permissions gate only state-changing tools, and every read tool declares no side effects", () => {
  const ownerOnly = new Set([MAIL_SUPPRESSIONS_MANAGE_PERMISSION, MAIL_CAPTURE_CLEAR_PERMISSION, "settings.workspace.write"]);
  for (const tool of catalogs) {
    if (ownerOnly.has(tool.authorization.permission)) expect(tool.sideEffects, tool.name).toBe("mutates-durable-state");
    if (/^(system_)?(mail_)?(get|list)_/.test(tool.name)) expect(tool.sideEffects, tool.name).toBe("none");
  }
  expect(catalogs.filter(tool => tool.sideEffects === "mutates-durable-state").map(tool => tool.name).sort())
    .toEqual(["mail_clear_captured", "mail_remove_suppression", "mail_send_test", "mail_set_provider"]);
});

it("tool names are unique and every input schema is closed with required keys it declares", () => {
  const names = catalogs.map(tool => tool.name);
  expect(new Set(names).size).toBe(names.length);
  for (const tool of catalogs) {
    expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
    for (const key of tool.inputSchema.required ?? []) expect(Object.keys(tool.inputSchema.properties), tool.name).toContain(key);
  }
});
