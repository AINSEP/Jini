import { trimCharsEnd } from '@jini-ai/core/text';

/** Append an API suffix, adding v1 only when the base path has no version. */
export function appendVersionedApiPath({ baseUrl, suffix }: { baseUrl: string; suffix: string }, _optional: Record<string, never> = {}): string {
  const url = new URL(baseUrl);
  const pathname = trimCharsEnd({ text: url.pathname, chars: '/' });
  url.pathname = /\/v\d+(\/|$)/.test(pathname) ? `${pathname}${suffix}` : `${pathname}/v1${suffix}`;
  return url.toString();
}
