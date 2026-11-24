import { describe, expect, it } from "vitest";

import { mailDomainDepsFrom, type MailHostActivityDeps } from "../domain-deps.js";
import { MAIL_PERMISSION_IDS } from "../permissions.js";

/** @file The host binding of the activity and suppression operations: the permission ids are bound,
 * every collaborator is passed through by identity, and a collaborator the host does not have is
 * left absent (the operations then refuse as "unavailable"), never set to an explicit `undefined`. */

const authorize = (() => true) as unknown as MailHostActivityDeps["authorize"];

describe("mailDomainDepsFrom", () => {
  it("binds the mail permission ids and passes every present collaborator through by identity", () => {
    const deps = {
      workspaceId: "ws", authorize, ownerPrincipalId: Promise.resolve("owner"),
      mailActivity: {} as NonNullable<MailHostActivityDeps["mailActivity"]>,
      mailSuppressionAdmin: {} as NonNullable<MailHostActivityDeps["mailSuppressionAdmin"]>,
    } satisfies MailHostActivityDeps;
    const bound = mailDomainDepsFrom({ deps });
    expect(bound.permissions).toBe(MAIL_PERMISSION_IDS);
    expect(bound.workspaceId).toBe("ws");
    expect(bound.authorize).toBe(authorize);
    expect(bound.ownerPrincipalId).toBe(deps.ownerPrincipalId);
    expect(bound.mailActivity).toBe(deps.mailActivity);
    expect(bound.mailSuppressionAdmin).toBe(deps.mailSuppressionAdmin);
  });

  it("leaves a collaborator the host does not have absent rather than undefined", () => {
    const bound = mailDomainDepsFrom({ deps: { workspaceId: "ws", authorize } });
    expect(Object.keys(bound).sort()).toEqual(["authorize", "permissions", "workspaceId"]);
  });
});
