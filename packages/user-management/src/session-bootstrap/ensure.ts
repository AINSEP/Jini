/**
 * Probes before redeeming: redemption creates a fresh long-lived session, so an
 * existing valid session must be reused. Reports whether redemption was attempted;
 * port rejections propagate. At most one probe and one redemption.
 */
export async function ensureSession(
  required: { probe: () => Promise<boolean>; redeem: () => Promise<boolean> },
  _optional: Record<string, never> = {},
): Promise<{ authenticated: boolean; redeemed: boolean }> {
  if (await required.probe()) return { authenticated: true, redeemed: false };
  return { authenticated: await required.redeem(), redeemed: true };
}
