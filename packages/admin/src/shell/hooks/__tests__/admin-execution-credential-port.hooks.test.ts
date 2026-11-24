import { describe, expect, it } from "vitest";

import {
  UNSET_ADMIN_EXECUTION_CREDENTIAL,
  createFakeAdminExecutionCredentialPort,
} from "../admin-execution-credential-port.hooks.js";

describe("createFakeAdminExecutionCredentialPort", () => {
  it("starts from the unset view and loads whatever it holds", async () => {
    const port = createFakeAdminExecutionCredentialPort();
    await expect(port.loadAdminExecutionCredential()).resolves.toEqual(UNSET_ADMIN_EXECUTION_CREDENTIAL);
    expect(port.current).toBe(UNSET_ADMIN_EXECUTION_CREDENTIAL);
    expect(port.saveCalls).toEqual([]);
  });

  it("merges a save into the stored view, masking the key to its last four characters", async () => {
    const port = createFakeAdminExecutionCredentialPort();
    const saved = await port.saveAdminExecutionCredential({ patch: { apiKey: "sk-test-WXYZ", model: "m-1" } });
    expect(saved).toEqual({
      ...UNSET_ADMIN_EXECUTION_CREDENTIAL,
      isSet: true,
      masked: "••••WXYZ",
      model: "m-1",
      updatedAt: new Date(0).toISOString(),
    });
    await expect(port.loadAdminExecutionCredential()).resolves.toBe(saved);
    expect(port.saveCalls).toEqual([{ apiKey: "sk-test-WXYZ", model: "m-1" }]);
  });

  it("keeps the stored mask and provider when a patch omits them, and clears provider on explicit null", async () => {
    const stored = { ...UNSET_ADMIN_EXECUTION_CREDENTIAL, isSet: true, masked: "••••abcd", providerId: "p-1" };
    const port = createFakeAdminExecutionCredentialPort({ stored });
    const kept = await port.saveAdminExecutionCredential({ patch: { model: "m-2" } });
    expect(kept.masked).toBe("••••abcd");
    expect(kept.providerId).toBe("p-1");
    const cleared = await port.saveAdminExecutionCredential({ patch: { providerId: null } });
    expect(cleared.providerId).toBeNull();
  });

  it("lets onSave replace the merge outright or reject the save", async () => {
    const replacement = { ...UNSET_ADMIN_EXECUTION_CREDENTIAL, isSet: true, masked: "custom" };
    const replacing = createFakeAdminExecutionCredentialPort({ onSave: () => replacement });
    await expect(replacing.saveAdminExecutionCredential({ patch: { apiKey: "k" } })).resolves.toBe(replacement);
    expect(replacing.current).toBe(replacement);

    const error = new Error("rejected");
    const failing = createFakeAdminExecutionCredentialPort({ onSave: () => { throw error; } });
    await expect(failing.saveAdminExecutionCredential({ patch: { apiKey: "k" } })).rejects.toBe(error);
    expect(failing.current).toBe(UNSET_ADMIN_EXECUTION_CREDENTIAL);
    expect(failing.saveCalls).toEqual([{ apiKey: "k" }]);
  });
});
