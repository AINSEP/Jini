/**
 * @file Attach a private header to requests made in ONE session, for an exact list of URLs only.
 * No renderer ever receives the value; other ports and origins cannot receive it through this
 * listener because the match is exact-URL, not prefix or origin. The host validates the value and
 * the origin, and builds the URLs, before arming.
 */
import type { HeaderArmingSession } from './types.js';

/**
 * Register the listener on `required.session`; requests to any other URL pass through unchanged.
 * @complexity O(u) per intercepted request in the number of armed URLs.
 */
export function armExactUrlHeader(required: {
  session: HeaderArmingSession;
  urls: string[];
  header: string;
  value: string;
}, _optional: Record<string, never> = {}): void {
  const { urls, header, value } = required;
  required.session.webRequest.onBeforeSendHeaders({ urls }, (details, callback) => {
    callback({ requestHeaders: urls.includes(details.url)
      ? { ...details.requestHeaders, [header]: value }
      : details.requestHeaders });
  });
}
