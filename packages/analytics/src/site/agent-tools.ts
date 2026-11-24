/** Only the recent raw buffer is built; this catalog makes no history or visitor-total claims. */
export const analyticsAgentToolCatalog = [{
  name: "analytics_list_recent_hits",
  description: "Reads the site's raw recent-hit buffer (newest first), not a full analytics history. Use to inspect recent traffic, page views, events, popular paths and referrer hosts. Returns hits with occurredAt, kind, path, referrerHost, deviceClass, browserFamily and eventName only. limit defaults to 100 (1..500); path filters exactly after reading that window. summarize:true adds hits, top 10 byPath/byReferrerHost and byDeviceClass over the returned window only. No visitor counts across days; country and region are not recorded. Cannot answer historical weekly visitor totals or identify who visited. Requires analytics.read.",
  sideEffects: "none" as const,
  authorization: { permission: "analytics.read" },
  inputSchema: { type: "object", additionalProperties: false, properties: {
    limit: { type: "integer", minimum: 1, maximum: 500, clamp: true, default: 100 },
    path: { type: "string", description: "Exact path filter, applied after reading the recent window." },
    summarize: { type: "boolean", default: false },
  } },
}];
