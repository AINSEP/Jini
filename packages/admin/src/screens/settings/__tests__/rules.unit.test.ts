import { describe, expect, it } from "vitest";

import type { SourceFieldValues } from "../../../react/kit-ui-types.js";
import type { ExecutionConfig } from "@jini-ai/core/contracts/execution";

/** A stand-in for the host's default execution config (the rules only read its `byok`). */
const DEFAULT_EXECUTION_CONFIG: ExecutionConfig = {
  mode: "local-cli",
  byok: { protocol: "anthropic", providerId: "anthropic", apiKey: "", baseUrl: "https://api.example.test", model: "" },
  localCli: { agentId: null },
};

import {
  areAnySlicesLoading,
  buildExternalMcpCardHandles,
  buildExternalMcpFieldSpecs,
  buildExternalMcpRemoveConfirmCopy,
  describeSaveStatus,
  mergeSourceUpdate,
  resolveByokConfig,
  resolveExternalMcpEffectiveAuthMode,
  resolveExternalMcpEffectiveTransport,
  validateExternalMcpOAuthIdentity,
  type SliceLoadState,
} from "../rules.js";
import type { KitSaveState } from "../../../react/kit-ui-types.js";
import { firstLoadError } from "../rules.js";
import type { AdminExternalMcpOAuthInput, AdminExternalMcpServerInput } from "@jini-ai/core/contracts/site/cms-external-mcp";

/**
 * @file Pure-logic coverage for `features/settings/rules.ts` — the "everything resolved" gate,
 * the first-error picker, the save-status label, and the dialog-theme mapping `SettingsUi.tsx`
 * derives from its six mounted slices. No React involved; see `SettingsUi.unit.test.tsx` for the
 * component-level tests (including the `InstructionsTab` fallback landmine).
 */

function slice(value: unknown, loadError: string | null = null): SliceLoadState {
  return { value, loadError };
}

describe("mergeSourceUpdate", () => {
  it("defaults an unknown source to empty fields and enabled", () => {
    expect(mergeSourceUpdate({ previous: undefined, patch: {} })).toEqual({ fields: {}, enabled: true, label: undefined });
  });

  it("defaults missing previous fields and enabled while retaining its label", () => {
    expect(mergeSourceUpdate({ previous: { label: "Local" }, patch: {} })).toEqual({ fields: {}, enabled: true, label: "Local" });
  });

  it("keeps explicit false and blank labels and merges fields without mutating the prior source", () => {
    const previous = { fields: { command: "node", args: "old" }, enabled: true, label: "Local" };
    const patch = { fields: { args: "new" }, enabled: false, label: "" };
    expect(mergeSourceUpdate({ previous, patch })).toEqual({ fields: { command: "node", args: "new" }, enabled: false, label: "" });
    expect(previous).toEqual({ fields: { command: "node", args: "old" }, enabled: true, label: "Local" });
    expect(patch).toEqual({ fields: { args: "new" }, enabled: false, label: "" });
  });

  it("preserves a disabled source when the patch omits enabled", () => {
    expect(mergeSourceUpdate({ previous: { fields: { command: "node" }, enabled: false, label: "Local" }, patch: {} }))
      .toEqual({ fields: { command: "node" }, enabled: false, label: "Local" });
  });
});

describe("areAnySlicesLoading", () => {
  it("is false for an empty slice set", () => {
    expect(areAnySlicesLoading({ slices: [] })).toBe(false);
  });

  it("is false once every slice has settled (non-null value)", () => {
    expect(areAnySlicesLoading({ slices: [slice("a"), slice({ theme: "dark" }), slice(0)] })).toBe(false);
  });

  it("is true while any single slice is still null, regardless of position", () => {
    expect(areAnySlicesLoading({ slices: [slice(null), slice("a")] })).toBe(true);
    expect(areAnySlicesLoading({ slices: [slice("a"), slice(null)] })).toBe(true);
  });
});

