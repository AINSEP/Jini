/** Round reported USD upward to cents after clearing arithmetic noise at 1e-8 USD precision.
 * Keep the minimum cent for any positive reported charge, even below the noise precision. */
function dollars(usd: number): string {
  const cents = usd > 0 ? Math.max(1, Math.ceil(Math.round(usd * 1e8) / 1e6)) : 0;
  return `$${(cents / 100).toFixed(2)}`;
}

/** Format a known turn charge and its conversation prefix total; round only for display.
 * @example formatUsageCost({ costUsd: 0.445, totalCostUsd: 2.5 }) // '$0.45 (Total: $2.50)' */
export function formatUsageCost({ costUsd, totalCostUsd }: { costUsd: number; totalCostUsd: number }, _optional = {}): string {
  return `${dollars(costUsd)} (Total: ${dollars(totalCostUsd)})`;
}
