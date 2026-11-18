/**
 * @file The one wire detail the daemon's event streams share that core's SSE stream does not
 * default to: these streams have always announced their text encoding, and clients may read it.
 */

/** Response headers for a daemon event stream (`content-type` overrides core's default, which has no charset). */
export const SSE_CHARSET_HEADERS: Readonly<Record<string, string>> = { 'content-type': 'text/event-stream; charset=utf-8' };
