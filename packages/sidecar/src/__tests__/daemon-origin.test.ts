import { createServer } from "node:net";
import { describe, expect, it } from "vitest";

import { allocateFreePort, createAgentDaemonOriginResolver } from "../daemon-origin.js";

/**
 * @file Regression coverage for the daemon startup + port-scoping fix (2026-08-28 dispatch).
 *
 * Two defects, one fix: (1) the host's serve command never started the agent daemon at all, and (2)
 * every boot that left `JINI_AGENT_DAEMON_URL`/`JINI_AGENT_DAEMON_PORT` unset converged on the same
 * fixed port 4319 — a real, observed cross-instance hazard where one host process's assistant proxy
 * silently targeted an unrelated instance's daemon. This file exercises the resolver in isolation
 * (each test builds its own instance via `createAgentDaemonOriginResolver`, so no state leaks
 * between tests); the daemon-spawn wiring and the end-to-end proxy behaviour are host tests.
 *
 * Determinism is not correctness here: the load-bearing assertion is the INVARIANT that the proxy's
 * `getUrl()` and the daemon child's own `getPortForSpawnEnv()` agree on the exact same port — not
 * merely that each produces *some* value.
 */

async function withEnv(overrides: Record<string, string | undefined>, run: () => void | Promise<void>): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) previous[key] = process.env[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** A hand-built probe socket: `listen` invokes its callback at once, `address`/`close` return the
 * scripted outcome. Lets the two failure arms of the real free-port probe run deterministically. */
function fakeProbe({ address, closeError }: { address: unknown; closeError?: Error }) {
  const events: string[] = [];
  const probe = {
    once: (event: string) => { events.push(`once:${event}`); return probe; },
    listen: (port: number, host: string, onListening: () => void) => { events.push(`listen:${port}:${host}`); onListening(); return probe; },
    address: () => address,
    close: (onClosed: (error?: Error) => void) => { events.push("close"); onClosed(closeError); return probe; },
  };
  return { events, createProbe: () => probe as never };
}

const unset = { JINI_AGENT_DAEMON_URL: undefined, JINI_AGENT_DAEMON_PORT: undefined };

describe("createAgentDaemonOriginResolver", () => {
  it("with neither env var set, ensure() self-allocates a port that is NOT the old fixed default 4319", async () => {
    await withEnv(unset, async () => {
      const resolver = createAgentDaemonOriginResolver({ env: process.env });
      await resolver.ensure();

      const port = resolver.getPortForSpawnEnv();
      // expected a self-allocated port, not the URL-only 'no port to manage' shape
      expect(port).not.toBe(undefined);
      // a self-allocated port must never coincide with the old shared fixed default
      expect(port).not.toBe("4319");
    });
  });

  it("the proxy's resolved URL and the daemon child's spawn-env port agree on the SAME self-allocated port", async () => {
    await withEnv(unset, async () => {
      const resolver = createAgentDaemonOriginResolver({ env: process.env });
      await resolver.ensure();

      const port = resolver.getPortForSpawnEnv();
      expect(resolver.getUrl()).toBe(`http://127.0.0.1:${port}`);
    });
  });

  it("getUrl() throws with an actionable message when read before ensure() resolves a self-allocated port", async () => {
    await withEnv(unset, () => {
      const resolver = createAgentDaemonOriginResolver({ env: process.env });

      // must fail fast rather than resolve to an undefined-derived URL
      expect(() => resolver.getUrl()).toThrow(
        new Error("agent daemon origin requested before ensure() resolved a self-allocated port — call ensure() before createApp()"),
      );
    });
  });

  it("an explicit JINI_AGENT_DAEMON_PORT still wins outright — no self-allocation, no probe needed", async () => {
    await withEnv({ JINI_AGENT_DAEMON_URL: undefined, JINI_AGENT_DAEMON_PORT: "6421" }, () => {
      const resolver = createAgentDaemonOriginResolver({ env: process.env });

      // the explicit port must be honored without calling ensure()
      expect(resolver.getUrl()).toBe("http://127.0.0.1:6421");
      expect(resolver.getPortForSpawnEnv()).toBe("6421");
    });
  });

  it("an explicit JINI_AGENT_DAEMON_URL wins outright over JINI_AGENT_DAEMON_PORT, and reports no port to manage", async () => {
    await withEnv({ JINI_AGENT_DAEMON_URL: "http://127.0.0.1:9999/s/site", JINI_AGENT_DAEMON_PORT: "0" }, async () => {
      const resolver = createAgentDaemonOriginResolver({ env: process.env });
      await resolver.ensure();

      // the scoped explicit URL must take precedence over an unusable proxy port
      expect(resolver.getUrl()).toBe("http://127.0.0.1:9999/s/site");
      // a URL-only config has no separate port for this process to inject into the child's env
      expect(resolver.getPortForSpawnEnv()).toBe(undefined);
    });
  });

  it("ensure() rejects unusable explicit daemon URLs without disclosing their values", async () => {
    for (const url of ["invalid-daemon-url", "ftp://127.0.0.1", "http://user:secret@127.0.0.1", "http://127.0.0.1?secret=value", "http://127.0.0.1#secret"]) {
      await withEnv({ JINI_AGENT_DAEMON_URL: url, JINI_AGENT_DAEMON_PORT: "6421" }, async () => {
        const resolver = createAgentDaemonOriginResolver({ env: process.env });
        // an unusable explicit URL must name the setting without echoing its value
        await expect(resolver.ensure()).rejects.toThrow(
          new Error("JINI_AGENT_DAEMON_URL must be an HTTP(S) URL without credentials, query or fragment"),
        );
      });
    }
  });

  it("ensure() rejects blank, zero, fractional and out-of-range proxy ports without disclosing their values", async () => {
    for (const port of ["", "0", "3.14", "-1", "65536"]) {
      await withEnv({ JINI_AGENT_DAEMON_URL: undefined, JINI_AGENT_DAEMON_PORT: port }, async () => {
        const resolver = createAgentDaemonOriginResolver({ env: process.env });
        // an unusable proxy port must name the setting and range without echoing its value
        await expect(resolver.ensure()).rejects.toThrow(new Error("JINI_AGENT_DAEMON_PORT must be an integer from 1 to 65535"));
      });
    }
  });

  it("ensure() is idempotent — a second call does not re-allocate a different port", async () => {
    await withEnv(unset, async () => {
      const resolver = createAgentDaemonOriginResolver({ env: process.env });
      await resolver.ensure();
      const first = resolver.getPortForSpawnEnv();
      await resolver.ensure();
      const second = resolver.getPortForSpawnEnv();

      // re-resolving must not hand out a second, different port mid-boot
      expect(first).toBe(second);
    });
  });

  it("two independent resolvers allocate distinct ports that can actually be bound", async () => {
    await withEnv(unset, async () => {
      const first = createAgentDaemonOriginResolver({ env: process.env });
      const second = createAgentDaemonOriginResolver({ env: process.env });
      const listeners = [createServer(), createServer()];
      const bind = (index: number, port: string | undefined) => new Promise<void>((resolve, reject) => {
        expect(port).toBeTruthy();
        listeners[index]!.once("error", reject);
        listeners[index]!.listen(Number(port), "127.0.0.1", resolve);
      });
      try {
        await first.ensure();
        // Reserve the first port like a running daemon. This also avoids a chance reuse of an
        // OS-selected port between bind-and-release probes, while detecting a constant fallback.
        await bind(0, first.getPortForSpawnEnv());
        await second.ensure();
        expect(first.getPortForSpawnEnv()).not.toBe(second.getPortForSpawnEnv());
        await bind(1, second.getPortForSpawnEnv());
      } finally {
        await Promise.all(listeners.map((listener) => new Promise<void>((resolve) => listener.close(() => resolve()))));
      }
    });
  });

  it("cold spawn refreshes the boot-time allocation; explicit origin precedence is preserved", async () => {
    await withEnv(unset, async () => {
      let allocations = 0;
      const resolver = createAgentDaemonOriginResolver({ env: process.env }, { allocatePort: async () => { allocations += 1; return 45000 + allocations; } });
      await resolver.ensure(); expect(resolver.getPortForSpawnEnv()).toBe("45001");
      await resolver.refresh(); expect(resolver.getPortForSpawnEnv()).toBe("45002");
      expect(resolver.getUrl()).toBe("http://127.0.0.1:45002");
      await withEnv({ JINI_AGENT_DAEMON_URL: "http://127.0.0.1:46000" }, async () => {
        await resolver.refresh(); expect(allocations).toBe(2);
        expect(resolver.getUrl()).toBe("http://127.0.0.1:46000");
      });
    });
  });

  it("before ensure() with nothing configured there is no spawn-env port to hand the daemon child", async () => {
    await withEnv(unset, () => {
      expect(createAgentDaemonOriginResolver({ env: process.env }).getPortForSpawnEnv()).toBe(undefined);
    });
  });
});

describe("createAgentDaemonOriginResolver with an injected environment map", () => {
  it("reads only the environment it was given, live on every call", () => {
    const env: Record<string, string | undefined> = {};
    const resolver = createAgentDaemonOriginResolver({ env });
    expect(resolver.getPortForSpawnEnv()).toBe(undefined);
    env.JINI_AGENT_DAEMON_PORT = "6422";
    expect(resolver.getUrl()).toBe("http://127.0.0.1:6422");
    expect(resolver.getPortForSpawnEnv()).toBe("6422");
  });
});

describe("allocateFreePort", () => {
  it("resolves the port the OS-assigned address reports, after releasing the socket", async () => {
    const { events, createProbe } = fakeProbe({ address: { port: 45123, address: "127.0.0.1", family: "IPv4" } });
    expect(await allocateFreePort({ createProbe })).toBe(45123);
    expect(events).toEqual(["once:error", "listen:0:127.0.0.1", "close"]);
  });

  it("rejects with the close error instead of handing out a port it could not release", async () => {
    const closeError = new Error("close failed");
    const { createProbe } = fakeProbe({ address: { port: 1 }, closeError });
    await expect(allocateFreePort({ createProbe })).rejects.toBe(closeError);
  });

  for (const address of [null, "/tmp/pipe.sock"]) {
    it(`rejects when the listener reports no TCP address (${String(address)})`, async () => {
      const { createProbe } = fakeProbe({ address });
      await expect(allocateFreePort({ createProbe })).rejects.toThrow(/agent daemon port allocation returned no usable address/);
    });
  }

  it("binds a real ephemeral port with its default probe", async () => {
    const port = await allocateFreePort();
    expect(Number.isInteger(port) && port > 0 && port < 65536).toBe(true);
  });
});
