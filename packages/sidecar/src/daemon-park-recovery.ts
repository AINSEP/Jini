/**
 * @file Retry one explicit, pre-dispatch park refusal from a supervised local daemon. The host owns
 * the wire header names, the supervisor's readiness wait and its parking note; this module owns only
 * the replay decision, so a reset or a generic 503 can never be mistaken for a safe replay.
 */

/** The two response headers that identify an explicit park refusal on the host's wire. */
export interface DaemonParkHeaders {
  /** Set to `"1"` on a 503 the daemon returned because it parked before dispatching the request. */
  readonly parked: string;
  /** The parked child's pid (a positive safe integer). */
  readonly pid: string;
}

export interface DaemonParkRecoveryRequired {
  /** Sends the request. Called again for the replay, so it must resolve the current origin anew. */
  readonly send: () => Promise<Response>;
  readonly headers: DaemonParkHeaders;
  /** Waits for the supervisor to bring a replacement daemon up (single-flight on the host side). */
  readonly ensureReady: () => Promise<unknown>;
  /** Tells the supervisor which child parked, before any replay decision. */
  readonly onParked: (required: { pid: number }) => void;
}

export interface DaemonParkRecoveryOptional {
  /** A passive observer records the park but never wakes the daemon or replays. */
  readonly passive?: boolean;
}

/** Retry one explicit, pre-dispatch park refusal. Never retry a reset or infer safety from a
 * generic 503. Both legacy proxy and durable launches use this same wire contract.
 * The send closure resolves the current origin again after the old child exits.
 * @returns The original response for passive observers, otherwise at most one replacement send.
 * @complexity At most two HTTP sends and one bounded, single-flight discovery wait.
 */
export async function fetchWithDaemonParkRecovery(
  required: DaemonParkRecoveryRequired,
  { passive = false }: DaemonParkRecoveryOptional = {},
): Promise<Response> {
  const response = await required.send();
  const pid = parkedDaemonPid({ response, headers: required.headers });
  if (pid === undefined) return response;
  required.onParked({ pid });
  if (passive) return response;
  await response.body?.cancel();
  await required.ensureReady();
  return required.send();
}

/** The parked child's pid from an explicit park refusal; undefined for any other response. */
function parkedDaemonPid(
  { response, headers }: { response: Response; headers: DaemonParkHeaders },
  _optional = {},
): number | undefined {
  if (response.status !== 503 || response.headers.get(headers.parked) !== "1") return undefined;
  const pid = Number(response.headers.get(headers.pid));
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}
