import { expect, test } from "vitest";
import { sweepExpiredSubmissionIps, SUBMISSION_IP_RETENTION_DAYS, type SubmissionIpRetentionPort } from "../index.js";

/** Owner decision 2026-10-04 / DR-002: metadata expires; the submission survives. */
const NOW = Date.parse("2026-10-04T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

test("89 days and the millisecond before 90 retain IP; exactly 90 and older clear only IP", async () => {
  const rows = [89 * DAY, 90 * DAY - 1, 90 * DAY, 91 * DAY].map((age, i) => ({
    id: `s${i}`, submittedAt: new Date(NOW - age).toISOString(), sourceIp: "203.0.113.1" as string | null,
    data: { message: "keep me" },
  }));
  const before = rows.map(row => ({ ...row, data: { ...row.data } }));
  const repo: SubmissionIpRetentionPort = {
    async clearExpiredIps({ submittedBeforeOrAt }, { limit = 500 } = {}) {
      const due = rows.filter(row => row.sourceIp !== null && row.submittedAt <= submittedBeforeOrAt).slice(0, limit);
      for (const row of due) row.sourceIp = null;
      return due.length;
    },
  };
  expect(SUBMISSION_IP_RETENTION_DAYS).toBe(90);
  expect(await sweepExpiredSubmissionIps({ now: NOW, repo })).toBe(2);
  expect(rows).toEqual(before.map((row, i) => ({ ...row, sourceIp: i < 2 ? row.sourceIp : null })));
  expect(await sweepExpiredSubmissionIps({ now: NOW, repo })).toBe(0);
});

test("a pass drains more than the default batch without changing its cutoff", async () => {
  let remaining = 1001;
  const batches: number[] = [];
  const repo: SubmissionIpRetentionPort = {
    async clearExpiredIps({ submittedBeforeOrAt }, { limit = 500 } = {}) {
      expect(submittedBeforeOrAt).toBe(new Date(NOW - 90 * DAY).toISOString());
      expect(limit).toBe(500);
      const count = Math.min(limit, remaining);
      remaining -= count;
      batches.push(count);
      return count;
    },
  };
  expect(await sweepExpiredSubmissionIps({ now: NOW, repo })).toBe(1001);
  expect(batches).toEqual([500, 500, 1]);
});

test("invalid time and batch bounds reject before persistence", async () => {
  let calls = 0;
  const repo: SubmissionIpRetentionPort = { async clearExpiredIps() { calls++; return 0; } };
  for (const now of [NaN, Infinity, 1e20]) await expect(sweepExpiredSubmissionIps({ now, repo })).rejects.toThrow(RangeError);
  for (const batchSize of [0, -1, 0.5, Infinity]) {
    await expect(sweepExpiredSubmissionIps({ now: NOW, repo }, { batchSize })).rejects.toThrow(RangeError);
  }
  expect(calls).toBe(0);
});

test("repo failures propagate to the host timer", async () => {
  const error = new Error("database unavailable");
  const repo: SubmissionIpRetentionPort = { async clearExpiredIps() { throw error; } };
  await expect(sweepExpiredSubmissionIps({ now: NOW, repo })).rejects.toBe(error);
});
