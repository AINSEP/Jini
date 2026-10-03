import { describe, expect, it } from 'vitest';

import { createVerifyLog, enforceVerify, type VerifyRecord, type VerifyScorecard } from '../verify.js';

function extractorFor(scorecard: VerifyScorecard | null): (required: { output: string }) => VerifyScorecard | null {
  return () => scorecard;
}

describe('enforceVerify', () => {
  it('skips with reason verify-disabled when the master switch is off', () => {
    const result = enforceVerify({
      assistantOutput: '',
      activeRules: [{ name: 'r' }],
      hadArtifact: true,
      verifyEnabled: false,
      extractScorecard: extractorFor(null),
    });
    expect(result).toMatchObject({ status: 'skipped', skipReason: 'verify-disabled', rulesActive: 1 });
  });

  it('skips with reason no-rules when there are no active rules', () => {
    const result = enforceVerify({ assistantOutput: '', activeRules: [], hadArtifact: true, verifyEnabled: true, extractScorecard: extractorFor(null) });
    expect(result).toMatchObject({ status: 'skipped', skipReason: 'no-rules' });
  });

  it('skips with reason no-artifact when the turn produced no artifact', () => {
    const result = enforceVerify({
      assistantOutput: '',
      activeRules: [{ name: 'r' }],
      hadArtifact: false,
      verifyEnabled: true,
      extractScorecard: extractorFor(null),
    });
    expect(result).toMatchObject({ status: 'skipped', skipReason: 'no-artifact' });
  });

  it('reports missing (all rules uncovered) when no scorecard is found', () => {
    const result = enforceVerify({
      assistantOutput: 'no scorecard here',
      activeRules: [{ name: 'Rule A' }, { name: 'Rule B' }],
      hadArtifact: true,
      verifyEnabled: true,
      extractScorecard: extractorFor(null),
    });
    expect(result).toMatchObject({ status: 'missing', uncoveredRules: ['Rule A', 'Rule B'] });
  });

  it('passes when every row covers a rule (by name substring) and none fail', () => {
    const result = enforceVerify({
      assistantOutput: 'output',
      activeRules: [{ name: 'Uses brand colors only' }],
      hadArtifact: true,
      verifyEnabled: true,
      extractScorecard: extractorFor({ status: 'ok', rows: [{ rule: 'Uses brand colors only', status: 'pass' }] }),
    });
    expect(result).toMatchObject({ status: 'pass', rulesCovered: 1, uncoveredRules: [], rowsTotal: 1, rowsFailed: 0, scorecardStatus: 'ok' });
  });

  it('matches a row to a rule via its check line when the row does not restate the rule name', () => {
    const result = enforceVerify({
      assistantOutput: 'output',
      activeRules: [{ name: 'r1', check: 'every button uses the brand green color' }],
      hadArtifact: true,
      verifyEnabled: true,
      extractScorecard: extractorFor({ rows: [{ rule: 'every button uses the brand green color', status: 'pass' }] }),
    });
    expect(result.rulesCovered).toBe(1);
  });

  it('matches a row via shared significant words when neither name nor check substring-matches', () => {
    const result = enforceVerify({
      assistantOutput: 'output',
      activeRules: [{ name: 'Density limit', check: 'layout density stays below threshold value' }],
      hadArtifact: true,
      verifyEnabled: true,
      extractScorecard: extractorFor({ rows: [{ rule: 'Checked layout density against threshold', status: 'pass' }] }),
    });
    expect(result.rulesCovered).toBe(1);
  });

  it('fails and lists uncovered rules when a rule has no matching row', () => {
    const result = enforceVerify({
      assistantOutput: 'output',
      activeRules: [{ name: 'Rule A' }, { name: 'Rule B', check: 'totally unrelated distinctive check text' }],
      hadArtifact: true,
      verifyEnabled: true,
      extractScorecard: extractorFor({ rows: [{ rule: 'Rule A', status: 'pass' }] }),
    });
    expect(result).toMatchObject({ status: 'fail', rulesCovered: 1, uncoveredRules: ['Rule B'] });
  });

  it('fails when a covered rule has a failing row', () => {
    const result = enforceVerify({
      assistantOutput: 'output',
      activeRules: [{ name: 'Rule A' }],
      hadArtifact: true,
      verifyEnabled: true,
      extractScorecard: extractorFor({ rows: [{ rule: 'Rule A', status: 'fail' }] }),
    });
    expect(result).toMatchObject({ status: 'fail', rowsFailed: 1, rulesCovered: 1, uncoveredRules: [] });
  });

  it('matches via shared significant words using only the rule name when the rule has no check line', () => {
    const result = enforceVerify({
      assistantOutput: 'output',
      activeRules: [{ name: 'accessible contrast palette guideline' }],
      hadArtifact: true,
      verifyEnabled: true,
      extractScorecard: extractorFor({ rows: [{ rule: 'confirmed accessible contrast palette everywhere', status: 'pass' }] }),
    });
    expect(result.rulesCovered).toBe(1);
  });

  it('does not falsely cover a rule from a short/empty row or an unrelated row', () => {
    const result = enforceVerify({
      assistantOutput: 'output',
      activeRules: [{ name: 'Distinctive rule name', check: 'distinctive checkable rubric phrase' }],
      hadArtifact: true,
      verifyEnabled: true,
      extractScorecard: extractorFor({ rows: [{ rule: '', status: 'pass' }, { rule: 'completely unrelated text', status: 'pass' }] }),
    });
    expect(result.uncoveredRules).toEqual(['Distinctive rule name']);
  });

  it('omits scorecardStatus when the scorecard has no status field', () => {
    const result = enforceVerify({
      assistantOutput: 'output',
      activeRules: [{ name: 'Rule A' }],
      hadArtifact: true,
      verifyEnabled: true,
      extractScorecard: extractorFor({ rows: [{ rule: 'Rule A', status: 'pass' }] }),
    });
    expect('scorecardStatus' in result).toBe(false);
  });

  // CR-011 / SEC-RB-007: an unknown/malformed row status must never count as a pass.
  describe('unknown/malformed row status (fail-closed)', () => {
    it.each(['error', 'unknown', 'FAIL', 'Pass', '', 'skipped', null, undefined, 123])(
      'treats status %j as a failure rather than silently passing',
      (badStatus) => {
        const result = enforceVerify({
          assistantOutput: 'output',
          activeRules: [{ name: 'Rule A' }],
          hadArtifact: true,
          verifyEnabled: true,
          extractScorecard: extractorFor({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            rows: [{ rule: 'Rule A', status: badStatus as any }],
          }),
        });
        expect(result.status).toBe('fail');
        expect(result.rowsFailed).toBe(1);
      },
    );

    it('still passes when every row is exactly "pass" and every rule is covered', () => {
      const result = enforceVerify({
        assistantOutput: 'output',
        activeRules: [{ name: 'Rule A' }],
        hadArtifact: true,
        verifyEnabled: true,
        extractScorecard: extractorFor({ rows: [{ rule: 'Rule A', status: 'pass' }] }),
      });
      expect(result.status).toBe('pass');
      expect(result.rowsFailed).toBe(0);
    });

    it('treats a non-array `rows` field as a missing scorecard instead of throwing', () => {
      const result = enforceVerify({
        assistantOutput: 'output',
        activeRules: [{ name: 'Rule A' }],
        hadArtifact: true,
        verifyEnabled: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        extractScorecard: extractorFor({ rows: 'not-an-array' as any }),
      });
      expect(result.status).toBe('missing');
      expect(result.uncoveredRules).toEqual(['Rule A']);
    });
  });

  // SEC-RB-007: document the current fuzzy-matching heuristic's residual limits.
  describe('rule-to-evidence mapping (SEC-RB-007)', () => {
    it('no longer lets a single vague row satisfy two distinct rules at once (unique row consumption)', () => {
      // Both rules share enough significant words with the SAME single row
      // to independently match it via the fuzzy word-overlap heuristic.
      const result = enforceVerify({
        assistantOutput: 'output',
        activeRules: [
          { name: 'Density limit', check: 'layout density stays below threshold value' },
          { name: 'Contrast rule', check: 'layout density and contrast both meet threshold value' },
        ],
        hadArtifact: true,
        verifyEnabled: true,
        extractScorecard: extractorFor({
          rows: [{ rule: 'Checked layout density against threshold value', status: 'pass' }],
        }),
      });
      // Exactly one of the two rules can claim this row; the other must be
      // reported uncovered rather than both being silently satisfied.
      expect(result.rulesCovered).toBe(1);
      expect(result.uncoveredRules).toHaveLength(1);
      expect(result.status).toBe('fail');
    });

    it('flags residual risk: the per-pair coverage test itself is still a fuzzy substring/word-overlap heuristic, not an explicit rule-ID mapping', () => {
      // A row whose text is generic enough to overlap on significant words
      // with a rule it does not actually address still counts as covering
      // it — unique consumption prevents double-counting across rules, but
      // does not make an individual match "true"/verified. This is a known,
      // reported limitation (SEC-RB-007): a full fix requires stable rule
      // IDs and explicit evidence references rather than prose matching,
      // which is out of scope for this hardening pass.
      const result = enforceVerify({
        assistantOutput: 'output',
        activeRules: [{ name: 'Accessible contrast guideline', check: 'text meets accessible contrast threshold everywhere' }],
        hadArtifact: true,
        verifyEnabled: true,
        extractScorecard: extractorFor({
          rows: [{ rule: 'Confirmed accessible contrast threshold met everywhere in the design', status: 'pass' }],
        }),
      });
      expect(result.status).toBe('pass');
    });
  });
});

