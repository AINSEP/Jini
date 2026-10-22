/**
 * @module providers/google
 *
 * URL-building helpers for the Google Generative Language (Gemini) REST
 * API. Product-neutral as found in the origin — zero imports, ported
 * verbatim.
 */

/** Strips any trailing `/v1`/`/v1beta` API-version segment and trailing slashes from a configured base URL. */
export function googleGenerativeLanguageBaseUrl({ baseUrl }: { baseUrl: string }): string {
  const url = new URL(baseUrl);
  url.search = '';
  url.hash = '';
  const pathname = url.pathname
    .replace(/\/+$/, '')
    .replace(/\/v\d+(?:beta)?$/i, '');
  url.pathname = pathname || '/';
  return url.toString().replace(/\/+$/, '');
}

/** Strips the `models/` prefix Google's API sometimes includes in a model id. */
export function normalizeGoogleModelId({ model }: { model: string }): string {
  const trimmed = model.trim();
  return trimmed.startsWith('models/') ? trimmed.slice('models/'.length) : trimmed;
}

/** URL-encodes a normalized model id for use as a path segment. */
export function googleModelPathSegment({ model }: { model: string }): string {
  return encodeURIComponent(normalizeGoogleModelId({ model: model }));
}

/** Builds the non-streaming `generateContent` endpoint URL for a model. */
export function googleGenerateContentUrl({ baseUrl, model }: { baseUrl: string; model: string }): string {
  return `${googleGenerativeLanguageBaseUrl({ baseUrl: baseUrl })}/v1beta/models/${googleModelPathSegment({ model: model })}:generateContent`;
}

/** Builds the SSE-streaming `streamGenerateContent` endpoint URL for a model. */
export function googleStreamGenerateContentUrl({ baseUrl, model }: { baseUrl: string; model: string }): string {
  return `${googleGenerativeLanguageBaseUrl({ baseUrl: baseUrl })}/v1beta/models/${googleModelPathSegment({ model: model })}:streamGenerateContent?alt=sse`;
}

/** Builds the model-catalog listing endpoint URL, with the API key attached as a query param. */
export function googleProviderModelsUrl({ baseUrl, apiKey }: { baseUrl: string; apiKey: string }): string {
  const url = new URL(`${googleGenerativeLanguageBaseUrl({ baseUrl: baseUrl })}/v1beta/models`);
  url.searchParams.set('key', apiKey);
  return url.toString();
}
