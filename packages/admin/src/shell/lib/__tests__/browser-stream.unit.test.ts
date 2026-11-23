// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserStreamPorts, startBrowserStream, type BrowserStreamPorts } from "../browser-stream.js";
import { createStreamActivity } from "../stream-activity.js";
import { fakeBrowserOrigin, settleLocks } from "./browser-stream.fakes.js";

describe("browser stream ownership", () => {
  it("two tabs use one connection, both receive exact frames, and closing the leader transfers ownership", async () => {
    const origin = fakeBrowserOrigin();
    const a = origin.tab();
    const b = origin.tab();
    const connections: { closed: boolean; emit: (required: { frame: { data: string; id: string } }) => void }[] = [];
    const received: { data: string; id: string }[][] = [[], []];
    const connect = ({ emit }: { emit: (required: { frame: { data: string; id: string } }) => void }) => {
      const connection = { closed: false, emit };
      connections.push(connection);
      return () => { connection.closed = true; };
    };
    const stopA = startBrowserStream({ key: "settings/ws/user", connect, receive: ({ frame }) => { received[0]!.push(frame); } }, { ports: a.ports });
    const stopB = startBrowserStream({ key: "settings/ws/user", connect, receive: ({ frame }) => { received[1]!.push(frame); } }, { ports: b.ports });
    await settleLocks();
    expect(connections).toHaveLength(1);
    connections[0]!.emit({ frame: { data: "verbatim", id: "42" } });
    await settleLocks();
    expect(received).toEqual([[{ data: "verbatim", id: "42" }], [{ data: "verbatim", id: "42" }]]);
    stopA();
    await settleLocks();
    expect(connections[0]!.closed).toBe(true);
    expect(connections).toHaveLength(2);
    expect(connections.filter((connection) => !connection.closed)).toHaveLength(1);
    stopB();
    expect(b.listenerCount()).toBe(0);
  });

  it("a hidden leader immediately yields to a visible follower; hidden tabs still receive frames", async () => {
    const origin = fakeBrowserOrigin();
    const a = origin.tab();
    const b = origin.tab();
    const opened: string[] = [];
    const closed: string[] = [];
    let emit: (required: { frame: string }) => void = () => {};
    const received: string[] = [];
    const stopA = startBrowserStream({ key: "feed", connect: () => { opened.push("a"); return () => { closed.push("a"); }; }, receive: ({ frame }: { frame: string }) => { received.push(frame); } }, { ports: a.ports });
    const stopB = startBrowserStream({ key: "feed", connect: (args) => { emit = args.emit; opened.push("b"); return () => { closed.push("b"); }; } }, { ports: b.ports });
    await settleLocks();
    a.hide();
    await settleLocks();
    expect(opened).toEqual(["a", "b"]);
    expect(closed).toEqual(["a"]);
    emit({ frame: "hidden follower refresh" });
    await settleLocks();
    expect(received).toEqual(["hidden follower refresh"]);
    a.show();
    await settleLocks();
    expect(opened).toEqual(["a", "b"]);
    stopA(); stopB();
  });

  it.each(["tab", "fallback"] as const)("%s stream closes after 30s hidden and reopens on visible", (mode) => {
    const tab = fakeBrowserOrigin().tab();
    const ports = { ...tab.ports, requestLock: undefined };
    let opens = 0;
    let closes = 0;
    const stop = startBrowserStream({ key: "page", connect: () => { opens++; return () => { closes++; }; } }, { ports, scope: mode === "tab" ? "tab" : "origin" });
    tab.hide(); tab.advance(29_999);
    expect(closes).toBe(0);
    tab.advance(1);
    expect(closes).toBe(1);
    tab.show();
    expect(opens).toBe(2);
    stop();
    expect(closes).toBe(2);
    expect(tab.timerCount()).toBe(0);
  });

  it("an active chat keeps the page stream, and ending the last run releases it if already idle", () => {
    const tab = fakeBrowserOrigin().tab();
    const activity = createStreamActivity({});
    let opens = 0;
    let closes = 0;
    const stop = startBrowserStream({ key: "page", connect: () => { opens++; return () => { closes++; }; } }, { ports: tab.ports, scope: "tab", activity });
    const releaseA = activity.retain({});
    const releaseB = activity.retain({});
    tab.hide(); tab.advance(31_000);
    expect(closes).toBe(0);
    releaseA(); releaseA();
    expect(closes).toBe(0);
    releaseB();
    expect(closes).toBe(1);
    const releaseC = activity.retain({});
    expect(opens).toBe(2);
    releaseC();
    expect(closes).toBe(2);
    stop();
  });

  it("pagehide releases an acquired or queued lock and pageshow can rejoin", async () => {
    const origin = fakeBrowserOrigin();
    const a = origin.tab(); const b = origin.tab();
    let live = 0;
    const connect = () => { live++; return () => { live--; }; };
    const stopA = startBrowserStream({ key: "feed", connect }, { ports: a.ports });
    const stopB = startBrowserStream({ key: "feed", connect }, { ports: b.ports });
    await settleLocks();
    b.page("pagehide"); a.page("pagehide");
    await settleLocks();
    expect(live).toBe(0);
    b.page("pageshow");
    await settleLocks();
    expect(live).toBe(1);
    stopA(); stopB();
  });

  it("isolates different workspace/principal keys", async () => {
    const origin = fakeBrowserOrigin();
    let opens = 0;
    const connect = () => { opens++; return () => {}; };
    const a = startBrowserStream({ key: "ws/user-a", connect }, { ports: origin.tab().ports });
    const b = startBrowserStream({ key: "ws/user-b", connect }, { ports: origin.tab().ports });
    await settleLocks();
    expect(opens).toBe(2);
    a(); b();
  });

  it("lock refusal falls back to a visibility-managed per-tab stream", async () => {
    const tab = fakeBrowserOrigin().tab();
    let closes = 0;
    const stop = startBrowserStream({ key: "feed", connect: () => () => { closes++; } }, {
      ports: { ...tab.ports, requestLock: async () => { throw new DOMException("unavailable", "SecurityError"); } },
    });
    await settleLocks();
    tab.hide(); tab.advance(30_000);
    expect(closes).toBe(1);
    stop();
  });

  it("ignores frames from a former leader after handoff and never resurrects a disposed follower", async () => {
    const origin = fakeBrowserOrigin();
    const a = origin.tab(); const b = origin.tab(); const c = origin.tab();
    const emitters: ((required: { frame: string }) => void)[] = [];
    const received: string[] = [];
    const connect = ({ emit }: { emit: (required: { frame: string }) => void }) => { emitters.push(emit); return () => {}; };
    const stopA = startBrowserStream({ key: "feed", connect }, { ports: a.ports });
    const stopB = startBrowserStream({ key: "feed", connect, receive: ({ frame }) => { received.push(frame); } }, { ports: b.ports });
    const stopC = startBrowserStream({ key: "feed", connect }, { ports: c.ports });
    await settleLocks();
    stopC(); stopC(); stopA();
    await settleLocks();
    expect(emitters).toHaveLength(2);
    emitters[0]!({ frame: "stale" }); emitters[1]!({ frame: "current" });
    await settleLocks();
    expect(received).toEqual(["current"]);
    stopB(); await settleLocks();
    expect(emitters).toHaveLength(2);
    expect(c.listenerCount()).toBe(0);
  });

  it("all hidden shared tabs release the origin connection until one becomes visible", async () => {
    const origin = fakeBrowserOrigin();
    const a = origin.tab(); const b = origin.tab();
    let live = 0;
    const connect = () => { live++; return () => { live--; }; };
    const stopA = startBrowserStream({ key: "feed", connect }, { ports: a.ports });
    const stopB = startBrowserStream({ key: "feed", connect }, { ports: b.ports });
    await settleLocks();
    b.hide(); a.hide(); await settleLocks();
    expect(live).toBe(0);
    b.show(); await settleLocks();
    expect(live).toBe(1);
    stopA(); stopB();
  });

  it("channel construction refusal falls back and cleans up visibility listeners", () => {
    const tab = fakeBrowserOrigin().tab();
    let live = 0;
    const stop = startBrowserStream({ key: "feed", connect: () => { live++; return () => { live--; }; } }, {
      ports: { ...tab.ports, openChannel: () => { throw new DOMException("denied", "SecurityError"); } },
    });
    expect(live).toBe(1);
    tab.hide(); tab.advance(30_000);
    expect(live).toBe(0);
    stop();
    expect(tab.listenerCount()).toBe(0);
  });
});

