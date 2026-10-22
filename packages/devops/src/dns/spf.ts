/**
 * @file SPF merging. A name may carry only ONE `v=spf1` TXT value — a second one makes every SPF
 * check return PermError — so a requirement's mechanisms are merged into the existing record
 * instead of being added beside it.
 */

/** The `all` mechanism with an optional qualifier; it must stay the last term. */
const ALL_TERM = /^[+\-~?]?all$/i;

export function isSpfValue(required: { readonly value: string }, _optional = {}): boolean {
  return /^v=spf1(\s|$)/i.test(required.value.trim());
}

function spfTerms(value: string): string[] {
  return value.trim().split(/\s+/).slice(1);
}

/**
 * Merge `addition`'s mechanisms into `base`, keeping base's order and its `all` qualifier last.
 * When base has no `all`, the addition's (if any) is used. Duplicates compare case-insensitively.
 * @complexity O(n·m) over term counts (both tiny in practice).
 */
export function mergeSpf(required: { readonly base: string; readonly addition: string }, _optional = {}): string {
  const baseTerms = spfTerms(required.base);
  const additionTerms = spfTerms(required.addition);
  const allTerm = baseTerms.find(term => ALL_TERM.test(term)) ?? additionTerms.find(term => ALL_TERM.test(term));
  const body = baseTerms.filter(term => !ALL_TERM.test(term));
  for (const term of additionTerms) {
    if (!ALL_TERM.test(term) && !body.some(existing => existing.toLowerCase() === term.toLowerCase())) body.push(term);
  }
  return ['v=spf1', ...body, ...(allTerm === undefined ? [] : [allTerm])].join(' ');
}

/** True when `actual` already contains every non-`all` mechanism `wanted` asks for. */
export function spfSatisfies(required: { readonly actual: string; readonly wanted: string }, _optional = {}): boolean {
  const have = new Set(spfTerms(required.actual).map(term => term.toLowerCase()));
  return spfTerms(required.wanted).every(term => ALL_TERM.test(term) || have.has(term.toLowerCase()));
}