describe('createVerifyLog', () => {
  it('does not persist a skipped result', () => {
    const log = createVerifyLog({});
    const rec = log.record({ result: { status: 'skipped', rulesActive: 0, rulesCovered: 0, uncoveredRules: [], rowsTotal: 0, rowsFailed: 0, hadArtifact: false } });
    expect(rec).toBeNull();
    expect(log.list()).toEqual([]);
  });

  it('records a non-skipped result with an id/timestamp and optional runId/contextId', () => {
    const log = createVerifyLog({});
    const rec = log.record({ result: { status: 'pass', rulesActive: 1, rulesCovered: 1, uncoveredRules: [], rowsTotal: 1, rowsFailed: 0, hadArtifact: true } }, { runId: 'run-1', contextId: 'ctx-1' });
    expect(rec).toMatchObject({ status: 'pass', runId: 'run-1', contextId: 'ctx-1' });
    expect(typeof rec?.id).toBe('string');
    expect(log.list()).toHaveLength(1);
  });

  it('omits runId/contextId from the record when not provided', () => {
    const log = createVerifyLog({});
    const rec = log.record({ result: { status: 'fail', rulesActive: 1, rulesCovered: 0, uncoveredRules: ['r'], rowsTotal: 0, rowsFailed: 0, hadArtifact: true } });
    expect(rec).not.toHaveProperty('runId');
    expect(rec).not.toHaveProperty('contextId');
  });

  it('list() returns copies, newest first, evicting past 20 records', () => {
    const log = createVerifyLog({});
    const records: (VerifyRecord | null)[] = [];
    for (let i = 0; i < 25; i++) {
      records.push(log.record({ result: { status: 'pass', rulesActive: 1, rulesCovered: 1, uncoveredRules: [], rowsTotal: 1, rowsFailed: 0, hadArtifact: true } }));
    }
    const list = log.list();
    expect(list).toHaveLength(20);
    expect(list[0]?.id).toBe(records[24]?.id);
    list[0]!.status = 'fail';
    expect(log.list()[0]?.status).toBe('pass');
  });

  it('remove deletes by id and returns 1, or 0 for an unknown id', () => {
    const log = createVerifyLog({});
    const rec = log.record({ result: { status: 'pass', rulesActive: 1, rulesCovered: 1, uncoveredRules: [], rowsTotal: 1, rowsFailed: 0, hadArtifact: true } });
    expect(log.remove({ id: rec!.id })).toBe(1);
    expect(log.list()).toEqual([]);
    expect(log.remove({ id: 'missing' })).toBe(0);
  });

  it('clear empties the log and returns the removed count, 0 when already empty', () => {
    const log = createVerifyLog({});
    log.record({ result: { status: 'pass', rulesActive: 1, rulesCovered: 1, uncoveredRules: [], rowsTotal: 1, rowsFailed: 0, hadArtifact: true } });
    expect(log.clear()).toBe(1);
    expect(log.list()).toEqual([]);
    expect(log.clear()).toBe(0);
  });

  it('emits verify events for record/remove/clear (deferred via setImmediate)', async () => {
    const log = createVerifyLog({});
    const seen: unknown[] = [];
    log.events.on('verify', (e) => seen.push(e));
    const rec = log.record({ result: { status: 'pass', rulesActive: 1, rulesCovered: 1, uncoveredRules: [], rowsTotal: 1, rowsFailed: 0, hadArtifact: true } });
    await new Promise((resolve) => setImmediate(resolve));
    expect(seen).toHaveLength(1);
    log.remove({ id: rec!.id });
    await new Promise((resolve) => setImmediate(resolve));
    expect(seen).toHaveLength(2);
    const log2 = createVerifyLog({});
    const seen2: unknown[] = [];
    log2.events.on('verify', (e) => seen2.push(e));
    log2.record({ result: { status: 'pass', rulesActive: 1, rulesCovered: 1, uncoveredRules: [], rowsTotal: 1, rowsFailed: 0, hadArtifact: true } });
    await new Promise((resolve) => setImmediate(resolve));
    log2.clear();
    await new Promise((resolve) => setImmediate(resolve));
    expect(seen2).toHaveLength(2);
  });

  it('swallows a throwing listener rather than propagating it, on record/remove/clear alike', async () => {
    const log = createVerifyLog({});
    const rec = log.record({ result: { status: 'pass', rulesActive: 1, rulesCovered: 1, uncoveredRules: [], rowsTotal: 1, rowsFailed: 0, hadArtifact: true } });
    log.events.on('verify', () => {
      throw new Error('listener boom');
    });
    log.record({ result: { status: 'pass', rulesActive: 1, rulesCovered: 1, uncoveredRules: [], rowsTotal: 1, rowsFailed: 0, hadArtifact: true } });
    await new Promise((resolve) => setImmediate(resolve));
    expect(() => log.remove({ id: rec!.id })).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    expect(() => log.clear()).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
  });
});