type LockRequest = NonNullable<BrowserStreamPorts["requestLock"]>;

/** A `requestLock` port that never grants on its own and rejects on abort, as Web Locks does. */
function queuedLock(holds: Parameters<LockRequest>[0]["hold"][]): LockRequest {
  return ({ signal, hold }) => new Promise((_resolve, reject) => {
    holds.push(hold);
    signal.addEventListener("abort", () => { reject(new DOMException("aborted", "AbortError")); });
  });
}

/** Records the promise `startBrowserStream` derives with `.catch`, so a test can await its outcome. */
class CatchRecordingPromise<T> extends Promise<T> {
  static readonly derived: Promise<unknown>[] = [];
  override catch<R = never>(onRejected?: ((reason: unknown) => R | PromiseLike<R>) | null): Promise<T | R> {
    const derived = super.catch(onRejected);
    CatchRecordingPromise.derived.push(derived);
    return derived;
  }
}

describe("browser stream lifecycle edges", () => {
  it("a tab that starts hidden closes its per-tab stream after the 30s grace period", () => {
    const tab = fakeBrowserOrigin().tab();
    tab.hide();
    let closes = 0;
    const stop = startBrowserStream({ key: "page", connect: () => () => { closes++; } }, { ports: tab.ports, scope: "tab" });
    tab.advance(29_999);
    expect(closes).toBe(0);
    tab.advance(1);
    expect(closes).toBe(1);
    stop();
  });

  it("a repeated hidden signal keeps the grace period measured from the first hide", () => {
    const tab = fakeBrowserOrigin().tab();
    let closes = 0;
    const stop = startBrowserStream({ key: "page", connect: () => () => { closes++; } }, { ports: tab.ports, scope: "tab" });
    tab.hide(); tab.advance(20_000);
    tab.hide(); tab.advance(10_000);
    expect(closes).toBe(1);
    stop();
  });

  it.each([
    ["disposal", (tab: ReturnType<ReturnType<typeof fakeBrowserOrigin>["tab"]>) => tab.ports.requestLock],
    ["lock refusal", () => async () => { throw new DOMException("unavailable", "SecurityError"); }],
  ] as const)("%s closes the shared channel", async (_case, lockFor) => {
    const tab = fakeBrowserOrigin().tab();
    const closed: string[] = [];
    const openChannel: BrowserStreamPorts["openChannel"] = ({ name }) => {
      const channel = tab.ports.openChannel!({ name });
      return { ...channel, close: () => { closed.push(name); channel.close(); } };
    };
    const stop = startBrowserStream({ key: "feed", connect: () => () => {} }, { ports: { ...tab.ports, openChannel, requestLock: lockFor(tab) } });
    await settleLocks();
    stop();
    expect(closed).toEqual(["browser-stream:feed"]);
  });

  it("a shared tab that starts hidden waits for visibility before taking the lock", async () => {
    const tab = fakeBrowserOrigin().tab();
    tab.hide();
    let opens = 0;
    const stop = startBrowserStream({ key: "feed", connect: () => { opens++; return () => {}; } }, { ports: tab.ports });
    await settleLocks();
    expect(opens).toBe(0);
    tab.show();
    await settleLocks();
    expect(opens).toBe(1);
    stop();
  });

  it("a follower that left the page ignores frames broadcast by the leader", async () => {
    const origin = fakeBrowserOrigin();
    const a = origin.tab(); const b = origin.tab();
    let emit: (required: { frame: string }) => void = () => {};
    const received: string[] = [];
    const stopA = startBrowserStream({ key: "feed", connect: (args: { emit: (required: { frame: string }) => void }) => { emit = args.emit; return () => {}; } }, { ports: a.ports });
    const stopB = startBrowserStream({ key: "feed", connect: () => () => {}, receive: ({ frame }: { frame: string }) => { received.push(frame); } }, { ports: b.ports });
    await settleLocks();
    b.page("pagehide");
    emit({ frame: "while away" });
    await settleLocks();
    expect(received).toEqual([]);
    stopA(); stopB();
  });

  it("a repeated visible signal keeps the one pending lock request", async () => {
    const tab = fakeBrowserOrigin().tab();
    const holds: Parameters<LockRequest>[0]["hold"][] = [];
    const stop = startBrowserStream({ key: "feed", connect: () => () => {} }, { ports: { ...tab.ports, requestLock: queuedLock(holds) } });
    tab.show();
    await settleLocks();
    expect(holds).toHaveLength(1);
    stop();
  });

  it("a lock granted after disposal never connects", async () => {
    const tab = fakeBrowserOrigin().tab();
    const holds: Parameters<LockRequest>[0]["hold"][] = [];
    let opens = 0;
    const stop = startBrowserStream({ key: "feed", connect: () => { opens++; return () => {}; } }, { ports: { ...tab.ports, requestLock: queuedLock(holds) } });
    stop();
    await holds[0]!();
    expect(opens).toBe(0);
  });

  it("an aborted lock request does not fall back to a per-tab connection", async () => {
    const tab = fakeBrowserOrigin().tab();
    let opens = 0;
    const stop = startBrowserStream({ key: "feed", connect: () => { opens++; return () => {}; } }, { ports: { ...tab.ports, requestLock: queuedLock([]) } });
    tab.page("pagehide");
    await settleLocks();
    expect(opens).toBe(0);
    stop();
  });

  it("a connect failure inside the lock falls back to a per-tab connection", async () => {
    const tab = fakeBrowserOrigin().tab();
    let attempts = 0;
    let live = 0;
    const connect = () => {
      attempts++;
      if (attempts === 1) throw new Error("feed refused");
      live++;
      return () => { live--; };
    };
    const stop = startBrowserStream({ key: "feed", connect }, { ports: { ...tab.ports, requestLock: ({ hold }) => hold() } });
    await settleLocks();
    expect({ attempts, live }).toEqual({ attempts: 2, live: 1 });
    stop();
    expect(live).toBe(0);
  });

  it("a connect failure in the per-tab fallback rejects an unobserved promise (reported, not fixed)", async () => {
    const tab = fakeBrowserOrigin().tab();
    CatchRecordingPromise.derived.length = 0;
    const requestLock: LockRequest = ({ hold }) => CatchRecordingPromise.resolve().then(hold);
    const stop = startBrowserStream({ key: "feed", connect: () => { throw new Error("feed refused"); } }, { ports: { ...tab.ports, requestLock } });
    await expect(CatchRecordingPromise.derived[0]).rejects.toThrow("feed refused");
    stop();
  });

  it("a per-tab connect failure at start propagates and releases every listener", () => {
    const tab = fakeBrowserOrigin().tab();
    const activity = createStreamActivity({});
    expect(() => startBrowserStream({ key: "page", connect: () => { throw new Error("feed refused"); } }, { ports: tab.ports, scope: "tab", activity }))
      .toThrow("feed refused");
    expect(tab.listenerCount()).toBe(0);
  });
});

