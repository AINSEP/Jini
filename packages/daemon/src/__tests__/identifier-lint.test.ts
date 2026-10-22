/**
 * Identifier-neutrality lint (extraction-plan §8 task 5 gate: "identifier
 * lint proves no project/conversation noun"). Runs keyed on a project or
 * conversation id would leak an OD-shaped noun into the kernel
 * (extraction-plan §2.1: "Runs key on an opaque `contextRef`, never
 * `projectId`"). A grep-based check is sufficient per the task brief — no
 * AST tooling required.
 *
 * This file is deliberately excluded from the scan of its own forbidden
 * terms below (it has to reference them as data), matching the standard
 * self-referential-lint pattern (an ESLint rule's own config mentions the
 * rule it configures).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const SELF_FILE = fileURLToPath(import.meta.url);

const FORBIDDEN_PATTERNS: RegExp[] = [/projectId/, /conversationId/, /project_id/, /conversation_id/];

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== '__tests__') files.push(...listSourceFiles(path));
    else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(path);
  }
  return files;
}

// The gate applies to kernel services; session coordination and HTTP adapters have
// their own published conversation/project contracts and do not key kernel runs.
const KERNEL_FILES = ['run-lifecycle.ts', 'event-log.ts', 'tool-executor.ts', 'agent-executor.ts', 'tokens.ts'];

describe('identifier-neutrality lint — daemon kernel services', () => {
  it('contains no projectId/conversationId/project_id/conversation_id noun outside this lint file', () => {
    const files = [
      ...KERNEL_FILES.map((name) => join(SRC_DIR, name)),
      ...listSourceFiles(join(SRC_DIR, 'agent-executor')),
    ].filter((path) => path !== SELF_FILE);
    expect(files.length).toBeGreaterThan(0);

    const violations: { file: string; pattern: string }[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(content)) {
          violations.push({ file, pattern: pattern.source });
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
