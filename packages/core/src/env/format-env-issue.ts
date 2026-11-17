/** Plain words for one environment issue: the variable, what was expected, what happens now, the fix.
 * The text is built only from the issue, which never holds a raw secret, so it is safe to print.
 */
import type { EnvIssue, EnvValueEcho } from '../contracts/env.js';

function received({ echo }: { echo: EnvValueEcho }): string {
  if (echo.kind === 'shown') return `is set to "${echo.text}"`;
  return echo.kind === 'hidden' ? `is set (${echo.length} characters, not shown)` : 'is not set';
}

function unknownName({ issue, product }: { issue: EnvIssue; product: string }): string {
  const hint = issue.suggestion === undefined ? '' : ` Did you mean ${issue.suggestion}?`;
  return `${issue.name} is set, but ${product} has no setting with that name.${hint}\nNothing was changed. To fix: ${issue.fix}.`;
}

/** @param required The issue and the host's product name, as its operator knows it.
 * @returns Three lines for a rejected value, two for an unknown name. Pure; O(length of the text).
 * @example formatEnvIssue({ issue, product: 'Host' });
 */
export function formatEnvIssue(required: { readonly issue: EnvIssue; readonly product: string }, _optional: Record<string, never> = {}): string {
  const { issue, product } = required;
  if (issue.problem === 'unknown-name') return unknownName({ issue, product });
  // No default to name: either there is none, or it is a secret's default and may not be shown.
  const now = issue.usedInstead === undefined ? `${product} is not using this value.` : `${product} is using ${issue.usedInstead} instead.`;
  return `${issue.name} ${received({ echo: issue.received })}. ${product} expected ${issue.expected}.\n${now}\nTo fix: ${issue.fix}`;
}
