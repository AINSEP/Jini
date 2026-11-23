/**
 * @file Public surface of the `analytics` feature.
 *
 * `panels.tsx` imports from HERE, never from a file inside this folder. That indirection is the
 * point of the feature boundary: everything below can be split, renamed, or grown a `hooks/`
 * directory without the router noticing. Adding a file to this feature is not an API change unless
 * it is exported from this line.
 */
export { Analytics } from "./Analytics.js";
export type { AnalyticsProps } from "./Analytics.js";
