import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import * as root from "../index.js";
import * as secrets from "../redaction/secrets-only.js";
import * as observability from "../observability/index.js";
import * as observabilityNode from "../observability/node.js";
import * as evidence from "../web-evidence/index.js";
import * as browser from "../web-evidence/playwright-browser.js";
import * as dns from "../domain-dns/index.js";
import * as serverLogs from "../server-logs/read-server-logs.js";

vi.mock("parse5", () => {
  throw new Error("The existing diagnostics entries must not load the page-body parser leaf.");
});

const packageRoot = new URL("../../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("package.json", packageRoot), "utf8"));
const entries = {
  ".": ["index", "node"],
  "./redaction/secrets-only": ["redaction/secrets-only", "universal"],
  "./observability": ["observability/index", "universal"],
  "./observability/node": ["observability/node", "node"],
  "./web-evidence": ["web-evidence/index", "universal"],
  "./web-evidence/page-body": ["web-evidence/page-body", "node"],
  "./web-evidence/playwright": ["web-evidence/playwright-browser", "node"],
  "./domain-dns": ["domain-dns/index", "node"],
  "./local-text": ["local-text", "node"],
  "./console-tee": ["console-tee", "node"],
  "./server-logs/read-server-logs": ["server-logs/read-server-logs", "universal"],
} as const;

describe("published diagnostics surface", () => {
  it("keeps the parser leaf outside the existing evidence entry", () => {
    expect(evidence).not.toHaveProperty("readPageBodyOptions");
    expect(evidence).not.toHaveProperty("shapePageBody");
    expect(evidence).not.toHaveProperty("DEFAULT_MAX_BODY_BYTES");
    expect(evidence).not.toHaveProperty("MAX_MAX_BODY_BYTES");
  });

  it.each(Object.entries(entries))("maps %s to its source and runtime", (subpath, [target, runtime]) => {
    expect(manifest.exports[subpath]).toEqual({
      types: `./dist/${target}.d.ts`,
      import: `./dist/${target}.js`,
      default: `./dist/${target}.js`,
    });
    expect(manifest.jini.entries[subpath]).toBe(runtime);
    expect(existsSync(fileURLToPath(new URL(`src/${target}.ts`, packageRoot)))).toBe(true);
  });

  it("keeps each runtime API reachable through its declared barrel", () => {
    const surfaces = [
      [root, ["redactJsonValue", "redactJsonText", "redactText", "collectLogSource", "collectLogSources", "findMacOSCrashReports", "buildManifest", "buildMachineInfo", "diagnosticsFileName", "buildDiagnosticsZip", "buildRunEventLogSources", "buildAgentCliLogSources", "createNodeDiagnosticsPorts"]],
      [secrets, ["redactSecretShapes"]],
      [observability, ["resolveObservabilityConfig", "createHookObservabilityPort", "instrumentStorageKernel", "trackHttpClient", "trackFetch", "describeQueryNode", "errorType"]],
      [observabilityNode, ["createAsyncLocalSpanScope"]],
      [evidence, ["collectPageEvidence", "collectPageStructure", "normalizeSitePath", "verifiedOriginToBaseUrl", "resolveSameOriginUrl", "isSameOriginUrl"]],
      [browser, ["openPlaywrightSiteEvidenceBrowser"]],
      [dns, ["readPublicDomain", "readPublicDnsName", "createDomainDnsChecks"]],
      [serverLogs, ["parseServerLogFilters", "readServerLogs", "ServerLogFilterError"]],
    ] as const;
    for (const [surface, names] of surfaces) {
      for (const name of names) expect(typeof (surface as Record<string, unknown>)[name], name).toBe("function");
    }
    expect(secrets.SECRET_PATTERNS.length).toBeGreaterThan(0);
    expect(dns.DNS_TYPES).toEqual(["A", "AAAA", "CNAME", "MX", "TXT", "NS"]);
  });
});
