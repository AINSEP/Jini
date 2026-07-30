/**
 * @module local-daemon-request
 *
 * A loopback-only request guard: validates that a request's peer address,
 * `Host` header, and (if present) `Origin` header are all loopback, and sets
 * the CORS headers a same-machine caller needs. Distinct from `./origin.js`'s
 * `guardSameOrigin` (which checks a browser tab's origin against a configured
 * allow-list) — this guard instead restricts an endpoint to same-machine
 * callers only (e.g. a local companion process), regardless of origin
 * allow-list configuration.
 */
import net from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import { sendApiError } from './compat.js';

interface LocalAuthority {
  hostname: string;
  port: string;
}

interface LocalDaemonValidation {
  ok: true;
  origin: string | null;
}

interface LocalDaemonValidationError {
  ok: false;
  message: string;
  details: Record<string, string>;
}

/** Parses a `Host`-header-shaped authority string, rejecting anything with a path/userinfo/query. */
export function normalizeLocalAuthority(value: unknown): LocalAuthority | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || /[\s/@]/.test(trimmed) || trimmed.includes(',')) return null;

  try {
    // The guard above already rejects any `/`, `@`, or whitespace in `trimmed`, and the WHATWG
    // URL parser requires a non-empty host for an `http:` URL — so `parsed.hostname` is always
    // non-empty and `parsed.pathname` is always `/` for every `trimmed` value that reaches this
    // line without throwing. `hostname` below can still end up empty after stripping a trailing
    // dot (e.g. `trimmed === '.'` parses to `parsed.hostname === '.'`), so that check stays.
    const parsed = new URL(`http://${trimmed}`);
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (!hostname) return null;
    return { hostname, port: parsed.port };
  } catch {
    return null;
  }
}

/** True when `hostname` is `localhost`, an IPv6 loopback literal, or a `127.0.0.0/8` IPv4 literal. */
export function isLoopbackHostname(hostname: unknown): boolean {
  const normalized = String(hostname || '')
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (normalized === 'localhost') return true;
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
  if (net.isIP(normalized) === 4) return normalized === '127.0.0.1' || normalized.startsWith('127.');
  return false;
}

/** True when `address` (typically `req.socket.remoteAddress`) is a loopback peer, unwrapping an IPv4-mapped IPv6 prefix first. */
export function isLoopbackPeerAddress(address: unknown): boolean {
  if (typeof address !== 'string') return false;
  const normalized = address.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!normalized) return false;
  if (normalized.startsWith('::ffff:')) return isLoopbackPeerAddress(normalized.slice('::ffff:'.length));
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
  if (net.isIP(normalized) === 4) return normalized === '127.0.0.1' || normalized.startsWith('127.');
  return false;
}

/** Parses an `Origin` header value into its origin string, requiring a bare `scheme://loopback-host[:port]` with no path/query/userinfo. */
export function localOriginFromHeader(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'null' || trimmed.includes(',')) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) return null;
    if (!isLoopbackHostname(parsed.hostname)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Validates that `req` is a loopback request: the TCP peer address, the `Host`
 * header, and (when present) the `Origin` header must all resolve to a
 * loopback host.
 *
 * @param req - The incoming request.
 * @returns `{ ok: true, origin }` on success (`origin` is the validated `Origin` header value, or
 *   `null` when the request carried none); otherwise `{ ok: false, message, details }` naming which
 *   check failed.
 */
export function validateLocalDaemonRequest(req: Request): LocalDaemonValidation | LocalDaemonValidationError {
  if (!isLoopbackPeerAddress(req.socket?.remoteAddress)) {
    return {
      ok: false,
      message: 'request peer must be a loopback address',
      details: { peer: 'remoteAddress' },
    };
  }

  const host = normalizeLocalAuthority(req.get('host'));
  if (!host || !isLoopbackHostname(host.hostname)) {
    return {
      ok: false,
      message: 'request host must be a loopback daemon address',
      details: { header: 'host' },
    };
  }

  const originHeader = req.get('origin');
  if (originHeader !== undefined && !localOriginFromHeader(originHeader)) {
    return {
      ok: false,
      message: 'request origin must be a loopback daemon origin',
      details: { header: 'origin' },
    };
  }

  return { ok: true, origin: localOriginFromHeader(originHeader) };
}

/**
 * Express middleware that rejects any non-loopback request with a 403, and
 * otherwise sets permissive same-machine CORS headers before calling `next()`.
 *
 * @param req - The incoming request.
 * @param res - The response to reject on, or set CORS headers on before continuing.
 * @param next - Called when the request validates as loopback.
 */
export function requireLocalDaemonRequest(req: Request, res: Response, next: NextFunction): void | Response {
  const validation = validateLocalDaemonRequest(req);
  if (!validation.ok) {
    return sendApiError(res, 403, 'FORBIDDEN', validation.message, { details: validation.details });
  }

  res.setHeader('Vary', 'Origin');
  if (validation.origin) {
    res.setHeader('Access-Control-Allow-Origin', validation.origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
  next();
}
