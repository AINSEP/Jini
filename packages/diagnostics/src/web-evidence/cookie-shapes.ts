/** One `Set-Cookie` header, with the value removed. */
export interface CookieShape {
  name: string;
  /** `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, ... — verbatim, minus the `name=value` pair. */
  attributes: string[];
}

/**
 * Strips the value from each `Set-Cookie` header, keeping the name and the attribute list.
 *
 * `Headers.getSetCookie()` is used rather than `headers.get("set-cookie")` because the latter joins
 * multiple cookies with `, `, which is ambiguous (an `Expires` attribute legally contains a comma)
 * and would corrupt the split.
 *
 * @param required.headers - The fetch response's headers.
 * @returns One entry per `Set-Cookie` header, in wire order. Empty array when none were sent.
 * @complexity O(C * A) in cookie count and attributes per cookie — both bounded by the response.
 * @example toCookieShapes({ headers: res.headers }); // => [{ name: "sid", attributes: ["Path=/", "HttpOnly"] }]
 */
export function toCookieShapes({ headers }: { headers: Headers }, _optional = {}): CookieShape[] {
  const raw = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  return raw.map((cookie) => {
    const parts = cookie.split(";");
    // `split` always yields at least one element, so the `name=value` pair is always present.
    const pair = parts[0] as string;
    const equals = pair.indexOf("=");
    return {
      name: (equals >= 0 ? pair.slice(0, equals) : pair).trim(),
      attributes: parts.slice(1).map((part) => part.trim()).filter((part) => part.length > 0),
    };
  });
}
