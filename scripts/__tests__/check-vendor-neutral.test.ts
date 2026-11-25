import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkVendorNeutral, collectVendorHits, countVendorHits } from '../check-vendor-neutral.js';

const dirs: string[] = [];
function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'jini-vendor-neutral-'));
  dirs.push(root);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const roots = ['packages/daemon/src'];
const check = (root: string, debt: Record<string, number>, extra: { allowlist?: string[] } = {}) => {
  const reminders: string[] = [];
  const violations = checkVendorNeutral({ repoRoot: root }, { roots, debt, allowlist: extra.allowlist ?? [], onReminder: m => reminders.push(m) });
  return { violations, reminders };
};

describe('R15 vendor neutrality ratchet', () => {
  it('rejects a retained vendor reference in a file with no recorded debt', () => {
    const root = repo({ 'packages/daemon/src/fresh.ts': "import { x } from './claude/filesystem.js';\n" });
    const { violations } = check(root, {});
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ rule: 'R15-vendor-neutral', file: 'packages/daemon/src/fresh.ts' });
  });

  it('rejects a higher count in a listed file and accepts the recorded one', () => {
    const root = repo({ 'packages/daemon/src/old.ts': "const a = 'codex';\nconst b = 'Gemini';\n" });
    expect(check(root, { 'packages/daemon/src/old.ts': 2 }).violations).toEqual([]);
    expect(check(root, { 'packages/daemon/src/old.ts': 1 }).violations).toHaveLength(1);
  });

  it('reminds to tighten when a count shrank or a listed file went clean, without failing', () => {
    const root = repo({ 'packages/daemon/src/old.ts': "const a = 'xai';\n", 'packages/daemon/src/clean.ts': 'export const ok = 1;\n' });
    const { violations, reminders } = check(root, { 'packages/daemon/src/old.ts': 3, 'packages/daemon/src/clean.ts': 1, 'packages/daemon/src/gone.ts': 2 });
    expect(violations).toEqual([]);
    expect(reminders.join('\n')).toMatch(/old\.ts: 3 -> 1[\s\S]*clean\.ts: 1 -> 0[\s\S]*gone\.ts: 2 -> 0/);
  });

  it('matches every vendor in the list, any case, and counts each occurrence', () => {
    expect(countVendorHits({ text: 'Codex claude OPENCODE gemini Antigravity xAI grok', commentsAllowed: false })).toBe(7);
  });

  it('skips tests, mocks and non-source files', () => {
    const root = repo({
      'packages/daemon/src/__tests__/a.ts': "'claude'", 'packages/daemon/src/a.test.ts': "'claude'", 'packages/daemon/src/__mocks__/m.ts': "'codex'",
      'packages/daemon/src/readme.md': 'claude', 'packages/daemon/src/ok.ts': 'export const ok = 1;',
    });
    expect(collectVendorHits({ repoRoot: root }, { roots, allowlist: [] })).toEqual({});
  });

  it('allowlists comment-only migration history for a named file, never a code hit', () => {
    const file = 'packages/daemon/src/history.ts';
    const root = repo({ [file]: "// Moved from the codex staging in K02.\n/**\n * claude used to live here.\n */\nconst x = 1;\n" });
    expect(check(root, {}, { allowlist: [file] }).violations).toEqual([]);
    expect(check(root, {}).violations).toHaveLength(1);
    const mixed = repo({ [file]: "// codex history\nconst vendor = 'codex';\n" });
    expect(check(mixed, {}, { allowlist: [file] }).violations).toHaveLength(1);
  });
});
