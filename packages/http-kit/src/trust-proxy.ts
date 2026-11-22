/**
 * @file The `trust proxy` decision for a server behind a platform edge, without any server framework.
 *
 * Without it, every visitor behind a platform edge shares the edge's IP: per-IP rate limits become
 * one global bucket and stored source IPs are the proxy's. Trusting X-Forwarded-For everywhere would
 * be worse — a direct client could name any IP it likes. So it is trusted for exactly the hops a
 * known platform puts in front of the app, and never when running locally or directly.
 *
 * With a hop count of N, the server takes the Nth address from the RIGHT of X-Forwarded-For — the
 * one the outermost trusted proxy appended — so whatever the client wrote to the left is ignored.
 */

/** `false`, a hop count, or an address/subnet list (e.g. `"loopback, 10.0.0.0/8"`). */
export type TrustProxySetting = false | number | string;

/**
 * Decide `trust proxy`.
 *
 * - `override` wins when non-empty: `false`/`0`/`off`/`no` -> trust none; an integer -> that many
 *   hops; anything else -> an address/subnet list. `true` is refused: it trusts every
 *   X-Forwarded-For entry, so any client could spoof its IP.
 * - Otherwise the platform's declared hop count (`platformHops`, read only in this case).
 * - Otherwise `false`: the socket peer is the client.
 *
 * @param required.override The operator's raw setting (e.g. an env value), or undefined.
 * @param optional.platformHops Lazily reads the matched platform's hop count.
 * @param optional.overrideName Names the setting in the refusal message. @param optional.serverLabel Names the server there.
 * @throws Error when `override` is `true`.
 * @complexity O(1) plus `platformHops`.
 */
export function resolveTrustProxySetting(
  { override }: { override: string | undefined },
  { platformHops, overrideName = 'TRUST_PROXY', serverLabel = 'this server' }: {
    platformHops?: () => number | undefined;
    overrideName?: string;
    serverLabel?: string;
  } = {},
): TrustProxySetting {
  const value = override?.trim() ?? '';
  if (value !== '') return parseOverride({ value }, { overrideName, serverLabel });
  return platformHops?.() ?? false;
}

/** The non-empty operator setting as `false`, a hop count or an address list; refuses `true`. */
function parseOverride(
  { value }: { value: string },
  { overrideName, serverLabel }: { overrideName: string; serverLabel: string },
): TrustProxySetting {
  const lower = value.toLowerCase();
  if (lower === 'true') {
    throw new Error(
      `${overrideName}="true" would trust X-Forwarded-For from any client. Set the number of proxy hops in front of ${serverLabel} (e.g. 1), or a list of proxy addresses/subnets.`
    );
  }
  if (['false', '0', 'off', 'no'].includes(lower)) return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}
