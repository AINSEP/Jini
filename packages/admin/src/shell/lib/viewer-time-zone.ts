/** The admin browser is the host boundary for viewer-local display: `@jini-ai/core/text`'s
 *  `formatTimestamp` is pure and takes the viewer's IANA zone explicitly, so it is resolved here,
 *  once per page load, instead of inside core. UTC when the runtime resolves no zone. */
export const VIEWER_TIME_ZONE: string = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
