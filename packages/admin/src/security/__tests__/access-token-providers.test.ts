import { describe, expect, it } from "vitest";
import { accessTokenProvidersWithSavedRows, accessTokenProviderInfo, accessTokenProviders, accessTokenRowProviderInfo, extraFieldsAroundToken, providerGroupSubtitleKeys } from "../access-token-providers.js";
import { buildCustomCredentialRows, type AccessTokenRow, type RawCustomCredentialSummary } from "../access-token-rows.js";
import { ACCESS_TOKEN_TEST_PROVIDERS as PROVIDERS, COPY, HOST, PLAIN_TARGET, PUBLISH_TARGETS, SOURCE_CONTROL_TEST_DESCRIPTORS } from "./access-token-providers.fixture.js";

function rawCustomSummary(overrides: Partial<RawCustomCredentialSummary> = {}): RawCustomCredentialSummary {
  return {
    id: "custom-1",
    label: "name.com",
    category: "general",
    baseUrl: "https://api.name.com",
    createdAt: "2026-08-17T10:00:00.000Z",
    updatedAt: "2026-08-17T10:00:00.000Z",
    ...overrides,
  };
}

describe("accessTokenProviders", () => {
  it("leaves the generic token label to the view when a host declares only non-token fields", () => {
    const target = { ...PUBLISH_TARGETS[0]!, credential: { tokenField: "token", fields: [{ name: "accountId", label: "Account ID" }] } };
    const [info] = accessTokenProviders({ publishTargets: [target], ...HOST });
    expect(info!.tokenLabel).toBeUndefined();
    expect(info!.extraFields).toEqual([{ name: "accountId", label: "Account ID" }]);
    expect(extraFieldsAroundToken({ info: info! })).toEqual({ before: [], after: [{ name: "accountId", label: "Account ID" }] });
  });

  it("lists every deploy host that takes a credential, in registry order, then the listed source-control hosts", () => {
    expect(PROVIDERS.map((p) => `${p.kind}:${p.providerId}`)).toEqual([
      "publish:github-pages",
      "publish:vercel",
      "publish:netlify",
      "publish:cloudflare-pages",
      "source-control:github",
      "source-control:gitlab",
      "source-control:bitbucket",
    ]);
  });

  it("skips a host whose descriptor takes no credential", () => {
    expect(accessTokenProviders({ publishTargets: [...PUBLISH_TARGETS, PLAIN_TARGET], ...HOST }).some((p) => p.providerId === PLAIN_TARGET.id)).toBe(false);
  });

  it("lists only the source-control hosts while the deploy hosts are still loading, and none of either before both load", () => {
    expect(accessTokenProviders({ publishTargets: undefined, ...HOST }, { sourceControlProviders: SOURCE_CONTROL_TEST_DESCRIPTORS }).map((p) => p.kind)).toEqual(["source-control", "source-control", "source-control"]);
    expect(accessTokenProviders({ publishTargets: undefined, ...HOST })).toEqual([]);
  });

  it("reads a source-control host's token label, token page and guidance from its plugin descriptor, and never names GitLab or Bitbucket itself", () => {
    const github = accessTokenProviderInfo({ copy: COPY, providers: PROVIDERS, ref: { kind: "source-control", providerId: "github" } });
    expect(github.tokenLabel).toBe("Access token");
    expect(github.tokenPageUrl).toBe("https://github.com/settings/personal-access-tokens/new");
    expect(github.extraFields).toEqual([]);
    expect(accessTokenProviders({ publishTargets: undefined, ...HOST }, { sourceControlProviders: [{ id: "github", label: "GitHub" }] }).map((p) => p.providerId)).toEqual(["github"]);
  });

  it("reads a host's token label, token page, guidance and vendor from its descriptor", () => {
    const cloudflare = accessTokenProviderInfo({ copy: COPY, providers: PROVIDERS, ref: { kind: "publish", providerId: "cloudflare-pages" } });
    expect(cloudflare.tokenLabel).toBe("API token");
    expect(cloudflare.tokenPageUrl).toBe("https://dash.cloudflare.com/profile/api-tokens");
    expect(cloudflare.scopeGuidanceKey).toBe("Needs an API token with Cloudflare Pages Edit permission, plus the account ID.");
    expect(cloudflare.vendorLabel).toBe("Cloudflare");
  });

  it("shows a credential's person-facing userHelp as its guidance over the agent's help", () => {
    const target = PUBLISH_TARGETS.find((entry) => entry.id === "cloudflare-pages")!;
    const withUserHelp = { ...target, credential: { ...target.credential!, userHelp: "Have your account ID ready." } };
    expect(accessTokenProviderInfo({ copy: COPY, providers: accessTokenProviders({ publishTargets: [withUserHelp], ...HOST }), ref: { kind: "publish", providerId: "cloudflare-pages" } }).scopeGuidanceKey).toBe(
      "Have your account ID ready."
    );
  });

  it("falls back to the host's own label as its vendor, and to no token page or guidance, when the descriptor names none", () => {
    const netlify = accessTokenProviderInfo({ copy: COPY, providers: PROVIDERS, ref: { kind: "publish", providerId: "netlify" } });
    expect(netlify.vendorLabel).toBe("Netlify");
    expect(netlify.tokenPageUrl).toBe("");
    expect(netlify.scopeGuidanceKey).toBe("");
  });

  it("gives an unlisted provider a bare entry named by its own id, never another provider's copy", () => {
    const info = accessTokenProviderInfo({ copy: COPY, providers: PROVIDERS, ref: { kind: "publish", providerId: "gone-host" } });
    expect(info.label).toBe("gone-host");
    expect(info.tokenPageUrl).toBe("");
    expect(info.scopeGuidanceKey).toBe("");
    expect(info.extraFields).toEqual([]);
  });

  it("gives github-pages and github distinct purpose labels — the two-store GitHub trap", () => {
    const githubPages = accessTokenProviderInfo({ copy: COPY, providers: PROVIDERS, ref: { kind: "publish", providerId: "github-pages" } });
    const github = accessTokenProviderInfo({ copy: COPY, providers: PROVIDERS, ref: { kind: "source-control", providerId: "github" } });
    expect(githubPages.label).toBe("GitHub Pages");
    expect(github.label).toBe("GitHub");
    expect(githubPages.purposeLabel).not.toBe(github.purposeLabel);
    expect(githubPages.purposeLabel).toBe("Hosting");
    // "Source control" (sentence case), not "Source Control" — 2026-09-21 round 2: this must read
    // identically to the "Source control" filter chip's own label (`ACCESS_TOKEN_CATEGORIES`), the
    // same letter-for-letter agreement round 1 already gave the "Hosting" pair above.
    expect(github.purposeLabel).toBe("Source control");
  });

  it("carries cloudflare-pages' Account ID field and a source-control host's declared Username field through as extra fields", () => {
    const cloudflare = accessTokenProviderInfo({ copy: COPY, providers: PROVIDERS, ref: { kind: "publish", providerId: "cloudflare-pages" } });
    expect(cloudflare.extraFields.map((f) => [f.name, f.required])).toEqual([["accountId", true]]);
    const bitbucket = accessTokenProviderInfo({ copy: COPY, providers: PROVIDERS, ref: { kind: "source-control", providerId: "bitbucket" } });
    expect(bitbucket.extraFields.map((f) => [f.name, f.required])).toEqual([["username", true]]);
    expect(bitbucket.username).toBeUndefined();
  });
});

