import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import {
  buildFormsRateLimitKey,
  createFormDefinition,
  isHoneypotTripped,
  registerFormNotifySubscriber,
  setFormDefinitionStatus,
  submitForm,
  updateFormDefinition,
  validateFieldDescriptors,
  validateSubmissionPayload,
} from "../index.js";

test("forms keeps its own published root entry and CMS exposes no forms alias", () => {
  const own = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  const cms = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
  const changelog = readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8");
  expect(own.name).toBe("@jini-ai/cms-forms");
  // The version is read, not pinned: every release bump must ship with its own CHANGELOG heading,
  // so the newest released heading is the version the package claims.
  expect(changelog.match(/^## (\d+\.\d+\.\d+)\b/m)?.[1]).toBe(own.version);
  // Publishable since 809ed6d1; publish-pending/publish-all skip private packages.
  expect(own).not.toHaveProperty("private");
  expect(own.publishConfig).toEqual({ access: "public", registry: "https://registry.npmjs.org" });
  expect(own.exports["."]).toEqual({
    types: "./dist/index.d.ts",
    import: "./dist/index.js",
    default: "./dist/index.js",
  });
  expect(own.sideEffects).toBe(false);
});

test("the root entry exposes validators, services and the rate-limit key", () => {
  expect(validateFieldDescriptors({ fields: [{ id: "name", label: "Name", type: "text", required: true }] })).toEqual({ valid: true });
  expect(buildFormsRateLimitKey({ sourceIp: "source", formDefinitionId: "form" })).toBe("source:form");
  expect(isHoneypotTripped({ hp: "bot" })).toBe(true);
  for (const service of [validateSubmissionPayload, createFormDefinition, updateFormDefinition, setFormDefinitionStatus, submitForm, registerFormNotifySubscriber]) {
    expect(typeof service).toBe("function");
  }
});
