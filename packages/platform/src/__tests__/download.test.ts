import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MANAGED_DOWNLOAD_ERROR_CODES,
  downloadCopyAndClear,
  inspectManagedDownload,
  managedDownload,
  pruneManagedDownloads,
  removeManagedDownload,
  type ManagedDownloadProgress,
} from "../download.js";

// root (CAP_DAC_OVERRIDE) always bypasses a directory's own permission bits, so `chmodSync(dir,
// 0o000)` cannot actually block root's own read/write/remove access the way these tests rely on —
// a real POSIX invariant, not a flaky assumption (matches the identical, already-established
// precedent in packages/agent-runtime/src/__tests__/launch.test.ts's `isRoot`-guarded codex test).
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

// `node:fs/promises`'s named exports are frozen ESM module-namespace bindings
// `vi.spyOn` cannot redefine, and download.ts calls them as plain destructured
// imports (not `fsp.stat(x)`), so a property-mutation spy on an imported
// namespace object never reaches those call sites either (verified
// empirically — see packages/platform/archived provenance ledger's 2026-07-22 entry).
// `vi.mock` replaces the module for every importer before any of them load,
// so a per-test `.mockImplementationOnce` on the wrapped `vi.fn()` reaches
// the real call site deterministically, without any OS permission
// enforcement — this is how this file's non-chmod fs-error tests below work.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    copyFile: vi.fn(actual.copyFile),
    lstat: vi.fn(actual.lstat),
    mkdir: vi.fn(actual.mkdir),
    readFile: vi.fn(actual.readFile),
    rename: vi.fn(actual.rename),
    rm: vi.fn(actual.rm),
    stat: vi.fn(actual.stat),
    writeFile: vi.fn(actual.writeFile),
  };
});

type FixtureRequest = {
  range?: string;
};

type FixtureServer = {
  close(): Promise<void>;
  requests: FixtureRequest[];
  url: string;
};

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tmpRoot(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `jini-download-${label}-`));
  roots.push(root);
  return root;
}

function sha256(body: Buffer | string): string {
  return createHash("sha256").update(body).digest("hex");
}

function targetKey(bucket: string, fileName: string): string {
  return createHash("sha256").update(`${bucket}\0${fileName}`).digest("hex");
}

function lockPath(basePath: string, bucket: string, fileName: string): string {
  return join(basePath, ".locks", `${targetKey(bucket, fileName)}.lock`);
}

function manifestPathFor(basePath: string, bucket: string, fileName: string): string {
  return join(basePath, ".state", `${targetKey(bucket, fileName)}.json`);
}

function partialPathFor(basePath: string, bucket: string, fileName: string): string {
  return join(basePath, ".partial", `${targetKey(bucket, fileName)}.partial`);
}

function urlDigestFor(url: string): string {
  return createHash("sha256").update(new URL(url).toString()).digest("hex");
}

function identityDigestFor(url: string, algorithm: "sha256" | "sha512", value: string): string {
  return createHash("sha256").update(`${new URL(url).toString()}\0${algorithm}\0${value}`).digest("hex");
}

/** Hand-write a manifest matching the on-disk shape `readManifest`/`isManifest`
 *  expect, for tests that need to seed a specific prior-run state (a stale
 *  partial, a suspicious mismatch, an out-of-band final file) without
 *  actually driving a full download to produce it. */
function writeManifestFile(
  basePath: string,
  bucket: string,
  fileName: string,
  options: {
    checksum: { algorithm: "sha256" | "sha512"; value: string };
    identityDigest?: string;
    state: "complete" | "partial";
    totalBytes?: number;
    url: string;
    validators?: { etag?: string; lastModified?: string };
  },
): void {
  writeFileSync(
    manifestPathFor(basePath, bucket, fileName),
    JSON.stringify({
      bucket,
      checksum: options.checksum,
      createdAt: new Date().toISOString(),
      fileName,
      identityDigest:
        options.identityDigest ?? identityDigestFor(options.url, options.checksum.algorithm, options.checksum.value),
      kind: "jini-managed-download",
      schemaVersion: 1,
      state: options.state,
      targetKey: targetKey(bucket, fileName),
      ...(options.totalBytes == null ? {} : { totalBytes: options.totalBytes }),
      updatedAt: new Date().toISOString(),
      urlDigest: urlDigestFor(options.url),
      ...(options.validators == null ? {} : { validators: options.validators }),
    }),
  );
}

function exitedPid(): number {
  const child = spawnSync(process.execPath, ["-e", ""], { stdio: "ignore" });
  if (child.error != null) throw child.error;
  if (typeof child.pid !== "number") throw new Error("spawnSync did not expose a pid");
  return child.pid;
}

function sendBody(response: ServerResponse, body: Buffer, options: { delayMs?: number | undefined } = {}): void {
  const send = () => {
    response.end(body);
  };
  if (options.delayMs == null) send();
  else setTimeout(send, options.delayMs);
}

async function startFixture(
  body: Buffer | string,
  options: {
    delayMs?: number;
    failFirstBytes?: number;
    range?: boolean;
  } = {},
): Promise<FixtureServer> {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const requests: FixtureRequest[] = [];
  let requestCount = 0;
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    requestCount += 1;
    const range = typeof request.headers.range === "string" ? request.headers.range : undefined;
    requests.push({ ...(range == null ? {} : { range }) });

    if (options.failFirstBytes != null && requestCount === 1) {
      response.writeHead(200, {
        "content-length": payload.byteLength,
        "content-type": "application/octet-stream",
        etag: '"fixture-etag"',
      });
      // Known flaky: destroy() after a fixed delay races against the client
      // actually flushing the received bytes to its partial file before the
      // pipeline sees the RST. See "resumes a partial download..." below,
      // skipped pending a deterministic fetchImpl-based rewrite — tracked in
      // ADS-memory/reports/session-handoff-2026-07-20-coverage-push.md.
      response.write(payload.subarray(0, options.failFirstBytes));
      setTimeout(() => response.destroy(), 5);
      return;
    }

    if (range != null && options.range !== false) {
      const match = /^bytes=(\d+)-$/.exec(range);
      const start = match?.[1] == null ? Number.NaN : Number(match[1]);
      if (Number.isInteger(start) && start >= 0 && start < payload.byteLength) {
        const chunk = payload.subarray(start);
        response.writeHead(206, {
          "content-length": chunk.byteLength,
          "content-range": `bytes ${start}-${payload.byteLength - 1}/${payload.byteLength}`,
          "content-type": "application/octet-stream",
          etag: '"fixture-etag"',
        });
        sendBody(response, chunk, { delayMs: options.delayMs });
        return;
      }
    }

    response.writeHead(200, {
      "content-length": payload.byteLength,
      "content-type": "application/octet-stream",
      etag: '"fixture-etag"',
    });
    sendBody(response, payload, { delayMs: options.delayMs });
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (address == null || typeof address === "string") throw new Error("fixture did not listen on tcp");
  return {
    close: () => new Promise<void>((resolveClose, rejectClose) => server.close((error) => (error == null ? resolveClose() : rejectClose(error)))),
    requests,
    url: `http://127.0.0.1:${address.port}/artifact.bin`,
  };
}