describe("firstLoadError", () => {
  it("is null when no slice reports an error", () => {
    expect(firstLoadError({ slices: [slice("a"), slice("b")] })).toBeNull();
  });

  it("returns the first error in slice order, ignoring later ones", () => {
    const result = firstLoadError({ slices: [slice("a"), slice(null, "first failure"), slice(null, "second failure")] });
    expect(result).toBe("first failure");
  });

  it("is null for an empty slice set", () => {
    expect(firstLoadError({ slices: [] })).toBeNull();
  });
});

describe("describeSaveStatus", () => {
  it.each<[KitSaveState, string]>([
    [{ status: "saving" }, "Saving…"],
    [{ status: "saved" }, "Saved"],
    [{ status: "error", message: "network down" }, "network down"],
    [{ status: "idle" }, ""],
  ])("renders %o as %j", (save, expected) => {
    expect(describeSaveStatus(save)).toBe(expected);
  });
});

describe("resolveByokConfig", () => {
  it("falls back to DEFAULT_EXECUTION_CONFIG.byok while executionConfig is still null", () => {
    expect(resolveByokConfig({ executionConfig: null, defaultByok: DEFAULT_EXECUTION_CONFIG.byok })).toBe(DEFAULT_EXECUTION_CONFIG.byok);
  });

  it("passes a loaded config's own byok through unchanged", () => {
    const executionConfig: ExecutionConfig = {
      ...DEFAULT_EXECUTION_CONFIG,
      byok: { ...DEFAULT_EXECUTION_CONFIG.byok, model: "claude-opus-5" },
    };
    expect(resolveByokConfig({ executionConfig, defaultByok: DEFAULT_EXECUTION_CONFIG.byok })).toEqual({ ...DEFAULT_EXECUTION_CONFIG.byok, model: "claude-opus-5" });
  });
});

describe("resolveExternalMcpEffectiveTransport", () => {
  it("defaults a blank/missing/unknown transport to stdio, matching the server's own default", () => {
    expect(resolveExternalMcpEffectiveTransport({})).toBe("stdio");
    expect(resolveExternalMcpEffectiveTransport({ transport: "" })).toBe("stdio");
    expect(resolveExternalMcpEffectiveTransport({ transport: "carrier-pigeon" })).toBe("stdio");
  });

  it("recognizes streamable_http", () => {
    expect(resolveExternalMcpEffectiveTransport({ transport: "streamable_http" })).toBe("streamable_http");
  });
});

describe("resolveExternalMcpEffectiveAuthMode", () => {
  it("defaults a blank/missing/unknown auth mode to static_env, matching the server's own default", () => {
    expect(resolveExternalMcpEffectiveAuthMode({})).toBe("static_env");
    expect(resolveExternalMcpEffectiveAuthMode({ authMode: "" })).toBe("static_env");
    expect(resolveExternalMcpEffectiveAuthMode({ authMode: "smoke-signal" })).toBe("static_env");
  });

  it("recognizes none and oauth", () => {
    expect(resolveExternalMcpEffectiveAuthMode({ authMode: "none" })).toBe("none");
    expect(resolveExternalMcpEffectiveAuthMode({ authMode: "oauth" })).toBe("oauth");
  });
});

