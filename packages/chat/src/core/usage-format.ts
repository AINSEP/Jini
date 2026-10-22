/** Round reported USD upward to cents after clearing arithmetic noise at 1e-8 USD precision.
 * Keep the minimum cent for any positive reported charge, even below the noise precision. */
function dollars(usd: number): string {
  const cents = usd > 0 ? Math.max(1, Math.ceil(Math.round(usd * 1e8) / 1e6)) : 0;
  return `$${(cents / 100).toFixed(2)}`;
}

/** Format a known turn charge, and its conversation prefix total only when one is passed; round only
 * for display. The total is the chat's running total as of that turn, so an earlier turn's line never
 * changes when later turns run (owner, 2026-10-10: "Done · 16s · $0.39 · total $3.95").
 * @example formatUsageCost({ costUsd: 0.445, totalCostUsd: 2.5 }) // '$0.45 · total $2.50'
 * @example formatUsageCost({ costUsd: 0.445 }) // '$0.45' */
export function formatUsageCost({ costUsd, totalCostUsd }: { costUsd: number; totalCostUsd?: number | undefined }, _optional = {}): string {
  return totalCostUsd === undefined ? dollars(costUsd) : `${dollars(costUsd)} · total ${dollars(totalCostUsd)}`;
}
