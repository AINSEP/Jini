import { describe, it, expect } from "vitest";
import { createShareFilePolicy, sharePathAlias, SHARED_PLUGIN_MEMORY, type ShareFilePolicyDeps } from "../share-file-policy.js";
import { SiteShareRefusal } from "../share-refusal.js";
import type { CredentialWarning } from "../credential-warnings.js";

/** A neutral host: one invented key shape, a tree check refusing `blocked` segments, depth 4. */
const KEY = /hostkey_[a-z0-9]{8}/g;
const deps: ShareFilePolicyDeps = {
  redactSecretShapes: ({ text }) => { const redactions = text.match(KEY)?.length ?? 0; return { text: text.replace(KEY, "[REDACTED:host_key]"), redactions }; },
  checkTreePath: ({ relPath }) => relPath.split("/").includes("blocked") ? `'${relPath}' is blocked` : null,
  maxPathSegments: 4,
};
const policy = createShareFilePolicy(deps);
const code = (expected: string) => (error: unknown) => error instanceof SiteShareRefusal && error.code === expected;

describe("share file policy host injection", () => {
  it("treats a path carrying an injected secret shape as secret, and an ordinary path as not", () => {
    expect(policy.secretSharePath({ path: "media/hostkey_abcdef12.txt" })).toBe(true);
    expect(policy.secretSharePath({ path: "media/photo.png" })).toBe(false);
    expect(policy.secretSharePath({ path: "config/.env" })).toBe(true);
  });
  it("surfaces the injected tree-path reason and enforces the injected depth limit", () => {
    expect(() => policy.validateSharePath({ path: "themes/blocked/a.css" })).toThrow("Share path 'themes/blocked/a.css' is unsafe: 'themes/blocked/a.css' is blocked");
    expect(() => policy.validateSharePath({ path: "a/b/c/d.txt" })).not.toThrow();
    expect(() => policy.validateSharePath({ path: "a/b/c/d/e.txt" })).toThrow(SiteShareRefusal);
  });
  it("records a credential warning through the injected redactor without refusing the file", () => {
    const credentialWarnings: CredentialWarning[] = [];
    expect(policy.requireShareSecretFree({ path: "notes/readme.txt", bytes: Buffer.from("token hostkey_abcdef12 here") }, { credentialWarnings })).toBe(true);
    expect(credentialWarnings.length).toBe(1);
  });
  it("claims aliases archive-wide and refuses a case alias", () => {
    const aliases = new Map<string, string>(), files = new Set<string>();
    policy.claimSharePath({ path: "pages/About.html", directory: false, aliases, files });
    expect(() => policy.claimSharePath({ path: "pages/about.html", directory: false, aliases, files })).toThrow(/aliases|collision/);
    expect(sharePathAlias({ path: "Straße" })).toBe(sharePathAlias({ path: "STRASSE" }));
  });
  it("excludes runtime trees and refuses suspicious parts", () => {
    expect(policy.excludedSharePath({ path: "uploads/chat-attachments/x.png" })).toBe(true);
    expect(() => policy.excludedSharePath({ path: "themes/.git/config" })).toThrow(SiteShareRefusal);
    expect(new RegExp(SHARED_PLUGIN_MEMORY).test("memory/notes")).toBe(true);
    let refused: unknown;
    try { policy.excludedSharePath({ path: "data.sqlite" }); } catch (error) { refused = error; }
    expect(code("UNSAFE_FILE")(refused)).toBe(true);
  });
});
