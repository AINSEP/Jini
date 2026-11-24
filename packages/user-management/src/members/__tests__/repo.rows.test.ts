import assert from "node:assert/strict";
import { test } from "vitest";

import { toMemberTierRecord, toMemberTierRow, toMemberConsentRevisionRecord } from "../repo.rows.js";

test("zero monthly and yearly prices survive both mappings, independently of portal visibility", () => {
  // F4.3: replacing ??/== null with a truthiness guard would lose these prices.
  const record = { id: "free-tier", workspaceId: "ws-a", name: "Free", slug: "free", type: "free" as const, status: "active" as const, description: "", welcomePagePath: "", visibleInPortal: false, monthlyPriceCents: 0, yearlyPriceCents: 0, currency: "usd", createdAt: "created", updatedAt: "updated", version: 7 };
  const row = { id: "free-tier", workspace_id: "ws-a", name: "Free", slug: "free", type: "free", status: "active", description: "", welcome_page_path: "", visible_in_portal: 0, monthly_price_cents: 0, yearly_price_cents: 0, currency: "usd", created_at: "created", updated_at: "updated", version: 7 };
  assert.deepEqual(toMemberTierRow(record), row);
  assert.deepEqual(toMemberTierRecord(row), record);
  assert.deepEqual(toMemberTierRecord({ ...row, monthly_price_cents: null, yearly_price_cents: null }), { ...record, monthlyPriceCents: undefined, yearlyPriceCents: undefined });
});

test("legacy consent revisions keep null snapshots and normalize absent purpose and origin", () => {
  // F6.2: legacy nullable metadata is not exercised by the repository's new-revision fixtures.
  assert.deepEqual(toMemberConsentRevisionRecord({ seq: 9, workspace_id: "ws-a", member_id: "m-a", entity_kind: "consent", entity_id: "c-a", purpose: null, op: "consent_revoke", before_json: '{"status":"granted","enabled":false}', after_json: null, origin_module: null, created_at: "revoked" }), {
    seq: 9, workspaceId: "ws-a", memberId: "m-a", consentId: "c-a", purpose: "", op: "consent_revoke", beforeJson: { status: "granted", enabled: false }, afterJson: null, originModule: "", createdAt: "revoked",
  });
});
