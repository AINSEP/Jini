/** Builds a per-source, per-form key; rate-limit windows and quotas belong to the host. */
/** Include the form id so a visitor submitting to two forms from the same IP is never
 * cross-throttled by the other form's submissions. */
export function buildFormsRateLimitKey({ sourceIp, formDefinitionId }: { sourceIp: string; formDefinitionId: string }): string {
  return `${sourceIp}:${formDefinitionId}`;
}