describe("buildExternalMcpFieldSpecs — the reactive show/hide + required contract", () => {
  function keysOf(values: Record<string, string>): string[] {
    return buildExternalMcpFieldSpecs(values).map((spec) => spec.key);
  }
  function requiredOf(values: Record<string, string>, key: string): boolean {
    return Boolean(buildExternalMcpFieldSpecs(values).find((spec) => spec.key === key)?.required);
  }

  it("a fresh (blank) draft shows the stdio + static_env field set, with command required and url absent", () => {
    const keys = keysOf({});
    expect(keys).toContain("command");
    expect(keys).not.toContain("url");
    expect(keys).not.toContain("oauthClientId");
    expect(requiredOf({}, "command")).toBe(true);
  });

  it("switching to streamable_http hides command/args/env and requires url instead", () => {
    const values = { transport: "streamable_http" };
    const keys = keysOf(values);
    expect(keys).not.toContain("command");
    expect(keys).not.toContain("args");
    expect(keys).not.toContain("env");
    expect(keys).toContain("url");
    expect(requiredOf(values, "url")).toBe(true);
  });

  it("switching authMode to oauth reveals the OAuth fields, with grant/clientId required", () => {
    const values = { authMode: "oauth" };
    const keys = keysOf(values);
    expect(keys).toEqual(
      expect.arrayContaining([
        "oauthProviderId",
        "oauthGrant",
        "oauthClientId",
        "oauthClientSecret",
        "oauthScopes",
        "oauthAuthorizationEndpoint",
        "oauthTokenEndpoint",
        "oauthDeviceAuthorizationEndpoint",
      ]),
    );
    // Still required here: a blank draft is stdio, which has no URL to run discovery against — so
    // there is no `grant_types_supported` to read the sign-in method from either, same as the client
    // id immediately below.
    expect(requiredOf(values, "oauthGrant")).toBe(true);
    // Still required here: a blank draft is stdio, which has no URL to discover a registration
    // endpoint from.
    expect(requiredOf(values, "oauthClientId")).toBe(true);
    // Not required — a public/PKCE client legitimately has none, and the server never demands one.
    expect(requiredOf(values, "oauthClientSecret")).toBe(false);
  });

  it("a hosted OAuth connection may leave the client id blank — it can register itself", () => {
    const values = { transport: "streamable_http", authMode: "oauth" };
    // The server accepts a remote OAuth row with no client id and mints one by RFC 7591 dynamic
    // client registration at connect. A form that still demanded one would make the whole path
    // unreachable from the admin tab, which is the operator's only route to it.
    expect(keysOf(values)).toContain("oauthClientId");
    expect(requiredOf(values, "oauthClientId")).toBe(false);
    // Nor a provider identity — discovery supplies both.
    expect(requiredOf(values, "oauthProviderId")).toBe(false);
    expect(requiredOf(values, "oauthTokenEndpoint")).toBe(false);
    // Nor a sign-in method — the server's own `grant_types_supported` (read via RFC 8414 discovery
    // at connect time) answers the question a human would otherwise have to guess.
    expect(requiredOf(values, "oauthGrant")).toBe(false);
  });

  it("the OAuth access-token env var is only required for stdio + oauth, never for a hosted transport", () => {
    expect(keysOf({ transport: "stdio", authMode: "oauth" })).toContain("oauthTokenEnvName");
    expect(requiredOf({ transport: "stdio", authMode: "oauth" }, "oauthTokenEnvName")).toBe(true);
    expect(keysOf({ transport: "streamable_http", authMode: "oauth" })).not.toContain("oauthTokenEnvName");
  });

  it("orders Credentials third, right under Connection type, for every transport/authMode combination", () => {
    const combinations: Record<string, string>[] = [{}, { transport: "streamable_http" }, { authMode: "oauth" }, { authMode: "none" }];
    for (const values of combinations) {
      expect(keysOf(values).slice(0, 3)).toEqual(["id", "transport", "authMode"]);
    }
  });

  it("static_env puts a write-only Access token field fourth; stdio adds its env-var name fifth, a hosted server does not", () => {
    expect(keysOf({ authMode: "static_env" }).slice(3, 5)).toEqual(["accessToken", "accessTokenEnvName"]);
    expect(buildExternalMcpFieldSpecs({}).find((spec) => spec.key === "accessToken")?.kind).toBe("password");
    const hosted = keysOf({ transport: "streamable_http", authMode: "static_env" });
    expect(hosted[3]).toBe("accessToken");
    expect(hosted).not.toContain("accessTokenEnvName");
  });

  it("none and oauth show no Access token field", () => {
    for (const authMode of ["none", "oauth"]) {
      expect(keysOf({ authMode })).not.toContain("accessToken");
      expect(keysOf({ authMode })).not.toContain("accessTokenEnvName");
    }
  });

  it("authMode static_env or none never shows any oauth-prefixed field", () => {
    for (const authMode of ["static_env", "none"]) {
      const keys = keysOf({ authMode });
      expect(keys.some((key) => key.startsWith("oauth"))).toBe(false);
    }
  });

  it("always includes writeAllowedToolNames, immediately after allowedToolNames, for every transport/authMode combination", () => {
    // Unconditional per trust.ts R2/R3 — the write-grant check doesn't key off transport or auth
    // mode, so unlike oauthClientId/oauthTokenEnvName above, no combination here may omit it. This
    // is what would fail if the field spec were accidentally gated onto only one arm (e.g. stdio-only,
    // matching the `env` field's own gate a few lines below it in rules.ts).
    // Declared rather than inferred: without the annotation each literal widens to its own shape and
    // the union is not assignable to `keysOf`'s `Record<string, string>` parameter.
    const combinations: Record<string, string>[] = [
      {},
      { transport: "streamable_http" },
      { authMode: "oauth" },
      { authMode: "none" },
      { transport: "streamable_http", authMode: "oauth" },
    ];
    for (const values of combinations) {
      const keys = keysOf(values);
      const allowedIndex = keys.indexOf("allowedToolNames");
      const writeIndex = keys.indexOf("writeAllowedToolNames");
      expect(allowedIndex).toBeGreaterThanOrEqual(0);
      expect(writeIndex).toBe(allowedIndex + 1);
    }
  });

  it("writeAllowedToolNames is optional (not required) and never disabled/hidden by required:false being mistaken for absence", () => {
    const spec = buildExternalMcpFieldSpecs({}).find((s) => s.key === "writeAllowedToolNames");
    expect(spec).toBeDefined();
    expect(spec?.required).toBeFalsy();
    expect(spec?.kind).toBe("text");
  });
});