describe("accessTokenRowProviderInfo", () => {
  it("uses General and no token-page URL for a custom row without optional category or URL metadata", () => {
    const row: AccessTokenRow = { kind: "custom", providerId: "custom-1", id: "custom-1", name: "Legacy provider", rawLabel: "Legacy provider", isDefault: false, createdAt: "", updatedAt: "" };
    expect(accessTokenRowProviderInfo({ copy: COPY, providers: PROVIDERS, row })).toEqual({
      kind: "custom", providerId: "custom-1", label: "Legacy provider", vendorLabel: "Legacy provider", purposeLabel: "General", category: "general",
      tokenPageUrl: "", scopeGuidanceKey: "Paste the access token this provider issued from its own dashboard.", extraFields: [], username: "optional",
    });
  });

  it("delegates straight through for a catalog kind", () => {
    const row: AccessTokenRow = {
      kind: "publish",
      providerId: "github-pages",
      id: "row-1",
      name: "Production",
      rawLabel: "Production",
      isDefault: true,
      createdAt: "2026-08-17T10:00:00.000Z",
      updatedAt: "2026-08-17T10:00:00.000Z",
    };
    expect(accessTokenRowProviderInfo({ copy: COPY, providers: PROVIDERS, row })).toEqual(accessTokenProviderInfo({ copy: COPY, providers: PROVIDERS, ref: row }));
  });

  it("builds a synthetic info for a 'custom' row from its own name/category/baseUrl", () => {
    const [row] = buildCustomCredentialRows({ raws: [rawCustomSummary({ label: "name.com", category: "hosting", baseUrl: "https://api.name.com" })] });
    const info = accessTokenRowProviderInfo({ copy: COPY, providers: PROVIDERS, row: row! });
    expect(info.label).toBe("name.com");
    expect(info.vendorLabel).toBe("name.com");
    expect(info.category).toBe("hosting");
    expect(info.purposeLabel).toBe("Hosting");
    expect(info.tokenPageUrl).toBe("https://api.name.com");
    expect(info.extraFields).toEqual([]);
    expect(info.username).toBe("optional");
  });
});

describe("providerGroupSubtitleKeys", () => {
  it("marks a custom credential as custom, so one named 'github' never reads as the GitHub source-control group", () => {
    const [row] = buildCustomCredentialRows({ raws: [rawCustomSummary({ label: "github", category: "source-control" })] });
    const custom = accessTokenRowProviderInfo({ copy: COPY, providers: PROVIDERS, row: row! });
    expect(providerGroupSubtitleKeys({ info: custom, copy: COPY })).toEqual(["Custom credential", "Source control"]);
    const github = accessTokenProviders({ publishTargets: undefined, ...HOST }, { sourceControlProviders: [{ id: "github", label: "GitHub" }] })[0]!;
    expect(providerGroupSubtitleKeys({ info: github, copy: COPY })).toEqual(["Source control"]);
  });

});

