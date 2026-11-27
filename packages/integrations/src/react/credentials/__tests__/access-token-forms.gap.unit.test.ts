import { describe, expect, it, vi } from "vitest";
import { accessTokenExistingRowReadyToSave, accessTokenExtraFieldIdSuffix, accessTokenReplaceReadyToSave, accessTokenRowReadyToSave, buildAccessTokenConnectionInput, buildAccessTokenUpdatePatch, classifyAccessTokenSubmitError } from "../access-token-forms.js";

type Fields = Parameters<typeof accessTokenRowReadyToSave>[0]["fields"];
type Info = Parameters<typeof accessTokenRowReadyToSave>[0]["info"];
const info: Info = { kind: "custom", providerId: "p", label: "P", vendorLabel: "P", purposeLabel: "x", category: "general", tokenPageUrl: "", scopeGuidanceKey: "", extraFields: [{ name: "accountId", label: "Account", required: true }] };
const fields = (over: Partial<Fields> = {}): Fields => ({ ref: { kind: "custom", providerId: "p" }, name: "Key", token: "tok-a", values: { accountId: "1" }, username: "", ...over });
const requiredFieldsFilled = vi.fn(({ values }: { values: Readonly<Record<string, string>> }) => Boolean(values.accountId));

describe("ready-to-save rules", () => {
  it("new rows need a name, a token and the required extra fields", () => {
    expect(accessTokenRowReadyToSave({ fields: fields({ name: " " }), info, deps: { requiredFieldsFilled } })).toBe(false);
    expect(accessTokenRowReadyToSave({ fields: fields({ token: " " }), info, deps: { requiredFieldsFilled } })).toBe(false);
    expect(accessTokenRowReadyToSave({ fields: fields({ values: {} }), info, deps: { requiredFieldsFilled } })).toBe(false);
    expect(accessTokenRowReadyToSave({ fields: fields(), info, deps: { requiredFieldsFilled } })).toBe(true);
    expect(requiredFieldsFilled).toHaveBeenLastCalledWith({ fields: info.extraFields, values: { accountId: "1" } });
  });

  it("replacement without a token is ready only on a rename", () => {
    const deps = { requiredFieldsFilled };
    expect(accessTokenReplaceReadyToSave({ fields: fields({ name: "" }), currentName: "Key", info, deps })).toBe(false);
    expect(accessTokenReplaceReadyToSave({ fields: fields({ token: "", name: " Key " }), currentName: "Key", info, deps })).toBe(false);
    expect(accessTokenReplaceReadyToSave({ fields: fields({ token: "", name: "New" }), currentName: "Key", info, deps })).toBe(true);
    expect(accessTokenReplaceReadyToSave({ fields: fields({ values: {} }), currentName: "Key", info, deps })).toBe(false);
  });

  it("existing rows: worksFor-only edits save, custom rows defer, source-control never takes the shortcut", () => {
    const customCredentialReplaceReadyToSave = vi.fn(() => false);
    const changed = vi.fn(() => true);
    const deps = { requiredFieldsFilled, accessTokenWorksForChanged: changed, customCredentialReplaceReadyToSave };
    const base = { info, SOURCE_CONTROL: "source-control" as const, deps };
    expect(accessTokenExistingRowReadyToSave({ ...base, fields: fields({ token: "" }), row: { kind: "publish", name: "Key", worksFor: ["a"] } })).toBe(true);
    expect(changed).toHaveBeenCalledWith({ draft: undefined, saved: ["a"] });
    changed.mockReturnValue(false);
    expect(accessTokenExistingRowReadyToSave({ ...base, fields: fields({ token: "" }), row: { kind: "custom", name: "Key", username: "u" } })).toBe(false);
    expect(customCredentialReplaceReadyToSave).toHaveBeenCalledWith({ fields: fields({ token: "" }), currentName: "Key", currentUsername: "u" });
    changed.mockReturnValue(true);
    expect(accessTokenExistingRowReadyToSave({ ...base, fields: fields({ token: "" }), row: { kind: "source-control", name: "Key" } })).toBe(false);
  });
});

