/**
 * @file `node scripts/check-gaps.ts`: reads GAPS.json next to package.json and exits 1 naming every problem.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findGapProblems, type GapEntry } from './gap-problems.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ledger = JSON.parse(readFileSync(join(root, 'GAPS.json'), 'utf8')) as GapEntry[];

const readLines = ({ file }: { file: string }): string[] | null => {
  try {
    const text = readFileSync(join(root, file), 'utf8');
    return (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
};

const problems = findGapProblems({ ledger, readLines });
for (const problem of problems) console.error(problem.message);
console.log(problems.length === 0 ? `gaps ok (${ledger.length} files)` : `${problems.length} gap problem(s)`);
process.exitCode = problems.length === 0 ? 0 : 1;