describe("browserStreamPorts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("binds the document, window and wall clock", () => {
    vi.useFakeTimers({ now: 1_234 });
    const ports = browserStreamPorts();
    expect({ visibility: ports.visibility, page: ports.page, now: ports.now() }).toEqual({ visibility: document, page: window, now: 1_234 });
  });

  it("schedules work on a cancellable timer", () => {
    vi.useFakeTimers();
    const ran: string[] = [];
    const ports = browserStreamPorts();
    ports.schedule({ work: () => { ran.push("kept"); }, delayMs: 10 });
    const cancel = ports.schedule({ work: () => { ran.push("cancelled"); }, delayMs: 10 });
    cancel();
    vi.advanceTimersByTime(10);
    expect(ran).toEqual(["kept"]);
  });

  it("requests Web Locks with the key, abort signal and holder", async () => {
    const request = vi.fn(async (_key: string, _options: { signal: AbortSignal }, hold: () => Promise<void>) => hold());
    vi.stubGlobal("navigator", { locks: { request } });
    const signal = new AbortController().signal;
    const hold = vi.fn(async () => {});
    await browserStreamPorts().requestLock!({ key: "browser-stream:feed", signal, hold });
    expect(request).toHaveBeenCalledWith("browser-stream:feed", { signal }, hold);
  });

  it("opens a named BroadcastChannel", () => {
    const names: string[] = [];
    class FakeBroadcastChannel { constructor(name: string) { names.push(name); } }
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    expect(browserStreamPorts().openChannel!({ name: "browser-stream:feed" })).toBeInstanceOf(FakeBroadcastChannel);
    expect(names).toEqual(["browser-stream:feed"]);
  });

  it("omits locks and channels on hosts without them", () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("BroadcastChannel", undefined);
    const ports = browserStreamPorts();
    expect({ requestLock: ports.requestLock, openChannel: ports.openChannel }).toEqual({ requestLock: undefined, openChannel: undefined });
  });
});

