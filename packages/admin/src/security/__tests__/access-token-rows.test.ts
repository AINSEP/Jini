import { describe, expect, it } from "vitest";
import {
  accessTokenNameTaken, accessTokenProviderMatchesQuery, accessTokenRowMatchesQuery, accessTokenRowsForProvider,
  buildAccessTokenRows, buildCustomCredentialRows, type AccessTokenRow, type RawCredentialSummary, type RawCustomCredentialSummary,
} from "../access-token-rows.js";

const LABELS: Record<string, string> = { "publish:vercel": "Vercel", "publish:netlify": "Netlify", "publish:github-pages": "GitHub Pages", "source-control:gitlab": "GitLab" };
const providerLabel = ({ ref }: { ref: { kind: string; providerId: string } }) => LABELS[`${ref.kind}:${ref.providerId}`] ?? ref.providerId;
const SENTINELS = { publish: "default", "source-control": "default" };
const build = (kind: "publish" | "source-control", raws: RawCredentialSummary[], sentinelLabels = SENTINELS) => buildAccessTokenRows({ kind, raws, providerLabel, sentinelLabels });

function rawSummary(overrides: Partial<RawCredentialSummary> = {}): RawCredentialSummary {
  return { id: "cred-1", providerId: "github-pages", label: "default", isDefault: true, createdAt: "2026-08-15T10:00:00.000Z", updatedAt: "2026-08-15T10:00:00.000Z", ...overrides };
}
function rawCustomSummary(overrides: Partial<RawCustomCredentialSummary> = {}): RawCustomCredentialSummary {
  return { id: "custom-1", label: "name.com", category: "general", baseUrl: "https://api.name.com", createdAt: "2026-08-17T10:00:00.000Z", updatedAt: "2026-08-17T10:00:00.000Z", ...overrides };
}

describe("buildAccessTokenRows", () => {
  it.each(["publish", "source-control"] as const)("preserves server token metadata for a %s row without changing its identity", (kind) => {
    const hint = { length: 20, last4: "a9F2" };
    const [row] = build(kind, [rawSummary({ label: "Production", tokenHint: hint })]);
    expect(row).toEqual({
      kind, providerId: "github-pages", id: "cred-1", name: "Production", rawLabel: "Production",
      isDefault: true, createdAt: "2026-08-15T10:00:00.000Z", updatedAt: "2026-08-15T10:00:00.000Z", tokenHint: hint,
    });
  });
  it("uses the saved label verbatim as the display name when it is not the legacy sentinel", () => {
    const rows = build("publish", [rawSummary({ label: "Production" })]);
    expect(rows[0]!.name).toBe("Production");
    expect(rows[0]!.rawLabel).toBe("Production");
  });
  it("computes a friendly name for a lone legacy 'default'-labeled row", () => {
    expect(build("publish", [rawSummary({ providerId: "vercel", label: "default" })])[0]!.name).toBe("Vercel token");
  });
  it("numbers a second legacy row for the SAME provider distinctly from the first", () => {
    const rows = build("publish", [rawSummary({ id: "a", providerId: "netlify" }), rawSummary({ id: "b", providerId: "netlify" })]);
    expect(rows.map((r) => r.name)).toEqual(["Netlify token", "Netlify token 2"]);
  });
  it("names a chat-saved 'default-<id>' project row like the sentinel row, keeping the raw label", () => {
    const rows = build("publish", [rawSummary({ id: "a", providerId: "vercel" }), rawSummary({ id: "b", providerId: "vercel", label: "default-01JCHAT" })]);
    expect(rows.map((r) => [r.name, r.rawLabel])).toEqual([["Vercel token", "default"], ["Vercel token 2", "default-01JCHAT"]]);
  });
  it("numbers legacy rows independently per provider, not globally", () => {
    const rows = build("publish", [rawSummary({ id: "a", providerId: "netlify" }), rawSummary({ id: "b", providerId: "vercel" })]);
    expect(rows.map((r) => r.name)).toEqual(["Netlify token", "Vercel token"]);
  });
  it("reads the sentinel of the row's OWN store: a divergent source-control sentinel does not make a publish row legacy", () => {
    const sentinelLabels = { publish: "default", "source-control": "scm-default" };
    expect(build("source-control", [rawSummary({ providerId: "gitlab", label: "scm-default" })], sentinelLabels)[0]!.name).toBe("GitLab token");
    expect(build("source-control", [rawSummary({ providerId: "gitlab", label: "default" })], sentinelLabels)[0]!.name).toBe("default");
    expect(build("publish", [rawSummary({ providerId: "vercel", label: "scm-default" })], sentinelLabels)[0]!.name).toBe("scm-default");
  });
});

