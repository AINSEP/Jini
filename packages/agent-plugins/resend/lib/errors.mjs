// @ts-check

/** A non-empty string field of a parsed body, else the fallback. @param {unknown} value @param {string} fallback */
function nonEmpty(value, fallback) {
  return typeof value === "string" && value !== "" ? value : fallback;
}

/**
 * Resend's error body is `{statusCode, message, name}`; `name` becomes `errorCode`. A non-JSON body
 * (a proxy error page) still yields a usable result. Never throws.
 * @param {{ status: number, bodyText: string }} required
 * @param {{ fallback?: { errorCode: string, message: string } }} [options]
 * @returns {{ errorCode: string, message: string }}
 */
export function parseErrorBody({ status, bodyText }, options = {}) {
  const fallback = options.fallback ?? { errorCode: `HTTP_${status}`, message: bodyText || `Resend responded with HTTP ${status}` };
  try {
    const parsed = JSON.parse(bodyText);
    return { errorCode: nonEmpty(parsed?.name, fallback.errorCode), message: nonEmpty(parsed?.message, fallback.message) };
  } catch {
    // Non-JSON body: keep the raw text above.
    return fallback;
  }
}