describe("buildExternalMcpFieldSpecs — exhaustive coverage of the PUT route's editable fields", () => {
  /**
   * The generalised regression for tonight's `writeAllowedToolNames` bug: `buildExternalMcpFieldSpecs`
   * never pushed a spec for it, so the database column, the PUT route
   * (`apps/website/src/server/inbound/admin-http/routes/external-mcp/put.ts`'s
   * `parseExternalMcpPutBody`), and `use-external-mcp.hooks.ts` all handled the field correctly while
   * the admin tab silently had no control for it (fixed in `ae13e739`). The tests above pin THAT
   * field; this block instead enumerates every field the route accepts — via `AdminExternalMcpServerInput`/
   * `AdminExternalMcpOAuthInput`, this admin's own mirror of the route's body, already used by
   * `use-external-mcp.hooks.ts` to build the same PUT — and asserts each one is reachable from a real
   * control, so the NEXT field added to that type without a matching spec fails here instead of
   * shipping silently.
   */

  /**
   * Every top-level field the PUT route accepts, keyed as `Record<keyof AdminExternalMcpServerInput,
   * true>` rather than a plain string array: adding a field to that type without adding it here is a
   * `tsc` error, not a maybe-caught runtime gap. This is what makes the enumeration exhaustive rather
   * than a snapshot of today's fields.
   */
  const TOP_LEVEL_FIELDS: Record<keyof AdminExternalMcpServerInput, true> = {
    expectedVersion: true,
    label: true,
    transport: true,
    enabled: true,
    command: true,
    url: true,
    args: true,
    allowedToolNames: true,
    writeAllowedToolNames: true,
    env: true,
    authMode: true,
    accessToken: true,
    accessTokenEnvName: true,
    oauth: true,
  };

  /** Same exhaustiveness contract as {@link TOP_LEVEL_FIELDS}, for the OAuth sub-object's own fields. */
  const OAUTH_FIELDS: Record<keyof AdminExternalMcpOAuthInput, true> = {
    providerId: true,
    grant: true,
    clientId: true,
    clientSecret: true,
    scopes: true,
    tokenEnvName: true,
    authorizationEndpoint: true,
    tokenEndpoint: true,
    deviceAuthorizationEndpoint: true,
  };

  /**
   * Fields the route accepts that are deliberately NOT one of `buildExternalMcpFieldSpecs`'s own
   * entries — an explicit allowlist, not a silent omission, so a reviewer can see the judgment call
   * rather than infer it from a test that merely happens to pass:
   *  - `label` — rendered by `@jini-ai/ui`'s `SourceConfigItemCard`/`SourceConfigAddForm` chrome
   *    itself (a fixed "Label" input outside the per-item field-spec loop), not by this module.
   *  - `enabled` — rendered by that same package's enable/disable checkbox in the card header, gated
   *    on `source.enabled !== undefined` rather than a field spec.
   *  - `expectedVersion` — the basis the tab sends back (the `version` it last loaded or saved), never typed by an operator.
   *  - `oauth` — a wire-body CONTAINER, not a control an operator fills in directly; its own members
   *    are `OAUTH_FIELDS` below, each checked against its own `oauth<Field>` spec key.
   */
  const RENDERED_OUTSIDE_FIELD_SPECS = new Set<keyof AdminExternalMcpServerInput>(["label", "enabled", "oauth", "expectedVersion"]);

  /**
   * The union of every spec key `buildExternalMcpFieldSpecs` can produce across the field set's two
   * independent axes (transport x authMode). Deliberately a union over four combinations rather than
   * one call: `command`/`url` never coexist, and the sibling "always includes writeAllowedToolNames"
   * test above exists precisely because a real field WAS scoped to only one arm of a conditional by
   * mistake. A union check catches a repeat of that mistake for any field, not only that one.
   */
  function everyPossibleSpecKey(): Set<string> {
    const combos: SourceFieldValues[] = [
      {},
      { transport: "streamable_http" },
      { authMode: "oauth" },
      { transport: "streamable_http", authMode: "oauth" },
    ];
    const keys = new Set<string>();
    for (const values of combos) {
      for (const spec of buildExternalMcpFieldSpecs(values)) keys.add(spec.key);
    }
    return keys;
  }

  it("every route-accepted top-level field is either rendered outside the field specs (see the allowlist) or reachable from buildExternalMcpFieldSpecs for some transport/authMode combination", () => {
    const specKeys = everyPossibleSpecKey();
    for (const field of Object.keys(TOP_LEVEL_FIELDS) as (keyof AdminExternalMcpServerInput)[]) {
      if (RENDERED_OUTSIDE_FIELD_SPECS.has(field)) continue;
      expect(
        specKeys.has(field),
        `"${field}" is accepted by the PUT route (AdminExternalMcpServerInput) but has no field spec ` +
          `and is not in RENDERED_OUTSIDE_FIELD_SPECS — an operator cannot edit it. This is the ` +
          `writeAllowedToolNames bug (ae13e739), generalised.`,
      ).toBe(true);
    }
  });

  it("every OAuth sub-field is reachable from buildExternalMcpFieldSpecs as its oauth<Field> spec key", () => {
    const specKeys = everyPossibleSpecKey();
    for (const field of Object.keys(OAUTH_FIELDS) as (keyof AdminExternalMcpOAuthInput)[]) {
      const specKey = `oauth${field[0]?.toUpperCase()}${field.slice(1)}`;
      expect(
        specKeys.has(specKey),
        `oauth.${field} is accepted by the PUT route but no "${specKey}" field spec renders it.`,
      ).toBe(true);
    }
  });
});

