import { verifyAsarAgainstSource, createNodePackagingFilesystem } from "../../packaging/electron/entry.js";
import { expect, test } from "vitest";
import { buildSourceControlProvider, createSourceControlProviderKit, parseSourceControlProvidersFile, pickSourceControlProviderForApi } from "../entry.js";
import { formatDiskArea, evaluateDiskArea } from "../../checks/coverage/index.js";

test("the trusted catalog can own containment while the package default refuses module traversal", () => {
  const raw = JSON.stringify({ schemaVersion: 1, providers: [{ id: "git", label: "Git", apiOrigin: "https://git.example", module: "../fixture.mjs" }] });
  const required = { raw, readExtensions: () => ({ ok: true as const, extensions: {} }) };
  expect(parseSourceControlProvidersFile(required)).toEqual({ ok: false, reason: "providers[0].module must be a relative path ending in .mjs" });
  const parsed = parseSourceControlProvidersFile(required, { modulePath: ({ path }) => !path.startsWith("/") });
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.descriptors[0]!.module).toBe("../fixture.mjs");
});

test("a host's provider refusal message changes output while the package default remains intact", () => {
  const required = { providers: [{ apiOrigin: "https://a.example" }, { apiOrigin: "https://b.example" }], baseUrl: "https://c.example/path", noProviderMessage: "none" };
  expect(pickSourceControlProviderForApi(required)).toEqual({ ok: false, message: "No enabled provider supplies source control for https://c.example." });
  expect(pickSourceControlProviderForApi(required, { missingProviderMessage: ({ origin }) => `Host refused ${origin}` })).toEqual({ ok: false, message: "Host refused https://c.example" });
});

test("the legacy host caller's fetch policy preserves request options without changing the guarded default", async () => {
  const requests: RequestInit[] = [];
  const required = { httpClient: { send: async () => { throw new Error("unexpected guarded call"); } },
    fetch: async (_required: { url: string }, optional?: { init?: RequestInit }) => { requests.push(optional!.init!); return new Response(); },
    describeTransportError: () => ({ refusal: undefined, logDetail: "fixture" }),
  };
  const init: RequestInit = { method: "GET" };
  await createSourceControlProviderKit(required).fetch({ url: "https://a.example", init });
  await createSourceControlProviderKit(required, { fetchRedirectPolicy: "caller" }).fetch({ url: "https://a.example", init });
  expect(requests[0]!.redirect).toBe("manual");
  expect(requests[1]).toBe(init);
});

test("coverage presentation uses host text for absent floors while retaining the default output", () => {
  const area = { id: "shell" };
  const result = evaluateDiskArea({ area, onDisk: ["src/a.ts"], coverage: new Map() });
  expect(formatDiskArea({ result, area })).toContain("(no floor configured)");
  expect(formatDiskArea({ result, area }, { noFloorMessage: "(host floor settings)" })).toContain("(host floor settings)");
});


test("archive verification retains host diagnostics while comparing content rather than sizes", () => {
  const required = { archivePath: "/fixture/app.asar", sourceRoot: "/fixture", prefixes: ["src"], separator: "/",
    fs: { ...createNodePackagingFilesystem({}), read: () => Buffer.from("source") },
    archive: { header: () => ({ files: { src: { files: { "a.js": { size: 6, offset: "0" } } } } }), read: () => Buffer.from("broken") },
  };
  const baseline = verifyAsarAgainstSource(required);
  const treatment = verifyAsarAgainstSource(required, { contentMismatchMessage: "host content differs" });
  expect(baseline.checkedCount).toBe(1);
  expect(baseline.mismatches[0]!.reason).toBe("content differs from source (compared byte-for-byte, never by length alone)");
  expect(treatment.mismatches).toEqual([{ relPath: "src/a.js", reason: "host content differs" }]);
});


test("the shared builder preserves a legacy host operation ABI and inline-backup facts", async () => {
  const kit = { host: "fixture" };
  const operations = { backupInlineTextMaxBytes: 2048, readAccountLabel: async (token: string) => `account:${token}` };
  const loaded = { descriptor: { id: "git", label: "Git", apiOrigin: "https://git.example", module: "git.mjs" },
    module: { create: (required: { kit: typeof kit }) => { expect(required.kit).toBe(kit); return operations; } },
  };
  const registry = { list: () => [loaded], get: () => loaded, refusals: [] };
  const built = await buildSourceControlProvider<typeof kit, typeof operations, typeof registry>({ workspaceId: "host", providerId: "git", kit, load: async () => registry, noProviderMessage: () => "missing" });
  expect(built.ok).toBe(true);
  if (built.ok) {
    expect(built.provider.backupInlineTextMaxBytes).toBe(2048);
    expect(await built.provider.readAccountLabel("fixture-value")).toBe("account:fixture-value");
    expect(built.provider.apiOrigin).toBe("https://git.example");
  }
});