describe("extraFieldsAroundToken", () => {
  const s3 = {
    id: "s3-compatible",
    label: "S3-compatible storage",
    configFields: [],
    credential: {
      tokenField: "secretAccessKey",
      fields: [
        { name: "endpoint", label: "Endpoint" },
        { name: "accessKeyId", label: "Access key ID", required: true },
        { name: "secretAccessKey", label: "Secret access key", required: true, secret: true },
        { name: "publicUrl", label: "Public URL", required: true },
      ],
    },
  };

  it("keeps a host's declared order: fields before its token field render above it, the rest below", () => {
    const [info] = accessTokenProviders({ publishTargets: [s3 as never], ...HOST });
    const { before, after } = extraFieldsAroundToken({ info: info! });
    expect(before.map((f) => f.name)).toEqual(["endpoint", "accessKeyId"]);
    expect(after.map((f) => f.name)).toEqual(["publicUrl"]);
  });

  it("puts every extra field below the token when the token is declared first, or the provider declares no order", () => {
    const cloudflare = accessTokenProviderInfo({ copy: COPY, providers: accessTokenProviders({ publishTargets: PUBLISH_TARGETS, ...HOST }), ref: { kind: "publish", providerId: "cloudflare-pages" } });
    expect(extraFieldsAroundToken({ info: cloudflare }).before).toEqual([]);
    expect(extraFieldsAroundToken({ info: cloudflare }).after.map((f) => f.name)).toEqual(["accountId"]);
    const github = accessTokenProviders({ publishTargets: undefined, ...HOST }, { sourceControlProviders: [{ id: "github", label: "GitHub" }] })[0]!;
    expect(extraFieldsAroundToken({ info: github })).toEqual({ before: [], after: github.extraFields });
  });
});

describe("accessTokenProvidersWithSavedRows (IRON RULE: a saved credential never drops off the page)", () => {
  const row = (kind: "publish" | "source-control" | "custom", providerId: string) => ({
    kind, providerId, id: `${kind}-${providerId}`, name: providerId, rawLabel: providerId, isDefault: true, createdAt: "", updatedAt: "",
  });

  it("appends one bare unlisted entry per unlisted provider that has saved rows, named by its id", () => {
    const listed = accessTokenProviders({ publishTargets: undefined, ...HOST });
    const all = accessTokenProvidersWithSavedRows({ copy: COPY, providers: listed, rows: [row("publish", "example-host"), row("publish", "example-host"), row("source-control", "sourcehut")] });
    const extra = all.slice(listed.length);
    expect(extra.map((p) => [p.kind, p.providerId, p.label, p.unlisted])).toEqual([
      ["publish", "example-host", "example-host", true],
      ["source-control", "sourcehut", "sourcehut", true],
    ]);
    expect(extra.every((p) => p.tokenPageUrl === "")).toBe(true);
  });

  it("adds nothing for listed providers or custom rows", () => {
    const listed = accessTokenProviders({ publishTargets: undefined, ...HOST }, { sourceControlProviders: SOURCE_CONTROL_TEST_DESCRIPTORS });
    expect(accessTokenProvidersWithSavedRows({ copy: COPY, providers: listed, rows: [row("source-control", listed.find((p) => p.kind === "source-control")!.providerId), row("custom", "c-1")] })).toEqual(listed);
  });
});


describe("injected copy", () => {
  const OTHER = { ...COPY, publishPurposeLabel: "Deploy", sourceControlPurposeLabel: "Repos", customScopeGuidanceKey: "custom-help", customCredentialSubtitleKey: "custom-key" };

  it("reads both purpose subtitles from the injected copy, never a built-in string", () => {
    const providers = accessTokenProviders({ publishTargets: PUBLISH_TARGETS, ...HOST, copy: OTHER }, { sourceControlProviders: SOURCE_CONTROL_TEST_DESCRIPTORS });
    expect(providers.find((p) => p.kind === "publish")!.purposeLabel).toBe("Deploy");
    expect(providers.find((p) => p.kind === "source-control")!.purposeLabel).toBe("Repos");
    expect(accessTokenProviderInfo({ providers, ref: { kind: "publish", providerId: "gone" }, copy: OTHER }).purposeLabel).toBe("Deploy");
    expect(accessTokenProviderInfo({ providers, ref: { kind: "source-control", providerId: "gone" }, copy: OTHER }).purposeLabel).toBe("Repos");
  });

  it("reads a custom row's guidance, category label and subtitle key from the injected copy", () => {
    const [row] = buildCustomCredentialRows({ raws: [rawCustomSummary({ category: "ai" })] });
    const info = accessTokenRowProviderInfo({ providers: [], row: row!, copy: { ...OTHER, categories: [{ id: "ai", label: "Models" }] } });
    expect(info.scopeGuidanceKey).toBe("custom-help");
    expect(info.purposeLabel).toBe("Models");
    expect(providerGroupSubtitleKeys({ info, copy: OTHER })).toEqual(["custom-key", "Models"]);
  });
});
