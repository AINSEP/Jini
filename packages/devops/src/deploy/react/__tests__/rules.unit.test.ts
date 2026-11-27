import { expect, it } from "vitest";
import {
  credentialFieldHandleId, credentialNoun, credentialStepSubtitle, credentialVerifyStatusClass,
  daemonStatusLabelKey, deploymentEnvVarNoteKey, envVarStatusLabelKey, exportRunStatusLabelKey,
  fieldHelpText, fieldLabelParts, isEnvVarRowUnsafe, ownerPasswordLabelKey, productionGateLabelKey,
  publishConfigFieldHandleId, publishRunStatusLabelKey, runStatusTone, runtimeModeLabelKey, staticPublishProjectNameCopy,
} from "../rules.js";

it("keeps existing team, token and account handles while sluggifying additional fields", () => {
  const asciiSlug = ({ text }: { text: string }) => text.toLowerCase();
  expect(publishConfigFieldHandleId({ fieldName: "teamId", asciiSlug })).toBe("deployment-static-site-publish-team");
  expect(publishConfigFieldHandleId({ fieldName: "projectSlug", asciiSlug })).toBe("deployment-static-site-publish-project-slug");
  const credential = (fieldName: string) => credentialFieldHandleId({ providerId: "cloud", tokenField: "secretKey", fieldName, asciiSlug });
  expect(credential("secretKey")).toBe("deployment-static-site-credentials-token-cloud");
  expect(credential("accountId")).toBe("deployment-static-site-credentials-account-cloud");
  expect(credential("accessKeyId")).toBe("deployment-static-site-credentials-access-key-id-cloud");
});

it("uses person-facing descriptor copy and explains why hosted workspaces need a saved connection", () => {
  const field = { name: "token", label: "Secret key", required: true, help: "Agent-only note", userHelp: "Generate a key" };
  const credential = { tokenField: "token", fields: [field] };
  expect(fieldHelpText({ field })).toBe("Generate a key");
  expect(fieldHelpText({ field: credential })).toBeUndefined();
  expect(fieldHelpText({ field: { ...credential, help: "Fallback" } })).toBe("Fallback");
  expect(fieldLabelParts({ field })).toEqual({ label: "Secret key", suffixKey: null });
  expect(fieldLabelParts({ field: { ...field, required: false } })).toEqual({ label: "Secret key", suffixKey: "(optional)" });
  expect(credentialNoun({ credential })).toBe("secret key");
  expect(credentialNoun({ credential: { ...credential, fields: [{ ...field, label: "API token" }] } })).toBe("API token");
  expect(credentialNoun({ credential: { ...credential, fields: [] } })).toBe("access token");
  const props = { credential, translate: (key: string) => `localized ${key}`, copy: { credentialSubtitle: "Paste your {credential}" } };
  expect(credentialStepSubtitle({ ...props, executionMode: "hosted-api-only" })).toBe("localized This workspace can't use your computer's terminal — connecting here is the only way to publish.");
  expect(credentialStepSubtitle({ ...props, executionMode: "self-hosted-cli" })).toBe("localized Paste your secret key");
  const target = { id: "cloud", label: "Cloud", configFields: [] };
  expect(staticPublishProjectNameCopy({ target })).toBeNull();
  expect(staticPublishProjectNameCopy({ target: { ...target, projectName: { label: "Site", help: "Shown on the dashboard" } } })).toEqual({ labelKey: "Site", helpKey: "Shown on the dashboard" });
});

it("distinguishes unsafe, absent and file-backed environment values", () => {
  const unsafeOwnerPasswordVar = "OWNER_PASSWORD";
  const owner = { name: unsafeOwnerPasswordVar, set: false };
  const key = { name: "SITE_KEY", set: true, source: "file" as const };
  expect(isEnvVarRowUnsafe({ varStatus: owner, unsafeOwnerPasswordVar })).toBe(true);
  expect(isEnvVarRowUnsafe({ varStatus: { ...owner, set: true }, unsafeOwnerPasswordVar })).toBe(false);
  expect(isEnvVarRowUnsafe({ varStatus: { ...key, invalid: true }, unsafeOwnerPasswordVar })).toBe(true);
  expect(isEnvVarRowUnsafe({ varStatus: { name: "PORT", set: false }, unsafeOwnerPasswordVar })).toBe(false);
  expect(envVarStatusLabelKey({ varStatus: { ...key, invalid: true } })).toBe("Invalid — the keyring rejects it");
  expect(envVarStatusLabelKey({ varStatus: owner })).toBe("Not set");
  expect(envVarStatusLabelKey({ varStatus: key })).toBe("Set (generated key file)");
  expect(envVarStatusLabelKey({ varStatus: { ...owner, set: true } })).toBe("Set");
  const envVarNotes = { SITE_KEY: "Production boot requires a site key" };
  expect(deploymentEnvVarNoteKey({ name: key.name, envVarNotes })).toBe("Production boot requires a site key");
  expect(deploymentEnvVarNoteKey({ name: owner.name, envVarNotes })).toBe("");
});

it("reports deployment safety and verification without implying an unreachable credential passed", () => {
  expect(runtimeModeLabelKey({ mode: "production" })).toBe("Production");
  expect(runtimeModeLabelKey({ mode: "local" })).toBe("Local");
  expect(productionGateLabelKey({ gate: { applicable: false, passed: false } })).toBe("Not applicable (local mode)");
  expect(productionGateLabelKey({ gate: { applicable: true, passed: true } })).toBe("Passed");
  expect(daemonStatusLabelKey({ daemonKnownFailed: true })).toBe("Known failure — check server logs.");
  expect(daemonStatusLabelKey({ daemonKnownFailed: false })).toBe("No known failure");
  const copy = { unsafeOwnerPasswordLabel: "Change the default before starting" };
  expect(ownerPasswordLabelKey({ defaultOwnerPasswordUnsafe: true, copy })).toBe(copy.unsafeOwnerPasswordLabel);
  expect(ownerPasswordLabelKey({ defaultOwnerPasswordUnsafe: false, copy })).toBe("Changed from the default.");
  function tone(status: "valid" | "invalid" | "unreachable", verifyError: string | null = null) {
    return credentialVerifyStatusClass({ row: { verifyError, verification: { status, message: "probe", checkedAt: "2026-10-01T00:00:00Z" } } });
  }
  expect(tone("valid")).toBe("save-ok");
  expect(tone("unreachable")).toBe("save-warning");
  expect(tone("invalid")).toBe("save-error");
  expect(tone("valid", "verification service failed")).toBe("save-error");
  expect(credentialVerifyStatusClass({ row: { verifyError: null, verification: undefined } })).toBe("save-ok");
});

it.each([
  ["idle", undefined, "neutral", "Not started", "Not started"],
  ["running", undefined, "warning", "Exporting…", "Publishing…"],
  ["errored", undefined, "error", "Export failed", "Publish failed"],
  ["completed", false, "error", "Finished with failures", "Publish failed"],
  ["completed", true, "ok", "Export finished", "Published"],
] as const)("shows %s (%s) with the right tone and action-specific label", (status, ok, tone, exportLabel, publishLabel) => {
  expect(runStatusTone({ status }, { ok })).toBe(tone);
  expect(exportRunStatusLabelKey({ run: { status, ...(ok === undefined ? {} : { ok }) } })).toBe(exportLabel);
  expect(publishRunStatusLabelKey({ run: { status, ...(ok === undefined ? {} : { result: { ok } }) } })).toBe(publishLabel);
});
