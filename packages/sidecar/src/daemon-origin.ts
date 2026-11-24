import { createServer, type Server } from "node:net";

/**
 * @file Self-contained per-instance agent-daemon origin resolution (2026-08-28 dispatch — daemon
 * startup + port-scoping fix). Two env vars have always won when set — `JINI_AGENT_DAEMON_URL` (a
 * full origin) or `JINI_AGENT_DAEMON_PORT` (a port on `127.0.0.1`) — and still do here, unchanged.
 * What's new: when NEITHER is set, this process allocates its own free OS port instead of falling
 * back to the fixed `4319` every other unconfigured host instance on the same box would also fall
 * back to. That fixed default was a real, observed cross-instance hazard: two unrelated host
 * processes on one machine, neither configuring the env var, converged on the identical daemon
 * port — one silently proxied its assistant traffic at the OTHER instance's daemon, discovered only
 * because their independently-minted auth tokens happened not to match.
 *
 * Two access patterns, matching the two things that need this value:
 * - `ensure()` — async, called exactly once per boot (the host's boot entry points, BEFORE it
 *   builds its app) to perform the actual free-port probe when self-allocation is needed. A no-op
 *   when an explicit env var already makes the origin resolvable synchronously.
 * - `getUrl()`/`getPortForSpawnEnv()` — synchronous, called per-request (the assistant proxy) or
 *   per-spawn (the host's daemon supervisor, building the daemon child's env). Both re-check the
 *   explicit env vars live on every call rather than trusting a value cached before `ensure()` ran,
 *   so a test harness that sets `JINI_AGENT_DAEMON_URL` after this module was first imported still
 *   wins without ever calling `ensure()`.
 *
 * A factory, not bare module state, so a test can hold its own isolated resolver instead of sharing
 * one mutable cache across every test in the process. The host keeps the one production instance.
 */

export interface AgentDaemonOriginResolver {
  /** Idempotent. Resolves the origin — synchronously from an explicit env var when present, else by
   *  probing the OS for a free port — and caches the self-allocated port for `getUrl()`/
   *  `getPortForSpawnEnv()` to read synchronously afterward. A second call returns the
   *  already-settled result without re-probing. */
  ensure(): Promise<void>;
  /** A deferred spawn must not reuse the boot-time released reservation. */
  refresh(): Promise<void>;
  /** The resolved daemon origin. An explicit `JINI_AGENT_DAEMON_URL`/`JINI_AGENT_DAEMON_PORT` is
   *  re-checked live on every call. Falls back to whatever `ensure()` already cached; throws if
   *  self-allocation was needed and `ensure()` has not yet settled — every real boot path calls
   *  `ensure()` before `createApp()` specifically so no request can ever observe that state. */
  getUrl(): string;
  /** The port value to inject into the daemon child's own spawn env, so the spawned process binds
   *  to the SAME port this resolver handed out — `undefined` only when `JINI_AGENT_DAEMON_URL` was
   *  set with no separate port to manage (the child then inherits whatever it inherits unchanged). */
  getPortForSpawnEnv(): string | undefined;
}

/** The environment the resolver reads. The host passes its live `process.env` object, so a value set
 *  after construction (a test harness, a late boot step) is still seen on the next call. */
export type DaemonOriginEnv = Readonly<Record<string, string | undefined>>;

interface ExplicitOrigin {
  url: string;
  port: number | undefined;
}

/** Synchronous: true whenever the origin is fully determined by env vars already set, with no OS
 *  probe required. `JINI_AGENT_DAEMON_URL` wins outright over `JINI_AGENT_DAEMON_PORT`, matching the
 *  existing precedence every call site already assumed.
 *  @complexity O(1). */
function readExplicitOrigin({ env }: { env: DaemonOriginEnv }, _optional = {}): ExplicitOrigin | undefined {
  const explicitUrl = env.JINI_AGENT_DAEMON_URL;
  if (explicitUrl) {
    const url = URL.parse(explicitUrl);
    if (!url || !["http:", "https:"].includes(url.protocol) || [url.username, url.password, url.search, url.hash].some(Boolean)) {
      throw new Error("JINI_AGENT_DAEMON_URL must be an HTTP(S) URL without credentials, query or fragment");
    }
    return { url: explicitUrl, port: undefined };
  }

  const explicitPort = env.JINI_AGENT_DAEMON_PORT;
  if (explicitPort === undefined) return undefined;
  const port = Number(explicitPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("JINI_AGENT_DAEMON_PORT must be an integer from 1 to 65535");
  }
  return { url: `http://127.0.0.1:${port}`, port };
}

/** One real free-port probe: bind to port 0, read back whatever the OS assigned, release it
 *  immediately. Inherently a TOCTOU race against whatever binds next — the same class of race every
 *  "ask the OS for a free port" helper accepts — narrow in practice because the daemon child is
 *  spawned within milliseconds of this resolving, on the same host, with nothing else in this
 *  process's own boot sequence competing for a port.
 *  `createProbe` is the socket-factory port (real `net.createServer` by default) so the two
 *  failure arms — a close error and an address-less listener — are testable without a real OS fault.
 *  @complexity O(1) — one socket bind/close round trip. */
export function allocateFreePort(
  { createProbe = createServer }: { createProbe?: () => Pick<Server, "once" | "listen" | "address" | "close"> } = {},
): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const probe = createProbe();
    probe.once("error", rejectPort);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close((closeError) => {
        if (closeError) {
          rejectPort(closeError);
          return;
        }
        if (address === null || typeof address === "string") {
          rejectPort(new Error("agent daemon port allocation returned no usable address"));
          return;
        }
        resolvePort(address.port);
      });
    });
  });
}

/**
 * Creates one independent resolver instance. Production uses a single host-owned instance;
 * tests construct their own so resolving a port in one test can never leak into another's
 * assertions.
 *
 * @complexity Each method O(1) beyond the one-time `allocateFreePort` probe `ensure()` may perform.
 */
export function createAgentDaemonOriginResolver(
  { env }: { env: DaemonOriginEnv }, { allocatePort = allocateFreePort }: { allocatePort?: typeof allocateFreePort } = {},
): AgentDaemonOriginResolver {
  let selfAllocatedPort: number | undefined;
  let ensured: Promise<void> | undefined;

  async function resolveAndCache(): Promise<void> {
    if (readExplicitOrigin({ env }) !== undefined) return;
    selfAllocatedPort = await allocatePort();
  }

  return {
    async refresh(): Promise<void> {
      await resolveAndCache();
    },
    ensure(): Promise<void> {
      ensured ??= resolveAndCache();
      return ensured;
    },
    getUrl(): string {
      const explicit = readExplicitOrigin({ env });
      if (explicit) return explicit.url;
      if (selfAllocatedPort !== undefined) return `http://127.0.0.1:${selfAllocatedPort}`;
      throw new Error(
        "agent daemon origin requested before ensure() resolved a self-allocated port — call ensure() before createApp()",
      );
    },
    getPortForSpawnEnv(): string | undefined {
      const explicit = readExplicitOrigin({ env });
      if (explicit) return explicit.port === undefined ? undefined : String(explicit.port);
      return selfAllocatedPort === undefined ? undefined : String(selfAllocatedPort);
    },
  };
}