describe("accessTokenRowsForProvider", () => {
  it("filters to exactly one kind+providerId pair, ignoring the same providerId under a different kind", () => {
    const rows: AccessTokenRow[] = [...build("publish", [rawSummary({ id: "a" })]), ...build("source-control", [rawSummary({ id: "b" })])];
    expect(accessTokenRowsForProvider({ rows, ref: { kind: "publish", providerId: "github-pages" } }).map((r) => r.id)).toEqual(["a"]);
  });
});

describe("accessTokenRowMatchesQuery / accessTokenProviderMatchesQuery", () => {
  const info = { label: "GitHub Pages", purposeLabel: "Hosting" };
  const row = build("publish", [rawSummary({ label: "Production" })])[0]!;
  it("matches everything when the query is blank", () => {
    expect(accessTokenRowMatchesQuery({ row, info, query: "" })).toBe(true);
    expect(accessTokenProviderMatchesQuery({ info, query: "  " })).toBe(true);
  });
  it("matches on the provider's own label, case-insensitively", () => {
    expect(accessTokenRowMatchesQuery({ row, info, query: "github" })).toBe(true);
    expect(accessTokenProviderMatchesQuery({ info, query: "GITHUB" })).toBe(true);
  });
  it("matches on the purpose subtitle", () => {
    expect(accessTokenRowMatchesQuery({ row, info, query: "hosting" })).toBe(true);
    expect(accessTokenProviderMatchesQuery({ info: { label: "GitHub", purposeLabel: "Source control" }, query: "hosting" })).toBe(false);
  });
  it("matches on the row's own display name", () => {
    expect(accessTokenRowMatchesQuery({ row, info, query: "production" })).toBe(true);
  });
  it("does not match an unrelated query", () => {
    expect(accessTokenRowMatchesQuery({ row, info, query: "azure" })).toBe(false);
    expect(accessTokenProviderMatchesQuery({ info, query: "azure" })).toBe(false);
  });
});

describe("accessTokenNameTaken", () => {
  const rows = build("publish", [rawSummary({ id: "a", label: "Production" })]);
  const ref = { kind: "publish" as const, providerId: "github-pages" };
  it("flags a collision, case- and whitespace-insensitive", () => {
    expect(accessTokenNameTaken({ rows, ref, name: "  production  " })).toBe(true);
    expect(accessTokenNameTaken({ rows, ref, name: "PRODUCTION" })).toBe(true);
  });
  it("does not flag a different name", () => { expect(accessTokenNameTaken({ rows, ref, name: "Staging" })).toBe(false); });
  it("does not flag a row against itself when excludeId is passed", () => {
    expect(accessTokenNameTaken({ rows, ref, name: "Production" }, { excludeId: "a" })).toBe(false);
  });
  it("does not flag a same-name row under a DIFFERENT provider", () => {
    expect(accessTokenNameTaken({ rows, ref: { kind: "publish", providerId: "vercel" }, name: "Production" })).toBe(false);
  });
});

describe("buildCustomCredentialRows", () => {
  it("preserves a short-token hint without adding a username or exposing token bytes", () => {
    const [row] = buildCustomCredentialRows({ raws: [rawCustomSummary({ tokenHint: { length: 4, last4: null } })] });
    expect(row).toEqual({
      kind: "custom", providerId: "custom-1", id: "custom-1", name: "name.com", rawLabel: "name.com", isDefault: false,
      category: "general", baseUrl: "https://api.name.com", createdAt: "2026-08-17T10:00:00.000Z", updatedAt: "2026-08-17T10:00:00.000Z",
      tokenHint: { length: 4, last4: null },
    });
  });
  it("maps a raw summary onto an AccessTokenRow with kind 'custom' and no default", () => {
    expect(buildCustomCredentialRows({ raws: [rawCustomSummary()] })).toEqual([{
      kind: "custom", providerId: "custom-1", id: "custom-1", name: "name.com", rawLabel: "name.com", isDefault: false,
      category: "general", baseUrl: "https://api.name.com", createdAt: "2026-08-17T10:00:00.000Z", updatedAt: "2026-08-17T10:00:00.000Z",
    }]);
  });
  it("gives each row its OWN providerId (its own id)", () => {
    const rows = buildCustomCredentialRows({ raws: [rawCustomSummary({ id: "a" }), rawCustomSummary({ id: "b", label: "GoDaddy" })] });
    expect(rows.map((r) => r.providerId)).toEqual(["a", "b"]);
  });
  it("carries scope, usage and a saved username only when present", () => {
    const [row] = buildCustomCredentialRows({ raws: [rawCustomSummary({ scope: "site", usedBy: ["s1"], usedByThisSite: true, username: "me" })] });
    expect(row).toMatchObject({ scope: "site", usedBy: ["s1"], usedByThisSite: true, username: "me" });
  });
});
