export interface AdminAnalyticsHit {
  occurredAt: string;
  kind: "pageview" | "event";
  path: string;
  referrerHost: string | null;
  deviceClass: "desktop" | "mobile" | "tablet" | "bot" | "unknown";
  browserFamily: string | null;
  eventName: string | null;
}
