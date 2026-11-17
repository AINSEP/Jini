/**
 * @file The pure half of the gap ledger check: given the ledger and a way to read a file's lines, name
 * every file that is missing, over its line budget, or lacks its `// GAP: <id>` header.
 */
export interface GapEntry { readonly file: string; readonly gap: string; readonly maxLines: number }
export interface GapProblem { readonly file: string; readonly kind: 'missing' | 'over-budget' | 'no-header'; readonly message: string }

const HEADER_SCAN_LINES = 3;

/** `readLines` returns the file's lines, or `null` when the file does not exist. */
export function findGapProblems(
  { ledger, readLines }: { ledger: readonly GapEntry[]; readLines: (required: { file: string }) => readonly string[] | null },
  _optional: Record<string, never> = {},
): GapProblem[] {
  const problems: GapProblem[] = [];
  for (const { file, gap, maxLines } of ledger) {
    const lines = readLines({ file });
    if (lines === null) {
      problems.push({ file, kind: 'missing', message: `${file}: listed in the gap ledger but the file does not exist` });
      continue;
    }
    if (lines.length > maxLines) {
      problems.push({ file, kind: 'over-budget', message: `${file}: ${lines.length} lines, budget ${maxLines} (gap ${gap}); close the gap or raise the budget on purpose` });
    }
    if (!lines.slice(0, HEADER_SCAN_LINES).some((line) => line.startsWith(`// GAP: ${gap}`))) {
      problems.push({ file, kind: 'no-header', message: `${file}: the first ${HEADER_SCAN_LINES} lines must hold a "// GAP: ${gap}" comment` });
    }
  }
  return problems;
}