// L13 Stryker: dispose idempotence and the grace timer's bookkeeping survived.
describe("browser stream — L13 disposal and grace bookkeeping", () => {
  it("disposing twice closes the connection once and leaves no listener or timer behind", () => {
    const tab = fakeBrowserOrigin().tab();
    let closes = 0;
    const stop = startBrowserStream({ key: "page", connect: () => () => { closes++; } }, { ports: tab.ports, scope: "tab" });
    tab.hide();
    expect(tab.timerCount()).toBe(1);
    stop();
    stop();
    expect(closes).toBe(1);
    expect(tab.timerCount()).toBe(0);
    expect(tab.listenerCount()).toBe(0);
    tab.show();
    expect(closes).toBe(1);
  });

  it("the grace timer fires exactly at 30 s after a mid-life hide and is not re-armed", () => {
    const tab = fakeBrowserOrigin().tab();
    let opens = 0; let closes = 0;
    const stop = startBrowserStream({ key: "page", connect: () => { opens++; return () => { closes++; }; } }, { ports: tab.ports, scope: "tab" });
    tab.advance(5_000);
    tab.hide();
    tab.advance(29_999);
    expect(closes).toBe(0);
    tab.advance(1);
    expect(closes).toBe(1);
    expect(tab.timerCount()).toBe(0);
    tab.show();
    expect(opens).toBe(2);
    stop();
  });
});
