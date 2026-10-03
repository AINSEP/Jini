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

test("forms keeps its own private root entry and CMS exposes no forms alias", () => {
  const own = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  const cms = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
  expect(own.name).toBe("@jini-ai/cms-forms");
  expect(own.version).toBe("0.2.0");
  expect(own.private).toBe(true);
  expect(own).not.toHaveProperty("publishConfig");
  expect(own.exports["."]).toEqual({
    types: "./dist/index.d.ts",
    import: "./dist/index.js",
    default: "./dist/index.js",
  });
  expect(own.sideEffects).toBe(false);
  expect(cms.exports).not.toHaveProperty("./forms");
  expect(cms.jini.entries).not.toHaveProperty("./forms");
  expect(existsSync(fileURLToPath(new URL("../../../src/forms", import.meta.url)))).toBe(false);
});

test("the root entry exposes validators, services and the rate-limit key", () => {
  expect(validateFieldDescriptors({ fields: [{ id: "name", label: "Name", type: "text", required: true }] })).toEqual({ valid: true });
  expect(buildFormsRateLimitKey({ sourceIp: "source", formDefinitionId: "form" })).toBe("source:form");
  expect(isHoneypotTripped({ hp: "bot" })).toBe(true);
  for (const service of [validateSubmissionPayload, createFormDefinition, updateFormDefinition, setFormDefinitionStatus, submitForm, registerFormNotifySubscriber]) {
    expect(typeof service).toBe("function");
  }
});
