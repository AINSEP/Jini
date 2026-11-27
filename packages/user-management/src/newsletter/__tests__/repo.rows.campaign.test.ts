import { describe, expect, it, vi } from "vitest";

import { toCampaignRecord, toCampaignRow } from "../repo.rows.js";
import type { CampaignRecord } from "../types.js";

/**
 * @file Campaign row mapping edges: a revision body that parses but is not an object (null, array,
 * scalar) is reported as unreadable rather than returned, and a record without a creator kind is
 * stored as written by a person.
 */
const row = {
  id: "c1", workspace_id: "w1", status: "draft", subject: "S", preheader: null, from_name: "F",
  from_email: "f@example.test", reply_to: "r@example.test", list_id: "l1", scheduled_at: null, send_started_at: null,
  audience_snapshot_id: null, counters_json: '{"delivered":0}', version: 1, created_by_principal: "p1",
  created_by_kind: "agent", created_at: "t0", updated_at: "t0",
};

describe("toCampaignRecord editorial body", () => {
  it.each(["null", "[1,2]", "7"])("reports a non-object revision %s and omits the body", (state) => {
    const onUnreadableBody = vi.fn();
    const record = toCampaignRecord({ row: { ...row, editorial_state_json: state, editorial_seq: 3 }, onUnreadableBody });
    expect(onUnreadableBody).toHaveBeenCalledWith({ campaignId: "c1", seq: 3 });
    expect("bodyJson" in record).toBe(false);
    expect(record).toMatchObject({ id: "c1", createdByKind: "agent", counters: { delivered: 0 } });
  });

  it("returns the body of an object revision without reporting", () => {
    const onUnreadableBody = vi.fn();
    const record = toCampaignRecord({ row: { ...row, editorial_state_json: '{"bodyJson":{"a":1}}', editorial_seq: 2 }, onUnreadableBody });
    expect(record.bodyJson).toEqual({ a: 1 });
    expect(onUnreadableBody).not.toHaveBeenCalled();
  });
});

describe("toCampaignRow creator kind", () => {
  it("stores an absent creator kind as person and keeps a given one", () => {
    const record = toCampaignRecord({ row, onUnreadableBody: vi.fn() });
    const { createdByKind: _kind, ...withoutKind } = record;
    expect(toCampaignRow(withoutKind as CampaignRecord).created_by_kind).toBe("person");
    expect(toCampaignRow(record)).toEqual(row);
  });
});