describe("validateExternalMcpOAuthIdentity", () => {
  it("is null when authMode isn't oauth, regardless of what providerId/tokenEndpoint hold", () => {
    expect(validateExternalMcpOAuthIdentity({ authMode: "static_env" })).toBeNull();
    expect(validateExternalMcpOAuthIdentity({})).toBeNull();
  });

  it("flags an oauth draft with neither a provider id nor a token endpoint", () => {
    expect(validateExternalMcpOAuthIdentity({ authMode: "oauth" })).toBe(
      "Enter a Provider ID, or fill in this connection's own Token endpoint.",
    );
    expect(validateExternalMcpOAuthIdentity({ authMode: "oauth", oauthProviderId: "   " })).not.toBeNull();
  });

  it("accepts either a provider id alone or a token endpoint alone — this is an OR, not an AND", () => {
    expect(validateExternalMcpOAuthIdentity({ authMode: "oauth", oauthProviderId: "example-oidc" })).toBeNull();
    expect(validateExternalMcpOAuthIdentity({ authMode: "oauth", oauthTokenEndpoint: "https://x.example/token" })).toBeNull();
  });

  it("exempts a REMOTE oauth draft entirely — it can discover its own endpoints at connect", () => {
    // The server accepts this row and runs RFC 9728 / RFC 8414 discovery against its URL. A rule
    // that still demanded an endpoint here would make a hosted MCP server unattachable from the
    // admin tab, which is the operator's only route to it.
    expect(validateExternalMcpOAuthIdentity({ transport: "streamable_http", authMode: "oauth" })).toBeNull();
    // Still flagged for stdio, which has no URL to discover from.
    expect(validateExternalMcpOAuthIdentity({ transport: "stdio", authMode: "oauth" })).toBe(
      "Enter a Provider ID, or fill in this connection's own Token endpoint.",
    );
  });
});

