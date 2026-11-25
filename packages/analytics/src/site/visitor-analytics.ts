import type { ConsentAnalyticsProof } from "@jini-ai/core/contracts/site/cookie-consent";
import type { VisitorAnalyticsDeps } from "./contracts.js";

/** Durable, minimal evidence carried beside a committed CMS event; never derived from form fields. */
export interface VisitorAnalyticsProvenance {
  granted: true;
  subjectId: string;
  consentProof?: ConsentAnalyticsProof;
}

/** Resolve the site's existing consent decision and create a request-local anonymous subject.
 * Consent failures suppress analytics and cannot alter the public operation. @complexity O(1). */
export async function visitorAnalyticsProvenance<RequestLike>(
  { deps, request }: { deps: VisitorAnalyticsDeps<RequestLike>; request: RequestLike },
  _optional: Record<string, never> = {},
): Promise<VisitorAnalyticsProvenance | undefined> {
  if (!(deps.visitorTracker ?? deps.tracker) || !deps.idGen) return undefined;
  try {
    const consentProof = await deps.visitorAnalyticsProof?.({ request });
    return consentProof ? { granted: true, subjectId: `visitor:${deps.idGen.newId()}`, consentProof } : undefined;
  } catch { return undefined; }
}

/** Capture a bounded public outcome after consent, with an optional site-scoped authenticated subject.
 * Telemetry failure never changes a committed operation's response. @complexity O(1). */
export async function captureVisitorEvent<RequestLike>(
  required: { deps: VisitorAnalyticsDeps<RequestLike>; request: RequestLike; name: string; properties?: Readonly<Record<string, string | number | boolean>> },
  optional: { subjectId?: string } = {},
): Promise<void> {
  const { deps, request, name, properties } = required;
  const provenance = await visitorAnalyticsProvenance({ deps, request });
  if (!provenance) return;
  try {
    if (provenance.consentProof && !await deps.visitorAnalyticsDeliveryAllowed?.({ proof: provenance.consentProof })) return;
    const tracker = deps.visitorTracker ?? deps.tracker;
    if (!tracker) throw new Error("visitor analytics has no tracker for event capture");
    await tracker.capture({ name, userId: optional.subjectId ?? provenance.subjectId }, properties === undefined ? {} : { properties });
  }
  catch { /* Product analytics cannot turn a committed public operation into a failure. */ }
}