describe("managed download engine", () => {
  it("downloads, copies to caller output, verifies, and clears managed state", async () => {
    const body = "copy and clear payload";
    const fixture = await startFixture(body);
    const root = tmpRoot("copy-clear");
    const outputPath = join(root, "out", "artifact.bin");
    try {
      const result = await downloadCopyAndClear({
        basePath: join(root, "downloads"),
        bucket: "artifacts",
        fileName: "payload.bin",
        outputPath,
        payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: fixture.url },
      });

      expect(result.cleanup).toBe("removed");
      expect(readFileSync(outputPath, "utf8")).toBe(body);
      const inspected = await inspectManagedDownload({ basePath: join(root, "downloads"), bucket: "artifacts", fileName: "payload.bin" });
      expect(inspected.complete).toBe(false);
      expect(inspected.manifest).toBe("missing");
    } finally {
      await fixture.close();
    }
  });

  it("rejects a Windows drive-relative bucket/fileName segment (e.g. \"C:evil\") that could otherwise escape basePath onto another drive", async () => {
    const root = tmpRoot("drive-relative-escape");
    await expect(
      inspectManagedDownload({ basePath: join(root, "downloads"), bucket: "C:evil", fileName: "payload.bin" }),
    ).rejects.toThrow(/safe single path segment/);
    await expect(
      inspectManagedDownload({ basePath: join(root, "downloads"), bucket: "artifacts", fileName: "D:payload.bin" }),
    ).rejects.toThrow(/safe single path segment/);
  });

  it("rejects a bucket segment that merely starts with \"..\" (pathContains' naive string-prefix escape guard)", async () => {
    // "..evil" is a syntactically ordinary filename (not a parent-directory
    // reference — `path.resolve` never walks upward for it), and
    // `normalizeSegment` only rejects a segment that is *exactly* "." or
    // "..", so this passes normalizeSegment cleanly. `targetFromOptions`'s
    // own `pathContains` recheck (a naive `!rel.startsWith("..")` string
    // check, not path-component-aware) still — correctly, for this guard's
    // deliberately paranoid design — flags it, a real reachable rejection,
    // not hypothetical.
    const root = tmpRoot("dotdot-prefix-escape");
    await expect(
      inspectManagedDownload({ basePath: join(root, "downloads"), bucket: "..evil", fileName: "payload.bin" }),
    ).rejects.toMatchObject({ code: MANAGED_DOWNLOAD_ERROR_CODES.INVALID_TARGET });
  });

  // These two tests used to drive a real `startFixture` HTTP server that
  // wrote `failFirstBytes` then called `response.destroy()` after a fixed
  // delay, racing the client's write-to-partial-file against the pipeline
  // observing the connection error. Confirmed (2026-07-20) to fail 100% of
  // the time on this machine even on unmodified pre-session code — a
  // pre-existing environmental race, not something introduced by any
  // particular timing tweak. Both tests now inject a custom `fetch`
  // (`managedDownload`'s `options.fetch` seam) that deterministically writes
  // exactly `failFirstBytes` to the partial file and *then* rejects the
  // fetch call itself — no stream/socket timing involved at all, so there is
  // no race to lose. This still drives the exact same production code path
  // (`downloadFromZero` throwing mid-stream, the retry loop in
  // `downloadWithRetries` observing nonzero partial bytes and switching to
  // `tryResumeDownload`) — it just makes the byte count leading up to the
  // failure deterministic instead of dependent on real network timing.
  it("resumes a partial download when the server supports Range", async () => {
    const body = "resumable payload from a flaky connection";
    const payload = Buffer.from(body);
    const failFirstBytes = 9;
    const basePath = join(tmpRoot("resume"), "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    const requests: FixtureRequest[] = [];
    let callCount = 0;

    const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
      callCount += 1;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      requests.push({ ...(headers.Range == null ? {} : { range: headers.Range }) });

      if (callCount === 1) {
        writeFileSync(partialPathFor(basePath, bucket, fileName), payload.subarray(0, failFirstBytes));
        throw new Error("simulated connection reset mid-download");
      }

      const match = /^bytes=(\d+)-$/.exec(headers.Range ?? "");
      const start = match?.[1] == null ? Number.NaN : Number(match[1]);
      if (!Number.isInteger(start) || start !== failFirstBytes) {
        throw new Error(`unexpected resume request headers: ${JSON.stringify(headers)}`);
      }
      const chunk = payload.subarray(start);
      return new Response(chunk, {
        status: 206,
        headers: {
          "content-length": String(chunk.byteLength),
          "content-range": `bytes ${start}-${payload.byteLength - 1}/${payload.byteLength}`,
          "content-type": "application/octet-stream",
          etag: '"fixture-etag"',
        },
      });
    }) as typeof globalThis.fetch;

    const result = await managedDownload({
      basePath,
      bucket,
      fileName,
      payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: "http://download-test.invalid/artifact.bin" },
      fetch: fetchImpl,
    });

    expect(result.resumed).toBe(true);
    expect(readFileSync(result.path, "utf8")).toBe(body);
    expect(requests.some((request) => request.range?.startsWith("bytes="))).toBe(true);
  });

  it("falls back to a full download when Range is not honored", async () => {
    const body = "fallback payload from a server without range support";
    const payload = Buffer.from(body);
    const failFirstBytes = 8;
    const basePath = join(tmpRoot("range-fallback"), "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    const requests: FixtureRequest[] = [];
    let callCount = 0;

    const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
      callCount += 1;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      requests.push({ ...(headers.Range == null ? {} : { range: headers.Range }) });

      if (callCount === 1) {
        writeFileSync(partialPathFor(basePath, bucket, fileName), payload.subarray(0, failFirstBytes));
        throw new Error("simulated connection reset mid-download");
      }

      // This fixture never honors Range, matching a server without resume
      // support: every request after the first gets the full body back with
      // a plain 200, regardless of whether a Range header was sent.
      return new Response(payload, {
        status: 200,
        headers: {
          "content-length": String(payload.byteLength),
          "content-type": "application/octet-stream",
          etag: '"fixture-etag"',
        },
      });
    }) as typeof globalThis.fetch;

    const result = await managedDownload({
      basePath,
      bucket,
      fileName,
      payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: "http://download-test.invalid/artifact.bin" },
      fetch: fetchImpl,
    });

    expect(result.resumed).toBe(false);
    expect(readFileSync(result.path, "utf8")).toBe(body);
    expect(requests.some((request) => request.range?.startsWith("bytes="))).toBe(true);
  });

  it("quick-fails a checksum mismatch after resetting owned state", async () => {
    const fixture = await startFixture("wrong bytes");
    const root = tmpRoot("checksum-mismatch");
    await expect(
      managedDownload({
        basePath: join(root, "downloads"),
        bucket: "updates",
        fileName: "installer.bin",
        payload: { checksum: { algorithm: "sha256", value: sha256("expected bytes") }, url: fixture.url },
      }),
    ).rejects.toMatchObject({ code: MANAGED_DOWNLOAD_ERROR_CODES.CHECKSUM_MISMATCH });
    await fixture.close();
  });

  it("dedupes same-process callers and fans out progress", async () => {
    const body = "dedupe payload";
    const fixture = await startFixture(body, { delayMs: 40 });
    const root = tmpRoot("dedupe");
    const firstProgress: ManagedDownloadProgress[] = [];
    const secondProgress: ManagedDownloadProgress[] = [];
    try {
      const input = {
        basePath: join(root, "downloads"),
        bucket: "shared",
        fileName: "payload.bin",
        payload: { checksum: { algorithm: "sha256" as const, value: sha256(body) }, url: fixture.url },
      };
      const [first, second] = await Promise.all([
        managedDownload({ ...input, onProgress: (progress) => firstProgress.push(progress) }),
        managedDownload({ ...input, onProgress: (progress) => secondProgress.push(progress) }),
      ]);

      expect(first.path).toBe(second.path);
      expect(fixture.requests).toHaveLength(1);
      expect(firstProgress.length).toBeGreaterThan(0);
      expect(secondProgress.length).toBeGreaterThan(0);
    } finally {
      await fixture.close();
    }
  });

  it("aborts only the caller wait while the shared transfer continues", async () => {
    const body = "abort subscriber payload";
    const fixture = await startFixture(body, { delayMs: 60 });
    const root = tmpRoot("abort");
    const controller = new AbortController();
    try {
      const input = {
        basePath: join(root, "downloads"),
        bucket: "shared",
        fileName: "payload.bin",
        payload: { checksum: { algorithm: "sha256" as const, value: sha256(body) }, url: fixture.url },
      };
      const aborted = managedDownload({ ...input, signal: controller.signal });
      const keeper = managedDownload(input);
      await sleep(5);
      controller.abort();

      await expect(aborted).rejects.toMatchObject({ code: MANAGED_DOWNLOAD_ERROR_CODES.ABORTED });
      const result = await keeper;
      expect(readFileSync(result.path, "utf8")).toBe(body);
      expect(fixture.requests).toHaveLength(1);
    } finally {
      await fixture.close();
    }
  });

  it("clears a stale pid lock before acquiring the target", async () => {
    const body = "stale lock payload";
    const fixture = await startFixture(body);
    const root = tmpRoot("stale-lock");
    const basePath = join(root, "downloads");
    try {
      await inspectManagedDownload({ basePath, bucket: "updates", fileName: "installer.bin" });
      writeFileSync(lockPath(basePath, "updates", "installer.bin"), JSON.stringify({
        createdAt: new Date().toISOString(),
        pid: exitedPid(),
      }));

      const result = await managedDownload({
        basePath,
        bucket: "updates",
        fileName: "installer.bin",
        payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: fixture.url },
      });

      expect(readFileSync(result.path, "utf8")).toBe(body);
      expect(existsSync(lockPath(basePath, "updates", "installer.bin"))).toBe(false);
      expect(fixture.requests).toHaveLength(1);
    } finally {
      await fixture.close();
    }
  });

  it("clears a stale lock when Windows reuses the old owner pid for this process", async () => {
    const body = "pid reuse lock payload";
    const fixture = await startFixture(body);
    const root = tmpRoot("pid-reuse-lock");
    const basePath = join(root, "downloads");
    try {
      await inspectManagedDownload({ basePath, bucket: "updates", fileName: "installer.bin" });
      writeFileSync(lockPath(basePath, "updates", "installer.bin"), JSON.stringify({
        createdAt: new Date(Date.now() - (process.uptime() + 60) * 1000).toISOString(),
        pid: process.pid,
      }));

      const result = await managedDownload({
        basePath,
        bucket: "updates",
        fileName: "installer.bin",
        payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: fixture.url },
      });

      expect(readFileSync(result.path, "utf8")).toBe(body);
      expect(existsSync(lockPath(basePath, "updates", "installer.bin"))).toBe(false);
      expect(fixture.requests).toHaveLength(1);
    } finally {
      await fixture.close();
    }
  });

  it("quick-fails when the target lock pid is still alive", async () => {
    const body = "alive lock payload";
    const fixture = await startFixture(body);
    const root = tmpRoot("alive-lock");
    const basePath = join(root, "downloads");
    try {
      await inspectManagedDownload({ basePath, bucket: "updates", fileName: "installer.bin" });
      writeFileSync(lockPath(basePath, "updates", "installer.bin"), JSON.stringify({
        createdAt: new Date().toISOString(),
        pid: process.pid,
      }));

      await expect(
        managedDownload({
          basePath,
          bucket: "updates",
          fileName: "installer.bin",
          payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: fixture.url },
        }),
      ).rejects.toMatchObject({ code: MANAGED_DOWNLOAD_ERROR_CODES.TARGET_LOCKED });
      expect(fixture.requests).toHaveLength(0);
    } finally {
      await fixture.close();
    }
  });

  it("refuses to overwrite caller output when bytes differ", async () => {
    const body = "output conflict payload";
    const fixture = await startFixture(body);
    const root = tmpRoot("output-conflict");
    const outputPath = join(root, "artifact.bin");
    writeFileSync(outputPath, "existing");
    try {
      await expect(
        downloadCopyAndClear({
          basePath: join(root, "downloads"),
          bucket: "updates",
          fileName: "installer.bin",
          outputPath,
          payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: fixture.url },
        }),
      ).rejects.toMatchObject({ code: MANAGED_DOWNLOAD_ERROR_CODES.OUTPUT_CONFLICT });
      expect(readFileSync(outputPath, "utf8")).toBe("existing");
    } finally {
      await fixture.close();
    }
  });

  it("exposes explicit remove for managed targets", async () => {
    const body = "remove payload";
    const fixture = await startFixture(body);
    const root = tmpRoot("remove");
    const basePath = join(root, "downloads");
    try {
      const result = await managedDownload({
        basePath,
        bucket: "updates",
        fileName: "installer.bin",
        payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: fixture.url },
      });
      expect(existsSync(result.path)).toBe(true);

      await removeManagedDownload({ basePath, bucket: "updates", fileName: "installer.bin" });
      expect((await inspectManagedDownload({ basePath, bucket: "updates", fileName: "installer.bin" })).complete).toBe(false);
    } finally {
      await fixture.close();
    }
  });

  it("prunes managed data older than the default one-day window", async () => {
    const body = "old payload";
    const fixture = await startFixture(body);
    const root = tmpRoot("prune");
    const basePath = join(root, "downloads");
    try {
      await managedDownload({
        basePath,
        bucket: "updates",
        fileName: "installer.bin",
        payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: fixture.url },
      });

      const pruned = await pruneManagedDownloads({ basePath, now: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) });

      expect(pruned.removed).toBeGreaterThan(0);
      expect((await inspectManagedDownload({ basePath, bucket: "updates", fileName: "installer.bin" })).complete).toBe(false);
    } finally {
      await fixture.close();
    }
  });

  it("resets suspicious complete state and redownloads from a clean base", async () => {
    const body = "fresh payload";
    const fixture = await startFixture(body);
    const root = tmpRoot("suspicious-reset");
    const basePath = join(root, "downloads");
    try {
      const first = await managedDownload({
        basePath,
        bucket: "updates",
        fileName: "installer.bin",
        payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: fixture.url },
      });
      writeFileSync(first.path, "tampered bytes");

      const second = await managedDownload({
        basePath,
        bucket: "updates",
        fileName: "installer.bin",
        payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: fixture.url },
      });

      expect(readFileSync(second.path, "utf8")).toBe(body);
      expect(fixture.requests.length).toBeGreaterThanOrEqual(2);
    } finally {
      await fixture.close();
    }
  });

  it("reuses a previously completed download without re-fetching", async () => {
    const body = "reusable payload";
    const fixture = await startFixture(body);
    const root = tmpRoot("reuse-complete");
    const basePath = join(root, "downloads");
    try {
      const first = await managedDownload({
        basePath,
        bucket: "updates",
        fileName: "installer.bin",
        payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: fixture.url },
      });
      expect(first.reusedComplete).toBe(false);
      expect(fixture.requests).toHaveLength(1);

      const second = await managedDownload({
        basePath,
        bucket: "updates",
        fileName: "installer.bin",
        payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: fixture.url },
      });
      expect(second.reusedComplete).toBe(true);
      expect(second.path).toBe(first.path);
      expect(fixture.requests).toHaveLength(1);
    } finally {
      await fixture.close();
    }
  });

  it("resets and redownloads when the on-disk manifest is corrupt JSON", async () => {
    const body = "recovered payload";
    const fixture = await startFixture(body);
    const root = tmpRoot("bad-manifest");
    const basePath = join(root, "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    try {
      await inspectManagedDownload({ basePath, bucket, fileName });
      writeFileSync(manifestPathFor(basePath, bucket, fileName), "{not valid json");

      const result = await managedDownload({
        basePath,
        bucket,
        fileName,
        payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: fixture.url },
      });
      expect(readFileSync(result.path, "utf8")).toBe(body);
      expect(fixture.requests).toHaveLength(1);
    } finally {
      await fixture.close();
    }
  });

  it("resets when an existing manifest's identity no longer matches the requested payload", async () => {
    const bodyB = "payload b — the one actually requested";
    const fixture = await startFixture(bodyB);
    const root = tmpRoot("identity-mismatch");
    const basePath = join(root, "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    try {
      await inspectManagedDownload({ basePath, bucket, fileName });
      // A manifest left behind for a *different* url/checksum under the same
      // bucket/fileName — its identityDigest/urlDigest deliberately don't
      // match the target we're about to build.
      writeManifestFile(basePath, bucket, fileName, {
        checksum: { algorithm: "sha256", value: "0".repeat(64) },
        identityDigest: "1".repeat(64),
        state: "complete",
        url: "https://example.invalid/a-different-artifact.bin",
      });

      const result = await managedDownload({
        basePath,
        bucket,
        fileName,
        payload: { checksum: { algorithm: "sha256", value: sha256(bodyB) }, url: fixture.url },
      });
      expect(readFileSync(result.path, "utf8")).toBe(bodyB);
      expect(fixture.requests).toHaveLength(1);
    } finally {
      await fixture.close();
    }
  });

  it("resets when a partial manifest has no matching partial file on disk", async () => {
    const body = "restart after missing partial";
    const fixture = await startFixture(body);
    const root = tmpRoot("missing-partial");
    const basePath = join(root, "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    try {
      await inspectManagedDownload({ basePath, bucket, fileName });
      writeManifestFile(basePath, bucket, fileName, {
        checksum: { algorithm: "sha256", value: sha256(body) },
        state: "partial",
        url: fixture.url,
      });
      // Deliberately no .partial file written — partialExists is false.

      const result = await managedDownload({
        basePath,
        bucket,
        fileName,
        payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: fixture.url },
      });
      expect(readFileSync(result.path, "utf8")).toBe(body);
      expect(fixture.requests).toHaveLength(1);
    } finally {
      await fixture.close();
    }
  });

  it("resumes a partial download left behind by a previous process, with matching validators", async () => {
    const body = "resume across separate managedDownload calls";
    const fixture = await startFixture(body, { range: true });
    const root = tmpRoot("cross-call-resume");
    const basePath = join(root, "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    try {
      await inspectManagedDownload({ basePath, bucket, fileName });
      const checksum = { algorithm: "sha256" as const, value: sha256(body) };
      const partialPrefix = Buffer.from(body).subarray(0, 6);
      writeFileSync(partialPathFor(basePath, bucket, fileName), partialPrefix);
      // The saved etag matches what the fixture actually serves, so the
      // resume must proceed rather than restart (validatorsConflict: false).
      writeManifestFile(basePath, bucket, fileName, {
        checksum,
        state: "partial",
        url: fixture.url,
        validators: { etag: '"fixture-etag"' },
      });

      const result = await managedDownload({
        basePath,
        bucket,
        fileName,
        payload: { checksum, url: fixture.url },
      });

      expect(result.resumed).toBe(true);
      expect(readFileSync(result.path, "utf8")).toBe(body);
      expect(fixture.requests.some((request) => request.range?.startsWith(`bytes=${partialPrefix.byteLength}-`))).toBe(true);
    } finally {
      await fixture.close();
    }
  });

  it("restarts a resume when the server's validators no longer match the saved manifest", async () => {
    const body = "validator conflict payload, long enough to matter";
    const fixture = await startFixture(body, { range: true });
    const root = tmpRoot("validator-conflict");
    const basePath = join(root, "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    try {
      await inspectManagedDownload({ basePath, bucket, fileName });
      const checksum = { algorithm: "sha256" as const, value: sha256(body) };
      const partialPrefix = Buffer.from(body).subarray(0, 6);
      writeFileSync(partialPathFor(basePath, bucket, fileName), partialPrefix);
      writeManifestFile(basePath, bucket, fileName, {
        checksum,
        state: "partial",
        url: fixture.url,
        validators: { etag: '"stale-etag-from-a-different-upload"' },
      });

      const result = await managedDownload({
        basePath,
        bucket,
        fileName,
        payload: { checksum, url: fixture.url },
      });

      // Had to restart from zero — the saved etag conflicted with the
      // server's current one, even though the byte offset matched.
      expect(result.resumed).toBe(false);
      expect(readFileSync(result.path, "utf8")).toBe(body);
    } finally {
      await fixture.close();
    }
  });

  it("dedupes a fresh download against an out-of-band final file with matching bytes", async () => {
    const body = "already present final payload, long enough to resume from";
    const fixture = await startFixture(body);
    const root = tmpRoot("preexisting-final-match");
    const basePath = join(root, "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    try {
      await inspectManagedDownload({ basePath, bucket, fileName });
      const checksum = { algorithm: "sha256" as const, value: sha256(body) };
      const partialPrefix = Buffer.from(body).subarray(0, 8);
      mkdirSync(join(basePath, bucket), { recursive: true });
      writeFileSync(join(basePath, bucket, fileName), body); // out-of-band final, correct bytes
      writeFileSync(partialPathFor(basePath, bucket, fileName), partialPrefix); // genuine correct prefix
      writeManifestFile(basePath, bucket, fileName, { checksum, state: "partial", url: fixture.url });

      const result = await managedDownload({ basePath, bucket, fileName, payload: { checksum, url: fixture.url } });

      expect(result.resumed).toBe(true);
      expect(result.reusedComplete).toBe(false);
      expect(readFileSync(result.path, "utf8")).toBe(body);
      expect(existsSync(partialPathFor(basePath, bucket, fileName))).toBe(false);
    } finally {
      await fixture.close();
    }
  });

  it("resets and fails when an out-of-band final file has the wrong bytes", async () => {
    const body = "correct payload for a mismatch test, long enough to resume from";
    const fixture = await startFixture(body);
    const root = tmpRoot("preexisting-final-mismatch");
    const basePath = join(root, "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    try {
      await inspectManagedDownload({ basePath, bucket, fileName });
      const checksum = { algorithm: "sha256" as const, value: sha256(body) };
      const partialPrefix = Buffer.from(body).subarray(0, 8);
      mkdirSync(join(basePath, bucket), { recursive: true });
      writeFileSync(join(basePath, bucket, fileName), "totally wrong bytes sitting at the final path already");
      writeFileSync(partialPathFor(basePath, bucket, fileName), partialPrefix);
      writeManifestFile(basePath, bucket, fileName, { checksum, state: "partial", url: fixture.url });

      await expect(
        managedDownload({ basePath, bucket, fileName, payload: { checksum, url: fixture.url } }),
      ).rejects.toMatchObject({ code: MANAGED_DOWNLOAD_ERROR_CODES.STORE_CORRUPT });
    } finally {
      await fixture.close();
    }
  });

  it("fails the download when the freshly-written partial file disappears before it can be hashed", async () => {
    const body = "vanishing partial payload, long enough to split into two chunks";
    const root = tmpRoot("vanishing-partial");
    const basePath = join(root, "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    const partial = partialPathFor(basePath, bucket, fileName);

    const bytes = Buffer.from(body);
    const half = bytes.subarray(0, Math.ceil(bytes.length / 2));
    const rest = bytes.subarray(Math.ceil(bytes.length / 2));
    const fakeFetch = (async () => {
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(half);
          // Wait until the partial file genuinely exists on disk, then
          // unlink it out from under the still-open write stream — safe on
          // POSIX (the writer keeps its fd) — so hashFile sees ENOENT once
          // the "download" is done.
          for (let attempt = 0; attempt < 500 && !existsSync(partial); attempt += 1) {
            await sleep(2);
          }
          rmSync(partial, { force: true });
          controller.enqueue(rest);
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-length": String(bytes.byteLength), "content-type": "application/octet-stream" },
      });
    }) as typeof fetch;

    await expect(
      managedDownload({
        basePath,
        bucket,
        fileName,
        fetch: fakeFetch,
        payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: "https://example.invalid/artifact.bin" },
      }),
    ).rejects.toMatchObject({ code: MANAGED_DOWNLOAD_ERROR_CODES.STORE_CORRUPT });
  });

  it.skipIf(isRoot)("gives up when the download state keeps resetting after cleanup (a permanently unreadable manifest)", async () => {
    const root = tmpRoot("perma-reset");
    const basePath = join(root, "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    await inspectManagedDownload({ basePath, bucket, fileName });
    const stateDir = join(basePath, ".state");
    writeFileSync(manifestPathFor(basePath, bucket, fileName), "{not valid json");
    // With `.state` unreadable, every attempt to read the (corrupt-looking)
    // manifest fails the same way, so the post-cleanup reload is *still*
    // suspicious — the outer "kept resetting" guard has to fire.
    chmodSync(stateDir, 0o000);
    try {
      await expect(
        managedDownload({
          basePath,
          bucket,
          fileName,
          payload: { checksum: { algorithm: "sha256", value: sha256("irrelevant") }, url: "https://example.invalid/artifact.bin" },
        }),
      ).rejects.toMatchObject({ code: MANAGED_DOWNLOAD_ERROR_CODES.STORE_CORRUPT });
    } finally {
      chmodSync(stateDir, 0o755);
    }
  });

  it("exhausts retries and reports the last failure, even a non-Error rejection", async () => {
    const root = tmpRoot("network-exhausted");
    const basePath = join(root, "downloads");
    const fakeFetch = (async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "connection refused";
    }) as unknown as typeof fetch;

    await expect(
      managedDownload({
        basePath,
        bucket: "updates",
        fileName: "installer.bin",
        fetch: fakeFetch,
        maxAttempts: 2,
        payload: { checksum: { algorithm: "sha256", value: "0".repeat(64) }, url: "https://example.invalid/artifact.bin" },
      }),
    ).rejects.toMatchObject({
      code: MANAGED_DOWNLOAD_ERROR_CODES.NETWORK_EXHAUSTED,
      message: expect.stringContaining("connection refused"),
    });
  });

  it("rejects urls and payloads that fail basic target normalization", async () => {
    const root = tmpRoot("invalid-target");
    const basePath = join(root, "downloads");
    const validUrl = "https://example.invalid/x.bin";

    await expect(
      managedDownload({
        basePath,
        bucket: "updates",
        fileName: "installer.bin",
        payload: { checksum: { algorithm: "sha256", value: "0".repeat(64) }, url: "ftp://example.invalid/x.bin" },
      }),
    ).rejects.toMatchObject({ code: MANAGED_DOWNLOAD_ERROR_CODES.INVALID_TARGET });

    await expect(
      managedDownload({
        basePath,
        bucket: "updates",
        fileName: "installer.bin",
        payload: { checksum: { algorithm: "sha256", value: "0".repeat(64) }, url: "not a url at all" },
      }),
    ).rejects.toMatchObject({ code: MANAGED_DOWNLOAD_ERROR_CODES.INVALID_TARGET });

    await expect(
      managedDownload({
        basePath,
        bucket: "updates",
        fileName: "installer.bin",
        payload: { checksum: { algorithm: "md5" as never, value: "0".repeat(64) }, url: validUrl },
      }),
    ).rejects.toMatchObject({ code: MANAGED_DOWNLOAD_ERROR_CODES.INVALID_TARGET });

    await expect(
      managedDownload({
        basePath,
        bucket: "updates",
        fileName: "installer.bin",
        payload: { checksum: { algorithm: "sha256", value: "not-hex" }, url: validUrl },
      }),
    ).rejects.toMatchObject({ code: MANAGED_DOWNLOAD_ERROR_CODES.INVALID_TARGET });

    await expect(
      managedDownload({
        basePath,
        bucket: "",
        fileName: "installer.bin",
        payload: { checksum: { algorithm: "sha256", value: "0".repeat(64) }, url: validUrl },
      }),
    ).rejects.toMatchObject({ code: MANAGED_DOWNLOAD_ERROR_CODES.INVALID_TARGET });

    await expect(
      managedDownload({
        basePath,
        bucket: "updates",
        fileName: "../escape",
        payload: { checksum: { algorithm: "sha256", value: "0".repeat(64) }, url: validUrl },
      }),
    ).rejects.toMatchObject({ code: MANAGED_DOWNLOAD_ERROR_CODES.INVALID_TARGET });

    await expect(
      managedDownload({
        basePath: "",
        bucket: "updates",
        fileName: "installer.bin",
        payload: { checksum: { algorithm: "sha256", value: "0".repeat(64) }, url: validUrl },
      }),
    ).rejects.toMatchObject({ code: MANAGED_DOWNLOAD_ERROR_CODES.INVALID_TARGET });
  });

  it("refuses a download base that is a symlink rather than a plain directory", async () => {
    const root = tmpRoot("basepath-symlink");
    const realDir = join(root, "real-target");
    mkdirSync(realDir, { recursive: true });
    const basePath = join(root, "downloads-link");
    symlinkSync(realDir, basePath, "dir");

    await expect(
      managedDownload({
        basePath,
        bucket: "updates",
        fileName: "installer.bin",
        payload: { checksum: { algorithm: "sha256", value: "0".repeat(64) }, url: "https://example.invalid/x.bin" },
      }),
    ).rejects.toMatchObject({ code: MANAGED_DOWNLOAD_ERROR_CODES.STORE_NOT_OWNED });
  });

  it("refuses a non-empty download base that has no ownership marker", async () => {
    const root = tmpRoot("nonempty-no-sentinel");
    const basePath = join(root, "downloads");
    mkdirSync(basePath, { recursive: true });
    writeFileSync(join(basePath, "unexpected.txt"), "surprise");

    await expect(
      managedDownload({
        basePath,
        bucket: "updates",
        fileName: "installer.bin",
        payload: { checksum: { algorithm: "sha256", value: "0".repeat(64) }, url: "https://example.invalid/x.bin" },
      }),
    ).rejects.toMatchObject({ code: MANAGED_DOWNLOAD_ERROR_CODES.STORE_NOT_OWNED });
  });

  it("refuses a download base with an invalid ownership marker", async () => {
    const root = tmpRoot("bad-sentinel");
    const basePath = join(root, "downloads");
    mkdirSync(basePath, { recursive: true });
    writeFileSync(join(basePath, ".jini-download-root.json"), JSON.stringify({ not: "a sentinel" }));

    await expect(
      managedDownload({
        basePath,
        bucket: "updates",
        fileName: "installer.bin",
        payload: { checksum: { algorithm: "sha256", value: "0".repeat(64) }, url: "https://example.invalid/x.bin" },
      }),
    ).rejects.toMatchObject({ code: MANAGED_DOWNLOAD_ERROR_CODES.STORE_NOT_OWNED });
  });

  it("treats a lock as active when it belongs to a different, currently-alive process", async () => {
    const body = "foreign alive lock payload";
    const fixture = await startFixture(body);
    const root = tmpRoot("foreign-alive-lock");
    const basePath = join(root, "downloads");
    try {
      await inspectManagedDownload({ basePath, bucket: "updates", fileName: "installer.bin" });
      writeFileSync(
        lockPath(basePath, "updates", "installer.bin"),
        JSON.stringify({ createdAt: new Date().toISOString(), pid: process.ppid }),
      );

      await expect(
        managedDownload({
          basePath,
          bucket: "updates",
          fileName: "installer.bin",
          payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: fixture.url },
        }),
      ).rejects.toMatchObject({ code: MANAGED_DOWNLOAD_ERROR_CODES.TARGET_LOCKED });
      expect(fixture.requests).toHaveLength(0);
    } finally {
      await fixture.close();
    }
  });

  it.skipIf(isRoot)("propagates a non-lock-contention error while acquiring the download lock (real chmod, non-root)", async () => {
    const root = tmpRoot("lock-acquire-error");
    const basePath = join(root, "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    await inspectManagedDownload({ basePath, bucket, fileName }); // creates .locks
    const locksDir = join(basePath, ".locks");
    chmodSync(locksDir, 0o000);
    try {
      await expect(
        managedDownload({
          basePath,
          bucket,
          fileName,
          payload: { checksum: { algorithm: "sha256", value: "0".repeat(64) }, url: "https://example.invalid/x.bin" },
        }),
      ).rejects.toThrow();
    } finally {
      chmodSync(locksDir, 0o755);
    }
  });

  it("propagates a non-lock-contention error while acquiring the download lock (mocked writeFile, root-independent)", async () => {
    // The chmod-based test above is a false positive under root: root's
    // CAP_DAC_OVERRIDE means the lock write actually *succeeds*, and this
    // test would only "pass" because the subsequent fetch to a bogus host
    // also throws — never actually exercising acquireLock's non-EEXIST
    // `throw error;` passthrough (download.ts:708) at all. Reached
    // deterministically here instead.
    const root = tmpRoot("lock-acquire-error-mocked");
    const basePath = join(root, "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    await inspectManagedDownload({ basePath, bucket, fileName }); // creates .locks

    const fsPromises = await import("node:fs/promises");
    vi.mocked(fsPromises.writeFile).mockImplementationOnce(async (p) => {
      if (String(p).endsWith(".lock")) {
        const err = new Error("EIO: i/o error, write") as NodeJS.ErrnoException;
        err.code = "EIO";
        throw err;
      }
      throw new Error("unexpected writeFile call in this test");
    });

    await expect(
      managedDownload({
        basePath,
        bucket,
        fileName,
        payload: { checksum: { algorithm: "sha256", value: "0".repeat(64) }, url: "https://example.invalid/x.bin" },
      }),
    ).rejects.toMatchObject({ code: "EIO" });
  });

  it("treats a lock-write failure with an explicit null .code as not-EEXIST and rethrows it (errorCode's code==null branch)", async () => {
    const root = tmpRoot("lock-acquire-null-code");
    const basePath = join(root, "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    await inspectManagedDownload({ basePath, bucket, fileName });

    const fsPromises = await import("node:fs/promises");
    vi.mocked(fsPromises.writeFile).mockImplementationOnce(async (p) => {
      if (String(p).endsWith(".lock")) {
        throw Object.assign(new Error("a lock write failure with a null code"), { code: null });
      }
      throw new Error("unexpected writeFile call in this test");
    });

    await expect(
      managedDownload({
        basePath,
        bucket,
        fileName,
        payload: { checksum: { algorithm: "sha256", value: "0".repeat(64) }, url: "https://example.invalid/x.bin" },
      }),
    ).rejects.toThrow("a lock write failure with a null code");
  });

  it("rejects immediately when the wait signal is already aborted", async () => {
    const body = "already aborted payload";
    const fixture = await startFixture(body, { delayMs: 30 });
    const root = tmpRoot("pre-aborted");
    const controller = new AbortController();
    controller.abort();
    try {
      await expect(
        managedDownload({
          basePath: join(root, "downloads"),
          bucket: "updates",
          fileName: "installer.bin",
          payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: fixture.url },
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ code: MANAGED_DOWNLOAD_ERROR_CODES.ABORTED });
      // Let the still-running background task settle before the fixture
      // closes and the temp dir gets swept out from under it.
      await sleep(60);
    } finally {
      await fixture.close();
    }
  });

  it("rejects a conflicting identity for a target that is already active", async () => {
    const bodyA = "identity a payload";
    const fixtureA = await startFixture(bodyA, { delayMs: 60 });
    const root = tmpRoot("target-conflict");
    const basePath = join(root, "downloads");
    try {
      const first = managedDownload({
        basePath,
        bucket: "updates",
        fileName: "installer.bin",
        payload: { checksum: { algorithm: "sha256", value: sha256(bodyA) }, url: fixtureA.url },
      });
      await expect(
        managedDownload({
          basePath,
          bucket: "updates",
          fileName: "installer.bin",
          payload: { checksum: { algorithm: "sha256", value: sha256("different") }, url: `${fixtureA.url}?v=2` },
        }),
      ).rejects.toMatchObject({ code: MANAGED_DOWNLOAD_ERROR_CODES.TARGET_CONFLICT });
      await first;
    } finally {
      await fixtureA.close();
    }
  });

  it("refuses to remove a target that is still actively downloading", async () => {
    const body = "still downloading payload";
    const fixture = await startFixture(body, { delayMs: 60 });
    const root = tmpRoot("remove-while-active");
    const basePath = join(root, "downloads");
    try {
      const inFlight = managedDownload({
        basePath,
        bucket: "updates",
        fileName: "installer.bin",
        payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: fixture.url },
      });
      await expect(
        removeManagedDownload({ basePath, bucket: "updates", fileName: "installer.bin" }),
      ).rejects.toMatchObject({ code: MANAGED_DOWNLOAD_ERROR_CODES.TARGET_LOCKED });
      await inFlight;
    } finally {
      await fixture.close();
    }
  });

  it("rejects an empty or null-byte outputPath before starting the download", async () => {
    const root = tmpRoot("bad-output-path");
    const basePath = join(root, "downloads");
    const payload = { checksum: { algorithm: "sha256" as const, value: "0".repeat(64) }, url: "https://example.invalid/x.bin" };

    await expect(
      downloadCopyAndClear({ basePath, bucket: "updates", fileName: "installer.bin", outputPath: "", payload }),
    ).rejects.toMatchObject({ code: MANAGED_DOWNLOAD_ERROR_CODES.INVALID_TARGET });

    await expect(
      downloadCopyAndClear({ basePath, bucket: "updates", fileName: "installer.bin", outputPath: "bad\0path", payload }),
    ).rejects.toMatchObject({ code: MANAGED_DOWNLOAD_ERROR_CODES.INVALID_TARGET });
  });

  it("shares a copy lease across concurrent copyAndClear calls, deferring cleanup until the last one releases", async () => {
    const body = "shared lease payload";
    const fixture = await startFixture(body);
    const root = tmpRoot("copy-lease-share");
    const basePath = join(root, "downloads");
    const outputA = join(root, "out-a", "artifact.bin");
    const outputB = join(root, "out-b", "artifact.bin");
    try {
      const input = {
        basePath,
        bucket: "shared",
        fileName: "payload.bin",
        payload: { checksum: { algorithm: "sha256" as const, value: sha256(body) }, url: fixture.url },
      };
      const [resultA, resultB] = await Promise.all([
        downloadCopyAndClear({ ...input, outputPath: outputA }),
        downloadCopyAndClear({ ...input, outputPath: outputB }),
      ]);

      expect(readFileSync(outputA, "utf8")).toBe(body);
      expect(readFileSync(outputB, "utf8")).toBe(body);
      // Exactly one of the two must have observed the other lease still
      // held (deferred); whichever released last performs the real cleanup.
      expect([resultA.cleanup, resultB.cleanup]).toContain("deferred");
      const inspected = await inspectManagedDownload({ basePath, bucket: "shared", fileName: "payload.bin" });
      expect(inspected.complete).toBe(false);
    } finally {
      await fixture.close();
    }
  });

  it.skipIf(isRoot)("records a warning when a prunable entry cannot be removed (real chmod, non-root)", async () => {
    const body = "prune warning payload";
    const fixture = await startFixture(body);
    const root = tmpRoot("prune-warning");
    const basePath = join(root, "downloads");
    try {
      await managedDownload({
        basePath,
        bucket: "updates",
        fileName: "installer.bin",
        payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: fixture.url },
      });
      // A locked-down nested dir inside the completed bucket stands in for a
      // permission-denied prunable entry: `rm` fails on it (force only
      // suppresses "already gone", not "can't get in"), so the prune loop
      // must record a warning rather than silently drop the failure.
      const bucketDir = join(basePath, "updates");
      const lockedDir = join(bucketDir, "locked");
      mkdirSync(lockedDir);
      writeFileSync(join(lockedDir, "nested.txt"), "x");
      chmodSync(lockedDir, 0o000);
      try {
        const pruned = await pruneManagedDownloads({ basePath, now: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) });
        expect(pruned.warnings.length).toBeGreaterThan(0);
      } finally {
        chmodSync(lockedDir, 0o755);
      }
    } finally {
      await fixture.close();
    }
  });

  it("records a warning when a prunable entry cannot be removed (mocked rm, root-independent)", async () => {
    const body = "prune warning payload (mocked)";
    const fixture = await startFixture(body);
    const root = tmpRoot("prune-warning-mocked");
    const basePath = join(root, "downloads");
    try {
      await managedDownload({
        basePath,
        bucket: "updates",
        fileName: "installer.bin",
        payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: fixture.url },
      });
      const bucketDir = join(basePath, "updates");
      const lockedDir = join(bucketDir, "locked");
      mkdirSync(lockedDir);
      writeFileSync(join(lockedDir, "nested.txt"), "x");

      const fsPromises = await import("node:fs/promises");
      vi.mocked(fsPromises.rm).mockImplementationOnce(async () => {
        const err = new Error("EACCES: permission denied, rm") as NodeJS.ErrnoException;
        err.code = "EACCES";
        throw err;
      });

      const pruned = await pruneManagedDownloads({ basePath, now: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) });
      expect(pruned.warnings.length).toBeGreaterThan(0);
    } finally {
      await fixture.close();
    }
  });

  it("accepts a sha512 payload end-to-end (normalizeChecksum's sha512 branch)", async () => {
    const body = "sha512 payload";
    const sha512 = createHash("sha512").update(body).digest("hex");
    const fixture = await startFixture(body);
    const root = tmpRoot("sha512");
    try {
      const result = await managedDownload({
        basePath: join(root, "downloads"),
        bucket: "updates",
        fileName: "installer.bin",
        payload: { checksum: { algorithm: "sha512", value: sha512 }, url: fixture.url },
      });
      expect(readFileSync(result.path, "utf8")).toBe(body);
    } finally {
      await fixture.close();
    }
  });

  it("rejects (and resets) a sentinel file that is not an object shape (isStoreSentinel's guard)", async () => {
    const root = tmpRoot("sentinel-not-object");
    const basePath = join(root, "downloads");
    mkdirSync(basePath, { recursive: true });
    writeFileSync(join(basePath, ".jini-download-root.json"), JSON.stringify(["not", "an", "object"]));

    await expect(
      managedDownload({
        basePath,
        bucket: "updates",
        fileName: "installer.bin",
        payload: { checksum: { algorithm: "sha256", value: "0".repeat(64) }, url: "https://example.invalid/x.bin" },
      }),
    ).rejects.toMatchObject({ code: MANAGED_DOWNLOAD_ERROR_CODES.STORE_NOT_OWNED });
  });

  it("resets when a manifest is a non-object JSON shape (isManifest's guard, readManifest's invalid branch)", async () => {
    const body = "manifest-not-object payload";
    const fixture = await startFixture(body);
    const root = tmpRoot("manifest-not-object");
    const basePath = join(root, "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    try {
      await inspectManagedDownload({ basePath, bucket, fileName });
      writeFileSync(manifestPathFor(basePath, bucket, fileName), JSON.stringify([1, 2, 3]));

      const result = await managedDownload({
        basePath,
        bucket,
        fileName,
        payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: fixture.url },
      });
      expect(readFileSync(result.path, "utf8")).toBe(body);
    } finally {
      await fixture.close();
    }
  });

  it("resets when a manifest's checksum field is not an object at all (isChecksum's typeof/null/array guard)", async () => {
    const body = "manifest-checksum-not-object payload";
    const fixture = await startFixture(body);
    const root = tmpRoot("manifest-checksum-not-object");
    const basePath = join(root, "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    try {
      await inspectManagedDownload({ basePath, bucket, fileName });
      writeFileSync(
        manifestPathFor(basePath, bucket, fileName),
        JSON.stringify({
          bucket,
          checksum: ["not", "an", "object"],
          createdAt: new Date().toISOString(),
          fileName,
          identityDigest: "0".repeat(64),
          kind: "jini-managed-download",
          schemaVersion: 1,
          state: "partial",
          targetKey: targetKey(bucket, fileName),
          updatedAt: new Date().toISOString(),
          urlDigest: "0".repeat(64),
        }),
      );

      const result = await managedDownload({
        basePath,
        bucket,
        fileName,
        payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: fixture.url },
      });
      expect(readFileSync(result.path, "utf8")).toBe(body);
    } finally {
      await fixture.close();
    }
  });

  it("resets when a manifest's checksum field's algorithm is unsupported (isChecksum's algorithm guard)", async () => {
    const body = "manifest-bad-checksum payload";
    const fixture = await startFixture(body);
    const root = tmpRoot("manifest-bad-checksum");
    const basePath = join(root, "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    try {
      await inspectManagedDownload({ basePath, bucket, fileName });
      writeFileSync(
        manifestPathFor(basePath, bucket, fileName),
        JSON.stringify({
          bucket,
          checksum: { algorithm: "md5", value: "0".repeat(64) }, // unsupported algorithm — fails isChecksum
          createdAt: new Date().toISOString(),
          fileName,
          identityDigest: "0".repeat(64),
          kind: "jini-managed-download",
          schemaVersion: 1,
          state: "partial",
          targetKey: targetKey(bucket, fileName),
          updatedAt: new Date().toISOString(),
          urlDigest: "0".repeat(64),
        }),
      );

      const result = await managedDownload({
        basePath,
        bucket,
        fileName,
        payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: fixture.url },
      });
      expect(readFileSync(result.path, "utf8")).toBe(body);
    } finally {
      await fixture.close();
    }
  });

  it("treats a non-object lock file as not a valid lock (isDownloadLockFile's guard) and refuses to clear it as stale", async () => {
    const body = "invalid-lock-shape payload";
    const fixture = await startFixture(body);
    const root = tmpRoot("invalid-lock-shape");
    const basePath = join(root, "downloads");
    try {
      await inspectManagedDownload({ basePath, bucket: "updates", fileName: "installer.bin" });
      // A dead pid would normally make this lock clearable as stale, but an
      // invalid *shape* (here: a bare array) must not be treated as a
      // parseable lock at all — clearStaleLock has to refuse it outright.
      writeFileSync(lockPath(basePath, "updates", "installer.bin"), JSON.stringify([exitedPid()]));

      await expect(
        managedDownload({
          basePath,
          bucket: "updates",
          fileName: "installer.bin",
          payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: fixture.url },
        }),
      ).rejects.toMatchObject({ code: MANAGED_DOWNLOAD_ERROR_CODES.TARGET_LOCKED });
    } finally {
      await fixture.close();
    }
  });

  it("treats a lock file with a wrongly-typed processStartedAt as invalid (isDownloadLockFile's field-type guard)", async () => {
    const body = "bad-processStartedAt-type payload";
    const fixture = await startFixture(body);
    const root = tmpRoot("bad-processstartedat-type");
    const basePath = join(root, "downloads");
    try {
      await inspectManagedDownload({ basePath, bucket: "updates", fileName: "installer.bin" });
      writeFileSync(
        lockPath(basePath, "updates", "installer.bin"),
        JSON.stringify({ createdAt: new Date().toISOString(), pid: exitedPid(), processStartedAt: 12345 }),
      );

      await expect(
        managedDownload({
          basePath,
          bucket: "updates",
          fileName: "installer.bin",
          payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: fixture.url },
        }),
      ).rejects.toMatchObject({ code: MANAGED_DOWNLOAD_ERROR_CODES.TARGET_LOCKED });
    } finally {
      await fixture.close();
    }
  });

  it("treats a lock with an unparseable processStartedAt string as unknown (parseTimeMs's NaN branch) and falls back to createdAt", async () => {
    const body = "unparseable-date payload";
    const fixture = await startFixture(body);
    const root = tmpRoot("unparseable-date");
    const basePath = join(root, "downloads");
    try {
      await inspectManagedDownload({ basePath, bucket: "updates", fileName: "installer.bin" });
      // pid belongs to *this* process, but with garbage-string processStartedAt
      // and a createdAt that clearly predates this process's real start — the
      // pid-reuse fallback (createdAt-based) must still correctly detect a
      // reused pid rather than crash on the unparseable date.
      writeFileSync(
        lockPath(basePath, "updates", "installer.bin"),
        JSON.stringify({
          createdAt: new Date(Date.now() - (process.uptime() + 120) * 1000).toISOString(),
          pid: process.pid,
          processStartedAt: "not-a-real-date",
        }),
      );

      const result = await managedDownload({
        basePath,
        bucket: "updates",
        fileName: "installer.bin",
        payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: fixture.url },
      });
      expect(readFileSync(result.path, "utf8")).toBe(body);
    } finally {
      await fixture.close();
    }
  });

  it("treats a lock with a valid, current processStartedAt as belonging to this process (lockBelongsToCurrentProcess's ownerStartedAtMs branch) and quick-fails", async () => {
    const body = "own-process-lock payload";
    const fixture = await startFixture(body);
    const root = tmpRoot("own-process-lock");
    const basePath = join(root, "downloads");
    try {
      await inspectManagedDownload({ basePath, bucket: "updates", fileName: "installer.bin" });
      writeFileSync(
        lockPath(basePath, "updates", "installer.bin"),
        JSON.stringify({
          createdAt: new Date().toISOString(),
          pid: process.pid,
          processStartedAt: new Date().toISOString(),
        }),
      );

      await expect(
        managedDownload({
          basePath,
          bucket: "updates",
          fileName: "installer.bin",
          payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: fixture.url },
        }),
      ).rejects.toMatchObject({ code: MANAGED_DOWNLOAD_ERROR_CODES.TARGET_LOCKED });
      expect(fixture.requests).toHaveLength(0);
    } finally {
      await fixture.close();
    }
  });

  it("refuses (rather than silently succeeding) when outputPath is itself an existing directory (statFileSize's isFile guard)", async () => {
    // statFileSize(outputPath) sees a directory and — same as ENOENT — reports
    // it as "no existing output" (entry.isFile() is false), so
    // downloadCopyAndClear takes the fresh-copy branch and atomicCopyFile
    // itself has to refuse to clobber the directory.
    const body = "output-path-is-directory payload";
    const fixture = await startFixture(body);
    const root = tmpRoot("output-is-directory");
    const outputPath = join(root, "out", "artifact.bin");
    mkdirSync(outputPath, { recursive: true });
    try {
      await expect(
        downloadCopyAndClear({
          basePath: join(root, "downloads"),
          bucket: "artifacts",
          fileName: "payload.bin",
          outputPath,
          payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: fixture.url },
        }),
      ).rejects.toThrow();
    } finally {
      await fixture.close();
    }
  });

  it("restarts when the saved partial is a genuinely empty (0-byte) file", async () => {
    const body = "zero-byte-partial payload";
    const fixture = await startFixture(body, { range: true });
    const root = tmpRoot("zero-byte-partial");
    const basePath = join(root, "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    try {
      await inspectManagedDownload({ basePath, bucket, fileName });
      const checksum = { algorithm: "sha256" as const, value: sha256(body) };
      writeFileSync(partialPathFor(basePath, bucket, fileName), Buffer.alloc(0));
      writeManifestFile(basePath, bucket, fileName, { checksum, state: "partial", url: fixture.url });

      const result = await managedDownload({ basePath, bucket, fileName, payload: { checksum, url: fixture.url } });
      expect(result.resumed).toBe(false);
      expect(readFileSync(result.path, "utf8")).toBe(body);
    } finally {
      await fixture.close();
    }
  });

  it("skips the existing-partial progress emission when the partial file vanishes between the resume check and the fetch (emitExistingProgress's null branch)", async () => {
    const body = "vanishing-partial-progress payload, long enough to matter for range math";
    const fixture = await startFixture(body, { range: true });
    const root = tmpRoot("vanish-before-emit");
    const basePath = join(root, "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    try {
      await inspectManagedDownload({ basePath, bucket, fileName });
      const checksum = { algorithm: "sha256" as const, value: sha256(body) };
      const partial = partialPathFor(basePath, bucket, fileName);
      const partialPrefix = Buffer.from(body).subarray(0, 6);
      writeFileSync(partial, partialPrefix);
      writeManifestFile(basePath, bucket, fileName, {
        checksum,
        state: "partial",
        url: fixture.url,
        validators: { etag: '"fixture-etag"' },
      });

      const progress: ManagedDownloadProgress[] = [];
      // A deterministic stand-in for the real network race: tryResumeDownload's
      // own (pre-fetch) statFileSize call on the partial must see the real
      // file, but the *second* stat — the one inside emitExistingProgress,
      // called after the fetch — must observe it as gone, without actually
      // deleting the real bytes (which would corrupt the eventual download).
      const fsPromises = await import("node:fs/promises");
      const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
      let statCallsForPartial = 0;
      vi.mocked(fsPromises.stat).mockImplementation(async (p, opts) => {
        if (p === partial) {
          statCallsForPartial += 1;
          // Call 1 is `pruneManagedDownloads`'s own housekeeping stat of
          // every `.partial` entry (runs unconditionally at the top of every
          // `runManagedDownload`); call 2 is `tryResumeDownload`'s own
          // pre-fetch check (must see the real file); call 3 is the one
          // inside `emitExistingProgress`, after the fetch — that's the one
          // this test targets.
          if (statCallsForPartial === 3) {
            const err = new Error("ENOENT: no such file or directory, stat") as NodeJS.ErrnoException;
            err.code = "ENOENT";
            throw err;
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (actual.stat as any)(p, opts);
      });

      const result = await managedDownload({
        basePath,
        bucket,
        fileName,
        payload: { checksum, url: fixture.url },
        onProgress: (p) => progress.push(p),
      });

      expect(result.resumed).toBe(true);
      expect(readFileSync(result.path, "utf8")).toBe(body);
    } finally {
      vi.mocked((await import("node:fs/promises")).stat).mockImplementation(
        (await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")).stat,
      );
      await fixture.close();
    }
  });

  it("omits totalBytes from progress when the upstream response has no content-length header (contentLength's null branch)", async () => {
    const body = "no-content-length payload, long enough to matter";
    const root = tmpRoot("no-content-length");
    const basePath = join(root, "downloads");
    const progress: ManagedDownloadProgress[] = [];
    const fetchImpl = (async () =>
      new Response(body, { status: 200, headers: { "content-type": "application/octet-stream" } })) as typeof fetch;

    const result = await managedDownload({
      basePath,
      bucket: "updates",
      fileName: "installer.bin",
      fetch: fetchImpl,
      payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: "https://example.invalid/x.bin" },
      onProgress: (p) => progress.push(p),
    });

    expect(readFileSync(result.path, "utf8")).toBe(body);
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.every((p) => p.totalBytes === undefined)).toBe(true);
  });

  it("treats a non-numeric content-length header as absent (contentLength's Number.isFinite guard)", async () => {
    const body = "malformed-content-length payload";
    const root = tmpRoot("malformed-content-length");
    const basePath = join(root, "downloads");
    const fetchImpl = (async () =>
      new Response(body, {
        status: 200,
        headers: { "content-length": "not-a-number", "content-type": "application/octet-stream" },
      })) as typeof fetch;

    const result = await managedDownload({
      basePath,
      bucket: "updates",
      fileName: "installer.bin",
      fetch: fetchImpl,
      payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: "https://example.invalid/x.bin" },
    });
    expect(readFileSync(result.path, "utf8")).toBe(body);
  });

  it("saves only a last-modified validator when no etag is present (validatorsFromResponse's etag-absent branch)", async () => {
    const body = "last-modified-only payload, long enough to resume from partway";
    const root = tmpRoot("last-modified-only");
    const basePath = join(root, "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    const payload = Buffer.from(body);
    // First (real, no-Range) call fails mid-stream after 8 bytes, saving a
    // last-modified-only manifest (no etag in the response at all). Every
    // subsequent call is identified by its Range header, whatever attempt
    // number it lands on.
    let sawFirstAttempt = false;
    const combinedFetch = (async (_input: unknown, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (headers.Range == null && !sawFirstAttempt) {
        sawFirstAttempt = true;
        writeFileSync(partialPathFor(basePath, bucket, fileName), payload.subarray(0, 8));
        throw new Error("simulated reset after first chunk");
      }
      // The resume — its manifest should have saved last-modified (no
      // etag), and the response's own last-modified must match it exactly
      // for the resume to proceed instead of restarting.
      const chunk = payload.subarray(8);
      return new Response(chunk, {
        status: 206,
        headers: {
          "content-length": String(chunk.byteLength),
          "content-range": `bytes 8-${payload.byteLength - 1}/${payload.byteLength}`,
          "last-modified": "Wed, 01 Jan 2025 00:00:00 GMT",
        },
      });
    }) as typeof fetch;

    const result = await managedDownload({
      basePath,
      bucket,
      fileName,
      fetch: combinedFetch,
      payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: "https://example.invalid/x.bin" },
    });
    expect(result.resumed).toBe(true);
    expect(readFileSync(result.path, "utf8")).toBe(body);
  });

  it("restarts a resume when the server's last-modified no longer matches the saved manifest (validatorsConflict's lastModified branch)", async () => {
    const body = "last-modified-conflict payload, long enough to matter for the range math";
    const root = tmpRoot("last-modified-conflict");
    const basePath = join(root, "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    const payload = Buffer.from(body);
    const partialPrefix = payload.subarray(0, 8);
    await inspectManagedDownload({ basePath, bucket, fileName });
    const checksum = { algorithm: "sha256" as const, value: sha256(body) };
    writeFileSync(partialPathFor(basePath, bucket, fileName), partialPrefix);
    writeManifestFile(basePath, bucket, fileName, {
      checksum,
      state: "partial",
      url: "https://example.invalid/x.bin",
      validators: { lastModified: "Wed, 01 Jan 2025 00:00:00 GMT" },
    });

    // The resume attempt (identified by its Range header) gets a
    // syntactically valid 206 whose last-modified genuinely conflicts with
    // the saved manifest (and — deliberately — no etag at all, so
    // validatorsConflict's etag-fallback branch is exercised on the way);
    // the full-download retry that follows the forced restart gets the
    // correct complete body.
    const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (headers.Range != null) {
        return new Response(payload.subarray(8), {
          status: 206,
          headers: {
            "content-length": String(payload.byteLength - 8),
            "content-range": `bytes 8-${payload.byteLength - 1}/${payload.byteLength}`,
            "last-modified": "Thu, 02 Jan 2025 00:00:00 GMT", // conflicts with saved manifest
          },
        });
      }
      return new Response(payload, { status: 200, headers: { "content-length": String(payload.byteLength) } });
    }) as typeof fetch;

    const result = await managedDownload({
      basePath,
      bucket,
      fileName,
      fetch: fetchImpl,
      payload: { checksum, url: "https://example.invalid/x.bin" },
    });
    expect(result.resumed).toBe(false);
    expect(readFileSync(result.path, "utf8")).toBe(body);
  });

  it("restarts a resume when the 206 response is missing a content-range header entirely (parseContentRange's null branch)", async () => {
    const body = "missing-content-range payload, long enough to resume from";
    const root = tmpRoot("missing-content-range");
    const basePath = join(root, "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    const payload = Buffer.from(body);
    const partialPrefix = payload.subarray(0, 8);
    await inspectManagedDownload({ basePath, bucket, fileName });
    const checksum = { algorithm: "sha256" as const, value: sha256(body) };
    writeFileSync(partialPathFor(basePath, bucket, fileName), partialPrefix);
    writeManifestFile(basePath, bucket, fileName, { checksum, state: "partial", url: "https://example.invalid/x.bin" });

    // Serves a malformed 206 (missing content-range) to the resume attempt
    // (identified by its Range header), and the correct full body to the
    // full-download retry that follows the forced restart.
    const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (headers.Range != null) {
        return new Response(payload.subarray(8), { status: 206, headers: { "content-length": String(payload.byteLength - 8) } });
      }
      return new Response(payload, { status: 200, headers: { "content-length": String(payload.byteLength) } });
    }) as typeof fetch;

    const result = await managedDownload({
      basePath,
      bucket,
      fileName,
      fetch: fetchImpl,
      payload: { checksum, url: "https://example.invalid/x.bin" },
    });
    expect(result.resumed).toBe(false);
    expect(readFileSync(result.path, "utf8")).toBe(body);
  });

  it("restarts a resume when the content-range header doesn't match the expected format (parseContentRange's regex-mismatch branch)", async () => {
    const body = "garbled-content-range payload, long enough to resume from";
    const root = tmpRoot("garbled-content-range");
    const basePath = join(root, "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    const payload = Buffer.from(body);
    const partialPrefix = payload.subarray(0, 8);
    await inspectManagedDownload({ basePath, bucket, fileName });
    const checksum = { algorithm: "sha256" as const, value: sha256(body) };
    writeFileSync(partialPathFor(basePath, bucket, fileName), partialPrefix);
    writeManifestFile(basePath, bucket, fileName, { checksum, state: "partial", url: "https://example.invalid/x.bin" });

    const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (headers.Range != null) {
        return new Response(payload.subarray(8), {
          status: 206,
          headers: { "content-length": String(payload.byteLength - 8), "content-range": "not-a-valid-content-range" },
        });
      }
      return new Response(payload, { status: 200, headers: { "content-length": String(payload.byteLength) } });
    }) as typeof fetch;

    const result = await managedDownload({
      basePath,
      bucket,
      fileName,
      fetch: fetchImpl,
      payload: { checksum, url: "https://example.invalid/x.bin" },
    });
    expect(result.resumed).toBe(false);
    expect(readFileSync(result.path, "utf8")).toBe(body);
  });

  it("resumes with an unknown total (content-range's \"*\") falling back to the saved manifest's totalBytes (parseContentRange's \"*\" branch + the range.totalBytes ?? manifest.totalBytes fallback)", async () => {
    const body = "unknown-total-with-manifest-total payload, long enough to resume from partway";
    const root = tmpRoot("unknown-total-manifest-total");
    const basePath = join(root, "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    const payload = Buffer.from(body);
    const partialPrefix = payload.subarray(0, 8);
    await inspectManagedDownload({ basePath, bucket, fileName });
    const checksum = { algorithm: "sha256" as const, value: sha256(body) };
    writeFileSync(partialPathFor(basePath, bucket, fileName), partialPrefix);
    writeManifestFile(basePath, bucket, fileName, {
      checksum,
      state: "partial",
      totalBytes: payload.byteLength,
      url: "https://example.invalid/x.bin",
    });

    const fetchImpl = (async () =>
      new Response(payload.subarray(8), {
        status: 206,
        headers: {
          "content-length": String(payload.byteLength - 8),
          "content-range": `bytes 8-${payload.byteLength - 1}/*`,
        },
      })) as typeof fetch;

    const progress: ManagedDownloadProgress[] = [];
    const result = await managedDownload({
      basePath,
      bucket,
      fileName,
      fetch: fetchImpl,
      payload: { checksum, url: "https://example.invalid/x.bin" },
      onProgress: (p) => progress.push(p),
    });
    expect(result.resumed).toBe(true);
    expect(readFileSync(result.path, "utf8")).toBe(body);
    expect(progress.some((p) => p.totalBytes === payload.byteLength)).toBe(true);
  });

  it("resumes with an unknown total and no saved manifest total, falling back to arithmetic (the manifest.totalBytes ?? arithmetic fallback)", async () => {
    const body = "unknown-total-no-manifest-total payload, long enough to resume from partway";
    const root = tmpRoot("unknown-total-no-manifest-total");
    const basePath = join(root, "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    const payload = Buffer.from(body);
    const partialPrefix = payload.subarray(0, 8);
    await inspectManagedDownload({ basePath, bucket, fileName });
    const checksum = { algorithm: "sha256" as const, value: sha256(body) };
    writeFileSync(partialPathFor(basePath, bucket, fileName), partialPrefix);
    // No `totalBytes` on the saved manifest this time.
    writeManifestFile(basePath, bucket, fileName, { checksum, state: "partial", url: "https://example.invalid/x.bin" });

    const remaining = payload.subarray(8);
    const fetchImpl = (async () =>
      new Response(remaining, {
        status: 206,
        headers: {
          "content-length": String(remaining.byteLength),
          "content-range": `bytes 8-${payload.byteLength - 1}/*`,
        },
      })) as typeof fetch;

    const progress: ManagedDownloadProgress[] = [];
    const result = await managedDownload({
      basePath,
      bucket,
      fileName,
      fetch: fetchImpl,
      payload: { checksum, url: "https://example.invalid/x.bin" },
      onProgress: (p) => progress.push(p),
    });
    expect(result.resumed).toBe(true);
    expect(readFileSync(result.path, "utf8")).toBe(body);
    // arithmetic fallback: partialBytes (8) + contentLength(response) (remaining.byteLength)
    expect(progress.some((p) => p.totalBytes === 8 + remaining.byteLength)).toBe(true);
  });

  it("resumes with an unknown total, no manifest total, and no content-length either, falling all the way down to partialBytes + 0", async () => {
    const body = "unknown-total-no-manifest-no-content-length payload, resumed from partway";
    const root = tmpRoot("unknown-total-no-content-length");
    const basePath = join(root, "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    const payload = Buffer.from(body);
    const partialPrefix = payload.subarray(0, 8);
    await inspectManagedDownload({ basePath, bucket, fileName });
    const checksum = { algorithm: "sha256" as const, value: sha256(body) };
    writeFileSync(partialPathFor(basePath, bucket, fileName), partialPrefix);
    writeManifestFile(basePath, bucket, fileName, { checksum, state: "partial", url: "https://example.invalid/x.bin" });

    const remaining = payload.subarray(8);
    const fetchImpl = (async () =>
      new Response(remaining, {
        status: 206,
        // Deliberately no content-length header at all this time.
        headers: { "content-range": `bytes 8-${payload.byteLength - 1}/*` },
      })) as typeof fetch;

    const progress: ManagedDownloadProgress[] = [];
    const result = await managedDownload({
      basePath,
      bucket,
      fileName,
      fetch: fetchImpl,
      payload: { checksum, url: "https://example.invalid/x.bin" },
      onProgress: (p) => progress.push(p),
    });
    expect(result.resumed).toBe(true);
    expect(readFileSync(result.path, "utf8")).toBe(body);
    // full arithmetic fallback: partialBytes (8) + contentLength(response)??0 (0)
    expect(progress.some((p) => p.totalBytes === 8)).toBe(true);
  });

  it("restarts when the content-range start/end are inverted (parseContentRange's end<start guard)", async () => {
    const body = "inverted-range payload, long enough to resume from";
    const root = tmpRoot("inverted-range");
    const basePath = join(root, "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    const payload = Buffer.from(body);
    const partialPrefix = payload.subarray(0, 8);
    await inspectManagedDownload({ basePath, bucket, fileName });
    const checksum = { algorithm: "sha256" as const, value: sha256(body) };
    writeFileSync(partialPathFor(basePath, bucket, fileName), partialPrefix);
    writeManifestFile(basePath, bucket, fileName, { checksum, state: "partial", url: "https://example.invalid/x.bin" });

    const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (headers.Range != null) {
        return new Response(payload.subarray(8), {
          status: 206,
          headers: { "content-length": String(payload.byteLength - 8), "content-range": "bytes 8-3/20" },
        });
      }
      return new Response(payload, { status: 200, headers: { "content-length": String(payload.byteLength) } });
    }) as typeof fetch;

    const result = await managedDownload({
      basePath,
      bucket,
      fileName,
      fetch: fetchImpl,
      payload: { checksum, url: "https://example.invalid/x.bin" },
    });
    expect(result.resumed).toBe(false);
    expect(readFileSync(result.path, "utf8")).toBe(body);
  });

  it("restarts when the content-range total is smaller than its own end (parseContentRange's totalBytes<=end guard)", async () => {
    const body = "impossible-total payload, long enough to resume from";
    const root = tmpRoot("impossible-total");
    const basePath = join(root, "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    const payload = Buffer.from(body);
    const partialPrefix = payload.subarray(0, 8);
    await inspectManagedDownload({ basePath, bucket, fileName });
    const checksum = { algorithm: "sha256" as const, value: sha256(body) };
    writeFileSync(partialPathFor(basePath, bucket, fileName), partialPrefix);
    writeManifestFile(basePath, bucket, fileName, { checksum, state: "partial", url: "https://example.invalid/x.bin" });

    const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (headers.Range != null) {
        return new Response(payload.subarray(8), {
          status: 206,
          headers: {
            "content-length": String(payload.byteLength - 8),
            "content-range": `bytes 8-${payload.byteLength - 1}/5`,
          },
        });
      }
      return new Response(payload, { status: 200, headers: { "content-length": String(payload.byteLength) } });
    }) as typeof fetch;

    const result = await managedDownload({
      basePath,
      bucket,
      fileName,
      fetch: fetchImpl,
      payload: { checksum, url: "https://example.invalid/x.bin" },
    });
    expect(result.resumed).toBe(false);
    expect(readFileSync(result.path, "utf8")).toBe(body);
  });

  it("fails cleanly when the download response has no body at all (writeResponseBodyToPartial's null-body guard)", async () => {
    const root = tmpRoot("null-body");
    const basePath = join(root, "downloads");
    const fetchImpl = (async () =>
      new Response(null, { status: 200, headers: { "content-length": "0" } })) as typeof fetch;

    await expect(
      managedDownload({
        basePath,
        bucket: "updates",
        fileName: "installer.bin",
        fetch: fetchImpl,
        maxAttempts: 1,
        payload: { checksum: { algorithm: "sha256", value: "0".repeat(64) }, url: "https://example.invalid/x.bin" },
      }),
    ).rejects.toMatchObject({
      code: MANAGED_DOWNLOAD_ERROR_CODES.NETWORK_EXHAUSTED,
      message: expect.stringContaining("did not include a body"),
    });
  });

  it("threads custom request headers through to the download fetch (downloadFromZero's requestHeaders-present branch)", async () => {
    const body = "custom-headers payload";
    const root = tmpRoot("custom-headers");
    const basePath = join(root, "downloads");
    const seenHeaders: Record<string, string>[] = [];
    const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
      seenHeaders.push((init?.headers ?? {}) as Record<string, string>);
      return new Response(body, { status: 200, headers: { "content-length": String(body.length) } });
    }) as typeof fetch;

    const result = await managedDownload({
      basePath,
      bucket: "updates",
      fileName: "installer.bin",
      fetch: fetchImpl,
      payload: {
        checksum: { algorithm: "sha256", value: sha256(body) },
        headers: { Authorization: "Bearer test-token" },
        url: "https://example.invalid/x.bin",
      },
    });
    expect(readFileSync(result.path, "utf8")).toBe(body);
    expect(seenHeaders[0]?.Authorization).toBe("Bearer test-token");
  });

  it("exhausts retries when the upstream responds with a non-OK HTTP status (downloadFromZero's response.ok guard)", async () => {
    const root = tmpRoot("non-ok-response");
    const basePath = join(root, "downloads");
    const fetchImpl = (async () => new Response("server error", { status: 500 })) as typeof fetch;

    await expect(
      managedDownload({
        basePath,
        bucket: "updates",
        fileName: "installer.bin",
        fetch: fetchImpl,
        maxAttempts: 1,
        payload: { checksum: { algorithm: "sha256", value: "0".repeat(64) }, url: "https://example.invalid/x.bin" },
      }),
    ).rejects.toMatchObject({
      code: MANAGED_DOWNLOAD_ERROR_CODES.NETWORK_EXHAUSTED,
      message: expect.stringContaining("HTTP 500"),
    });
  });

  it("resets when leftover artifacts (a final file) exist with no manifest at all (loadReusableState's manifest==null-but-artifacts-exist branch)", async () => {
    const body = "orphaned-final payload";
    const fixture = await startFixture(body);
    const root = tmpRoot("orphaned-final");
    const basePath = join(root, "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    try {
      await inspectManagedDownload({ basePath, bucket, fileName });
      mkdirSync(join(basePath, bucket), { recursive: true });
      writeFileSync(join(basePath, bucket, fileName), "leftover bytes with no manifest to explain them");

      const result = await managedDownload({
        basePath,
        bucket,
        fileName,
        payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: fixture.url },
      });
      expect(readFileSync(result.path, "utf8")).toBe(body);
    } finally {
      await fixture.close();
    }
  });

  it("resets when a manifest says complete but the final file is actually missing (loadReusableState's !finalExists branch)", async () => {
    const body = "manifest-says-complete-but-missing payload";
    const fixture = await startFixture(body);
    const root = tmpRoot("complete-but-missing");
    const basePath = join(root, "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    try {
      await inspectManagedDownload({ basePath, bucket, fileName });
      writeManifestFile(basePath, bucket, fileName, {
        checksum: { algorithm: "sha256", value: sha256(body) },
        state: "complete",
        url: fixture.url,
      });
      // Deliberately no final file on disk at all.

      const result = await managedDownload({
        basePath,
        bucket,
        fileName,
        payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: fixture.url },
      });
      expect(readFileSync(result.path, "utf8")).toBe(body);
    } finally {
      await fixture.close();
    }
  });

  it("resets when a complete file's hash matches but its stat mysteriously fails right after (loadReusableState's bytes==null branch, mocked stat)", async () => {
    const body = "complete-hash-ok-stat-fails payload";
    const fixture = await startFixture(body);
    const root = tmpRoot("complete-hash-ok-stat-fails");
    const basePath = join(root, "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    try {
      const first = await managedDownload({
        basePath,
        bucket,
        fileName,
        payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: fixture.url },
      });
      expect(first.reusedComplete).toBe(false);

      const fsPromises = await import("node:fs/promises");
      const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
      const finalPath = join(basePath, bucket, fileName);
      let finalPathStatCalls = 0;
      vi.mocked(fsPromises.stat).mockImplementation(async (p, opts) => {
        if (p === finalPath) {
          finalPathStatCalls += 1;
          // Call 1 is `pruneManagedDownloads`'s own housekeeping stat of
          // every bucket entry (runs unconditionally at the top of every
          // `runManagedDownload`, and the completed file from the first
          // download is already sitting there); call 2 is
          // `loadReusableState`'s own post-hash-match check — that's the one
          // this test targets. Later calls, after the forced reset genuinely
          // redownloads, must behave normally so the redownload itself can
          // complete and be observed.
          if (finalPathStatCalls === 2) {
            const err = new Error("ENOENT: no such file or directory, stat") as NodeJS.ErrnoException;
            err.code = "ENOENT";
            throw err;
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (actual.stat as any)(p, opts);
      });

      try {
        const second = await managedDownload({
          basePath,
          bucket,
          fileName,
          payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: fixture.url },
        });
        // Had to reset and redownload, since the (mocked) stat failure made
        // the otherwise-valid complete file look unusable.
        expect(second.reusedComplete).toBe(false);
        expect(readFileSync(second.path, "utf8")).toBe(body);
      } finally {
        vi.mocked(fsPromises.stat).mockImplementation(actual.stat);
      }
    } finally {
      await fixture.close();
    }
  });

  it("keeps resetting (and gives up) when the manifest reload after cleanup is still unreadable (runManagedDownload's repeated-reset guard, mocked readFile, root-independent)", async () => {
    // Same intent as this file's chmod-based, isRoot-skipped
    // "gives up when the download state keeps resetting..." test above, but
    // reached without relying on OS permission enforcement: readFile is
    // mocked to always return corrupt JSON for this exact manifest path, so
    // *every* read looks "invalid" — including the one right after
    // resetOwnedBase has genuinely wiped and recreated the base — forcing
    // the outer "kept resetting" guard to fire for real.
    const root = tmpRoot("perma-reset-mocked");
    const basePath = join(root, "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    await inspectManagedDownload({ basePath, bucket, fileName });
    const manifestPath = manifestPathFor(basePath, bucket, fileName);
    writeFileSync(manifestPath, "{not valid json");

    const fsPromises = await import("node:fs/promises");
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(fsPromises.readFile).mockImplementation(async (p, options) => {
      if (p === manifestPath) return "{always still not valid json";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (actual.readFile as any)(p, options);
    });

    try {
      await expect(
        managedDownload({
          basePath,
          bucket,
          fileName,
          payload: { checksum: { algorithm: "sha256", value: sha256("irrelevant") }, url: "https://example.invalid/artifact.bin" },
        }),
      ).rejects.toMatchObject({ code: MANAGED_DOWNLOAD_ERROR_CODES.STORE_CORRUPT });
    } finally {
      vi.mocked(fsPromises.readFile).mockImplementation(actual.readFile);
    }
  });

  it("refuses to reset a base whose ownership sentinel goes invalid between validation and the reset itself (resetOwnedBase's own re-check, mocked readFile)", async () => {
    // A real (if narrow) TOCTOU: `ensureManagedBase` already validated the
    // sentinel earlier in this same call, but `resetOwnedBase` re-checks it
    // independently right before wiping the base — defense against a
    // concurrent writer corrupting the sentinel in between. Reached by
    // making only the *third* read of the sentinel file (resetOwnedBase's
    // own, after ensureManagedBase's own two prior reads — one direct, one
    // via its internal `pruneManagedDownloads` call) return a non-sentinel
    // shape, while every earlier read sees the real, valid file.
    const root = tmpRoot("sentinel-invalid-mid-reset");
    const basePath = join(root, "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    await inspectManagedDownload({ basePath, bucket, fileName });
    writeFileSync(manifestPathFor(basePath, bucket, fileName), "{not valid json");
    const sentinelPath = join(basePath, ".jini-download-root.json");

    const fsPromises = await import("node:fs/promises");
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let sentinelReadCalls = 0;
    vi.mocked(fsPromises.readFile).mockImplementation(async (p, options) => {
      if (p === sentinelPath) {
        sentinelReadCalls += 1;
        if (sentinelReadCalls === 3) return JSON.stringify({ not: "a sentinel anymore" });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (actual.readFile as any)(p, options);
    });

    try {
      await expect(
        managedDownload({
          basePath,
          bucket,
          fileName,
          payload: { checksum: { algorithm: "sha256", value: sha256("irrelevant") }, url: "https://example.invalid/artifact.bin" },
        }),
      ).rejects.toMatchObject({ code: MANAGED_DOWNLOAD_ERROR_CODES.STORE_NOT_OWNED });
    } finally {
      vi.mocked(fsPromises.readFile).mockImplementation(actual.readFile);
    }
  });

  it("reuses a result found immediately on the post-reset reload (runManagedDownload's second state.result!=null branch, mocked mkdir)", async () => {
    // A genuine (if narrow) race: after `resetOwnedBase` wipes the base, a
    // *different* process finishes writing a valid, matching complete
    // download into that exact window before this process's own reload
    // runs. `mkdir(basePath)` is the first call `ensureManagedBase` makes on
    // that post-reset reload (see download.ts's `runManagedDownload`), so
    // planting the other process's finished artifact as a side effect of
    // that specific call reproduces the race deterministically instead of
    // depending on real inter-process timing.
    const body = "concurrent-writer-wins-the-reset-race payload";
    const root = tmpRoot("post-reset-immediate-result");
    const basePath = join(root, "downloads");
    const bucket = "updates";
    const fileName = "installer.bin";
    const checksum = { algorithm: "sha256" as const, value: sha256(body) };
    await inspectManagedDownload({ basePath, bucket, fileName });
    // A corrupt manifest forces the first loadReusableState to report reset:true.
    writeFileSync(manifestPathFor(basePath, bucket, fileName), "{not valid json");

    const fsPromises = await import("node:fs/promises");
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let mkdirBasePathCalls = 0;
    vi.mocked(fsPromises.mkdir).mockImplementation(async (p, opts) => {
      if (p === basePath) {
        mkdirBasePathCalls += 1;
        // Call 1: the initial `ensureManagedBase`. Call 2: its own internal
        // `pruneManagedDownloads` call. Call 3: the post-reset reload this
        // test targets.
        if (mkdirBasePathCalls === 3) {
          await actual.mkdir(p as string, opts as never);
          mkdirSync(join(basePath, bucket), { recursive: true });
          mkdirSync(join(basePath, ".state"), { recursive: true });
          writeFileSync(join(basePath, bucket, fileName), body);
          writeManifestFile(basePath, bucket, fileName, {
            checksum,
            state: "complete",
            url: "https://example.invalid/artifact.bin",
          });
          return;
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (actual.mkdir as any)(p, opts);
    });

    try {
      const result = await managedDownload({
        basePath,
        bucket,
        fileName,
        payload: { checksum, url: "https://example.invalid/artifact.bin" },
      });
      expect(result.reusedComplete).toBe(true);
      expect(readFileSync(result.path, "utf8")).toBe(body);
    } finally {
      vi.mocked(fsPromises.mkdir).mockImplementation(actual.mkdir);
    }
  });

  it("cleans up an orphaned final file after a re-promotion race deletes it (runManagedDownload's post-promotion bytes==null guard, mocked rename)", async () => {
    const body = "vanishes-after-promotion payload";
    const root = tmpRoot("vanishes-after-promotion");
    const basePath = join(root, "downloads");
    const fetchImpl = (async () =>
      new Response(body, { status: 200, headers: { "content-length": String(body.length) } })) as typeof fetch;

    const fsPromises = await import("node:fs/promises");
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const finalPath = join(basePath, "updates", "installer.bin");
    vi.mocked(fsPromises.rename).mockImplementation(async (from, to) => {
      if (to === finalPath) {
        await actual.rename(from as string, to as string);
        // Simulate a concurrent cleanup racing the promotion: the file is
        // renamed into place successfully, then disappears before this
        // function's own follow-up `statFileSize` call observes it.
        await actual.rm(to as string, { force: true });
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (actual.rename as any)(from, to);
    });

    await expect(
      managedDownload({
        basePath,
        bucket: "updates",
        fileName: "installer.bin",
        fetch: fetchImpl,
        payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: "https://example.invalid/x.bin" },
      }),
    ).rejects.toMatchObject({
      code: MANAGED_DOWNLOAD_ERROR_CODES.STORE_CORRUPT,
      message: expect.stringContaining("missing after promotion"),
    });
  });

  it("reports a checksum mismatch when a freshly-copied output doesn't match (downloadCopyAndClear's post-copy digest check, mocked copyFile)", async () => {
    const body = "fresh-copy-checksum-mismatch payload";
    const fixture = await startFixture(body);
    const root = tmpRoot("fresh-copy-mismatch");
    const outputPath = join(root, "out", "artifact.bin");
    try {
      // The download itself is genuinely correct; `atomicCopyFile` (in
      // ../fs.js, sharing this file's `node:fs/promises` mock) is made to
      // corrupt the bytes in transit, so the post-copy digest check has to
      // catch it — a real defense against a corrupting copy, not a
      // hypothetical.
      const fsPromises = await import("node:fs/promises");
      const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
      vi.mocked(fsPromises.copyFile).mockImplementationOnce(async (_source, destination) => {
        await actual.writeFile(destination as string, "corrupted in transit");
      });

      await expect(
        downloadCopyAndClear({
          basePath: join(root, "downloads"),
          bucket: "artifacts",
          fileName: "payload.bin",
          outputPath,
          payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: fixture.url },
        }),
      ).rejects.toMatchObject({ code: MANAGED_DOWNLOAD_ERROR_CODES.CHECKSUM_MISMATCH });
    } finally {
      await fixture.close();
    }
  });

  it("still returns cleanup:\"removed\" with a warning when the post-copy clear itself fails (downloadCopyAndClear's cleanupWarning branch, mocked lstat)", async () => {
    // `removeManagedDownload`'s own path removals are all best-effort (never
    // throw) — the only way `requestClearAfterCopy`'s cleanup can genuinely
    // fail (and so the only real way to reach downloadCopyAndClear's
    // cleanupWarning branch) is if `removeManagedDownload`'s own
    // `ensureManagedBase` re-validation throws. Reached here by making the
    // *second* `lstat(basePath)` call — the one inside that post-copy
    // `removeManagedDownload`'s `ensureManagedBase`, not the one from the
    // download itself — report the base as no longer a plain directory.
    const body = "cleanup-fails-after-copy payload";
    const fixture = await startFixture(body);
    const root = tmpRoot("cleanup-fails-after-copy");
    const basePath = join(root, "downloads");
    const outputPath = join(root, "out", "artifact.bin");
    try {
      const fsPromises = await import("node:fs/promises");
      const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
      let lstatCalls = 0;
      vi.mocked(fsPromises.lstat).mockImplementation(async (p, opts) => {
        if (p === basePath) {
          lstatCalls += 1;
          // `ensureManagedBase` (which does this lstat) is called twice per
          // real download already — once directly by `runManagedDownload`,
          // once again via its own internal `pruneManagedDownloads` call —
          // so the third call is the first one that belongs to this test's
          // post-copy `removeManagedDownload` cleanup.
          if (lstatCalls === 3) {
            const err = new Error("EACCES: permission denied, lstat") as NodeJS.ErrnoException;
            err.code = "EACCES";
            throw err;
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (actual.lstat as any)(p, opts);
      });

      try {
        const result = await downloadCopyAndClear({
          basePath,
          bucket: "artifacts",
          fileName: "payload.bin",
          outputPath,
          payload: { checksum: { algorithm: "sha256", value: sha256(body) }, url: fixture.url },
        });
        expect(result.cleanup).toBe("removed");
        expect(result.cleanupWarning).toBeTruthy();
      } finally {
        vi.mocked(fsPromises.lstat).mockImplementation(actual.lstat);
      }
    } finally {
      await fixture.close();
    }
  });
});