describe("buildExternalMcpCardHandles", () => {
  it("derives a legible handle from the server's own id, not its position", () => {
    expect(buildExternalMcpCardHandles({ sourceIds: ["higgsfield", "github"] })).toEqual([
      "mcp-server-higgsfield",
      "mcp-server-github",
    ]);
  });

  it("slugifies an id that is not already handle-shaped, since a handle is [a-z0-9-] only", () => {
    expect(buildExternalMcpCardHandles({ sourceIds: ["My_Server.1"] })).toEqual(["mcp-server-my-server-1"]);
  });

  it("falls back to the position for an id with nothing sluggable left in it", () => {
    expect(buildExternalMcpCardHandles({ sourceIds: ["***", "…"] })).toEqual(["mcp-server-1", "mcp-server-2"]);
  });

  it("keeps two ids that slugify identically apart", () => {
    expect(buildExternalMcpCardHandles({ sourceIds: ["My_Server", "my.server"] })).toEqual([
      "mcp-server-my-server",
      "mcp-server-my-server-2",
    ]);
  });

  // The case a single `-<index>` append gets wrong: the third entry's fallback would be
  // `mcp-server-x-3`, which the SECOND entry already holds. Duplicate handles do not fail loudly —
  // they make every `page.click`/`page.fill` aimed at either card resolve to whichever the DOM
  // reaches first. This is why the suffix search is a loop.
  it("keeps a de-duplication suffix from colliding with an id that already looks like one", () => {
    const handles = buildExternalMcpCardHandles({ sourceIds: ["x", "x-3", "x"] });
    expect(new Set(handles).size).toBe(3);
    expect(handles).toEqual(["mcp-server-x", "mcp-server-x-3", "mcp-server-x-2"]);
  });

  it("never repeats a handle, however adversarial the id list", () => {
    const ids = ["x", "x-2", "x", "x-3", "x", "X", "x_", "-x-", "x-2-2"];
    const handles = buildExternalMcpCardHandles({ sourceIds: ids });
    expect(handles).toHaveLength(ids.length);
    expect(new Set(handles).size).toBe(ids.length);
  });

  it("returns nothing for an empty list", () => {
    expect(buildExternalMcpCardHandles({ sourceIds: [] })).toEqual([]);
  });
});

describe("buildExternalMcpRemoveConfirmCopy", () => {
  it("names the server being removed in the title", () => {
    const copy = buildExternalMcpRemoveConfirmCopy({ name: "higgsfield", isOAuth: false });
    expect(copy.title).toBe('Remove "higgsfield"?');
  });

  it("names a DIFFERENT server when there are several configured", () => {
    const copy = buildExternalMcpRemoveConfirmCopy({ name: "github", isOAuth: false });
    expect(copy.title).toBe('Remove "github"?');
  });

  it("an OAuth connection's body states the sealed credential cannot be recovered", () => {
    const copy = buildExternalMcpRemoveConfirmCopy({ name: "higgsfield", isOAuth: true });
    expect(copy.body).toMatch(/sealed/i);
    expect(copy.body).toMatch(/cannot be recovered/i);
    expect(copy.body).toBe("This connection will stop working immediately. Its OAuth credential is sealed and cannot be recovered — reconnecting will require signing in again.");
  });

  it("a non-OAuth connection's body does not claim a sealed credential is lost", () => {
    const copy = buildExternalMcpRemoveConfirmCopy({ name: "higgsfield", isOAuth: false });
    expect(copy.body).not.toMatch(/sealed/i);
    expect(copy.body).toBe("This connection will stop working immediately. You'll need to re-enter its configuration to use it again.");
  });
});
