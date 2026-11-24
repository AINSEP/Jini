import { expect, it as test } from "vitest";
import { suggestCredentialWorksFor as suggestWorksFor } from "@jini-ai/platform/secrets/credential-sets";
import { buildCreateForm, type CreateCredentialPrefill } from "../custom-credential-create-ui.js";

const app = { appName: "host-custom-credential-create", appVersion: "1" };
const categories = ["source-control", "hosting", "media", "ai", "ops", "general"];
const baseUrlHint = "host-supplied base URL hint";

const providers = [{ id: "vercel", vendorId: "vercel" }, { id: "github-pages", vendorId: "github" }, { id: "s3-compatible", vendorId: "s3-compatible" }];

function worksForField(prefill: CreateCredentialPrefill) {
  const field = buildCreateForm({ prefill, providers, app, categories, suggestWorksFor, baseUrlHint }).fields.find(field => field.name === "worksFor");
  if (field !== undefined && field.kind !== "multi-enum") throw new Error("worksFor must be a multi-enum");
  return field;
}

test("API card reuses multi-enum and suggests exact catalog labels only on creation", () => {
  for (const [prefill, expected] of [[{ label: "Vercel" }, ["vercel"]], [{ label: "Production access", category: "hosting" }, []], [{ label: "Vercel", worksFor: [], category: "hosting" }, []]] as const) {
    const input = "worksFor" in prefill ? { ...prefill, worksFor: [...prefill.worksFor] } : prefill;
    const field = worksForField(input);
    expect(field?.value).toEqual(expected);
    expect(field?.options.some(option => option.value === "github")).toBe(true);
    expect(field?.options.some(option => option.value === "github-pages")).toBe(true);
  }
});

test("a non-hosting credential gets no Works-for picker and no deploy host", () => {
  for (const prefill of [{ label: "Jini Mail — Resend API" }, { label: "Jini Mail — Resend API", category: "general" }, { label: "Production access" }, { label: "Vercel", worksFor: [] }, {}]) {
    expect(worksForField(prefill), JSON.stringify(prefill)).toBeUndefined();
  }
});

test("a shown Works-for picker says it is optional and when to leave it empty", () => {
  const field = worksForField({ label: "Vercel" });
  expect(field?.label).toBe("Works for (optional)");
  expect(field?.hint ?? "").toMatch(/Leave this empty unless this is a hosting or deploy key/);
  expect(field?.required).toBeUndefined();
});

test("source-control credentials still get the catalog", () => {
  expect(worksForField({ label: "My repo", category: "source-control" })?.options.some(option => option.value === "github")).toBe(true);
});

test("prefilled non-catalog targets are the only options offered", () => {
  const field = worksForField({ label: "Jini Mail — Resend API", worksFor: ["resend"] });
  expect(field?.options.map(option => option.value)).toEqual(["resend"]);
  expect(field?.value).toEqual(["resend"]);
});

test("a prefilled catalog target keeps the whole catalog and its selection", () => {
  const field = worksForField({ label: "Production access", worksFor: ["vercel"] });
  expect(field?.value).toEqual(["vercel"]);
  expect(field?.options.map(option => option.value)).toEqual(["vercel", "github-pages", "github", "s3-compatible"]);
});

test("the Base URL field's hint is the host-injected text, not package copy", () => {
  const field = buildCreateForm({ prefill: {}, providers, app, categories, suggestWorksFor, baseUrlHint }).fields.find(field => field.name === "baseUrl");
  expect(field?.hint).toBe(baseUrlHint);
});
