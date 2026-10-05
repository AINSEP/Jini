import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as root from "../index.js";
import * as secrets from "../redaction/secrets-only.js";
import * as observability from "../observability/index.js";
import * as observabilityNode from "../observability/node.js";
import * as evidence from "../web-evidence/index.js";
import * as browser from "../web-evidence/playwright-browser.js";
import * as dns from "../domain-dns/index.js";

const packageRoot = new URL("../../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("package.json", packageRoot), "utf8"));
const entries = {
  ".": ["index", "node"],
  "./redaction/secrets-only": ["redaction/secrets-only", "universal"],
  "./observability": ["observability/index", "universal"],
  "./observability/node": ["observability/node", "node"],
  "./web-evidence": ["web-evidence/index", "universal"],
  "./web-evidence/playwright": ["web-evidence/playwright-browser", "node"],
  "./domain-dns": ["domain-dns/index", "node"],
} as const;

describe("published diagnostics surface", () => {
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
      [observability, ["resolveObservabilityConfig", "createNoopObservabilityPort", "createOtelObservabilityPort", "createHookObservabilityPort", "createObservabilityPort", "isNoopObservabilityPort", "instrumentStorageKernel", "trackHttpClient", "describeQueryNode", "errorType", "redactRequestTarget", "outboundTargetAttributes"]],
      [observabilityNode, ["createAsyncLocalSpanScope"]],
      [evidence, ["collectPageEvidence", "collectPageStructure", "normalizeSitePath", "verifiedOriginToBaseUrl", "resolveSameOriginUrl", "isSameOriginUrl"]],
      [browser, ["openPlaywrightSiteEvidenceBrowser"]],
      [dns, ["readPublicDomain", "readPublicDnsName", "createDomainDnsChecks"]],
    ] as const;
    for (const [surface, names] of surfaces) {
      for (const name of names) expect(typeof (surface as Record<string, unknown>)[name], name).toBe("function");
    }
    expect(secrets.SECRET_PATTERNS.length).toBeGreaterThan(0);
    expect(dns.DNS_TYPES).toEqual(["A", "AAAA", "CNAME", "MX", "TXT", "NS"]);
  });
});
