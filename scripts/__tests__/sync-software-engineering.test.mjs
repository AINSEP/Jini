import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const sourceSections = {
  'coding-foundations': ['## Core Rules', '## What Stays Out'],
  'implementation-guardrails': ['## Core Rules', '## Before You Write'],
  'architecture-decisions': ['## Default Architecture Heuristic', '## System Drivers', '## Principles That Always Apply'],
  'systematic-debugging': ['### Phase 1: Root Cause Investigation', '4. **Gather Evidence in Multi-Component Systems**', '### Phase 3: Hypothesis and Testing', '### Phase 4: Implementation'],
  'test-design': ['## Writing Good Assertions', '## Mutation-Derived Input Rules'],
  'code-inspection': ['### 1. Spec Alignment', '### 3. Test Quality', '### 6. Non-Functional Characteristics', '### 7. Function Quality Assessment'],
  'security-review': ['### Authentication and Authorization', '### Business Logic Flaws'],
  'secure-input-handling': ['## Rules', '## Sink Patterns'],
  'vibe-coding': ['## Operating Style', '## Available Skills'],
};

test('sync uses pinned Git bytes, repeats deterministically and rejects incomplete or oversized updates without writing', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'engineering-sync-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const upstream = path.join(root, 'upstream');
  mkdirSync(upstream);
  const git = args => execFileSync('git', ['-C', upstream, ...args], { encoding: 'utf8' }).trim();
  git(['init', '--quiet']);
  for (const [skill, headings] of Object.entries(sourceSections)) {
    const directory = path.join(upstream, 'skills', skill);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'SKILL.md'), headings.map(heading => `${heading}\n\nPinned ${skill} guidance.\n`).join('\n'));
  }
  const commit = () => {
    git(['add', 'skills']);
    git(['-c', 'user.name=Sync Test', '-c', 'user.email=sync@example.invalid', 'commit', '--quiet', '-m', 'fixture']);
    return git(['rev-parse', 'HEAD']);
  };
  const revision = commit();
  const script = path.join(root, 'scripts/sync-software-engineering.mjs');
  mkdirSync(path.dirname(script));
  cpSync(path.join(repoRoot, 'scripts/sync-software-engineering.mjs'), script);
  const payload = path.join(root, 'packages/agent-plugins/software-engineering');
  cpSync(path.join(repoRoot, 'packages/agent-plugins/software-engineering'), payload, { recursive: true });
  const run = sha => spawnSync(process.execPath, [script, upstream, sha], { encoding: 'utf8' });
  const snapshot = () => Object.fromEntries(['README.md',
    ...['implementation', 'planning', 'debugging', 'verification', 'security', 'prototyping'].map(name => `skills/software-engineering/references/${name}.md`)]
    .map(file => [file, readFileSync(path.join(payload, file), 'utf8')]));

  assert.equal(run(revision).status, 0);
  const pinned = snapshot();
  assert.match(pinned['skills/software-engineering/references/implementation.md'], /Pinned coding-foundations guidance/);
  assert.match(pinned['README.md'], new RegExp(revision));
  const source = path.join(upstream, 'skills/coding-foundations/SKILL.md');
  writeFileSync(source, 'Uncommitted broken headings');
  assert.equal(run(revision).status, 0, 'dirty upstream working files are ignored');
  assert.deepEqual(snapshot(), pinned);

  const incomplete = run(commit());
  assert.notEqual(incomplete.status, 0);
  assert.match(incomplete.stderr, /expected section/);
  assert.deepEqual(snapshot(), pinned, 'failed extraction leaves every target byte intact');

  writeFileSync(source, `## Core Rules\n${'x'.repeat(6000)}\n## What Stays Out\n`);
  const oversized = run(commit());
  assert.notEqual(oversized.status, 0);
  assert.match(oversized.stderr, /exceeds 5 KiB/);
  assert.deepEqual(snapshot(), pinned, 'budget failure leaves every target byte intact');

  const invalid = run('--help');
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /40-character-sha/);
  assert.deepEqual(snapshot(), pinned);
});
