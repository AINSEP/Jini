/**
 * @file Electron main-process session bootstrap mechanics: the cookie exchange into a partition's
 * jar, the server-asked validity probe, per-key partition naming and exact-URL header arming.
 * Endpoints, cookie and partition names, header names, URL guards and copy are the host's.
 */
export { exchangeSessionJson, exchangeSessionRequest } from './exchange.js';
export { hasSessionCookie, probeSession } from './probe.js';
export { persistentPartitionName } from './partition.js';
export { armExactUrlHeader } from './header-arming.js';
export type {
  CookieJarSession,
  HeaderArmingSession,
  SessionBodyRequest,
  SessionNet,
  SessionOutcome,
  SessionRequest,
  SessionRequestOptions,
  SessionResponse,
} from './types.js';