describe("connection and patch builders", () => {
  const buildCredentialConnectionInput = vi.fn(() => ({ kind: "publish-conn" }) as never);
  const buildSourceControlConnectionInput = vi.fn(() => ({ kind: "sc-conn" }) as never);
  const deps = { buildCredentialConnectionInput, buildSourceControlConnectionInput };

  it("publish uses the provider spec or a token-only default, merging the token under its field", () => {
    buildAccessTokenConnectionInput({ fields: fields({ ref: { kind: "publish", providerId: "host" } }), info, deps });
    expect(buildCredentialConnectionInput).toHaveBeenLastCalledWith({ providerId: "host", spec: { tokenField: "token", fields: [{ name: "token", label: "Access token", required: true }] }, values: { accountId: "1", token: "tok-a" } });
    const spec = { tokenField: "apiKey", fields: [] };
    buildAccessTokenConnectionInput({ fields: fields({ ref: { kind: "publish", providerId: "host" } }), info: { ...info, publishCredential: spec }, deps });
    expect(buildCredentialConnectionInput).toHaveBeenLastCalledWith({ providerId: "host", spec, values: { accountId: "1", apiKey: "tok-a" } });
  });

  it("non-publish kinds build a source-control connection with declared fields", () => {
    expect(buildAccessTokenConnectionInput({ fields: fields(), info, deps })).toEqual({ kind: "sc-conn" });
    expect(buildSourceControlConnectionInput).toHaveBeenCalledWith({ fields: { providerId: "p", token: "tok-a", values: { accountId: "1" } }, declaredFields: info.extraFields });
  });

  it("patch carries worksFor only for publish rows that changed, a trimmed label and a connection", () => {
    const accessTokenWorksForChanged = vi.fn(() => true);
    const f = fields({ ref: { kind: "publish", providerId: "host" }, name: " New ", worksFor: ["b"] });
    expect(buildAccessTokenUpdatePatch({ fields: f, nameChanged: true, hasToken: true, info, deps: { ...deps, accessTokenWorksForChanged } }, { currentWorksFor: ["a"] }))
      .toEqual({ worksFor: ["b"], label: "New", connection: { kind: "publish-conn" } });
    expect(accessTokenWorksForChanged).toHaveBeenCalledWith({ draft: ["b"], saved: ["a"] });
    expect(buildAccessTokenUpdatePatch({ fields: fields({ worksFor: ["b"] }), nameChanged: false, hasToken: false, info, deps: { ...deps, accessTokenWorksForChanged } })).toEqual({});
  });

  it("extra field ids: accountId is 'account', others use the injected slugger", () => {
    const fieldNameHandleSegment = vi.fn(({ fieldName }: { fieldName: string }) => `seg-${fieldName}`);
    const asciiSlug = vi.fn(() => "");
    expect(accessTokenExtraFieldIdSuffix({ fieldName: "accountId", deps: { asciiSlug, fieldNameHandleSegment } })).toBe("account");
    expect(accessTokenExtraFieldIdSuffix({ fieldName: "zone", deps: { asciiSlug, fieldNameHandleSegment } })).toBe("seg-zone");
    expect(fieldNameHandleSegment).toHaveBeenCalledWith({ asciiSlug, fieldName: "zone" });
  });
});

describe("classifyAccessTokenSubmitError", () => {
  const isApiError = (e: unknown): e is never => typeof e === "object" && e !== null && "status" in e;
  it("maps duplicate-label and validation markers from code or message", () => {
    expect(classifyAccessTokenSubmitError({ e: new Error("x"), isApiError })).toEqual({ kind: "generic" });
    expect(classifyAccessTokenSubmitError({ e: { status: 409, code: "DUPLICATE_LABEL", message: "m" }, isApiError })).toEqual({ kind: "duplicate-label" });
    expect(classifyAccessTokenSubmitError({ e: { status: 400, message: "VALIDATION", body: { detail: "bad url" } }, isApiError })).toEqual({ kind: "validation", detail: "bad url" });
    expect(classifyAccessTokenSubmitError({ e: { status: 400, code: "VALIDATION", message: "plain", body: { detail: 3 } }, isApiError })).toEqual({ kind: "validation", detail: "plain" });
    expect(classifyAccessTokenSubmitError({ e: { status: 500, code: "OTHER", message: "m" }, isApiError })).toEqual({ kind: "generic" });
  });
});
