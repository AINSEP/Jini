import { expect, test } from "vitest";
import { defaultPlatformMessages } from "../messages.js";
import { EgressRefusedError } from "../http/guarded/errors.js";
import { EnvOrFileKeyring, UnusableRootKeyError } from "../secrets/keyring.env.js";
// REGRESSION: fails if the egress default is reverted to the former site-specific wording.
test("egress defaults are neutral and never expose the internal diagnostic", () => {
  const error = new EgressRefusedError({ message: "internal 10.0.0.1" });
  expect(error.callerSafeMessage).toBe("egress to the requested host was refused by the outbound network policy");
  expect(error.message).toBe("internal 10.0.0.1");
  expect(new EgressRefusedError({ message: "internal" }, { callerSafeMessage: "host refusal" }).callerSafeMessage).toBe("host refusal");
});
// REGRESSION: fails if the shortened-root-key warning is reverted to the former site-specific wording.
test("keyring warning is neutral while short-key refusal and recovery warning remain intact", async () => {
  const keyring = new EnvOrFileKeyring({ env: { read: () => "aa" }, envVarName: "HOST_KEY", keyFilePath: "/unused", hkdfSalt: "fixture", allowFileFallback: false, allowFileAutoGenerate: false });
  await expect(keyring.derive({ workspaceId: "scope", purpose: "fixture", info: "id" })).rejects.toThrow(UnusableRootKeyError);
  await expect(keyring.derive({ workspaceId: "scope", purpose: "fixture", info: "id" })).rejects.toThrow("anything sealed while this value was in place");
  await expect(keyring.derive({ workspaceId: "scope", purpose: "fixture", info: "id" })).rejects.toThrow("will make them unreadable");
});
// PARITY: each host may replace one common messages object without weakening network/key guards.
test("both boundaries accept the same host-selected copy object", async () => {
  const messages = { ...defaultPlatformMessages, egressRefused: () => "host policy refusal", rootKeySealedWarning: () => "HOST RECOVERY WARNING: " };
  expect(new EgressRefusedError({ message: "detail" }, { messages }).callerSafeMessage).toBe("host policy refusal");
  const keyring = new EnvOrFileKeyring({ env: { read: () => "aa" }, envVarName: "HOST_KEY", keyFilePath: "/unused", hkdfSalt: "fixture", allowFileFallback: false, allowFileAutoGenerate: false }, { messages });
  await expect(keyring.derive({ workspaceId: "scope", purpose: "fixture", info: "id" })).rejects.toThrow("HOST RECOVERY WARNING");
});

test("default platform diagnostics tell operators which filesystem constraint failed", () => {
  const messages = defaultPlatformMessages;
  expect({
    mode: messages.atomicModeInvalid(),
    tempPath: messages.atomicTempPathInvalid(),
    tempName: messages.atomicTempNameInvalid(),
    symlink: messages.atomicSymlinkRefused(),
    permissions: messages.atomicPermissionsRefused(),
    serialization: messages.atomicJsonUnserializable(),
    intervals: messages.fileLockIntervalsInvalid(),
    write: messages.fileLockWriteNoProgress(),
    timeout: messages.fileLockTimeout({ waitedMs: 19.8 }),
    lost: messages.fileLockLost(),
  }).toEqual({
    mode: "atomic file mode must be permission bits between 0000 and 0777",
    tempPath: "atomic temp path must be a different same-directory file",
    tempName: "atomic temp name must be one safe segment",
    symlink: "atomic write refused a symbolic-link destination",
    permissions: "atomic write refused non-owner-only permissions",
    serialization: "atomic JSON data must be serializable",
    intervals: "file lock intervals must be positive safe integers (timeout may be zero or Infinity; stale may be Infinity)",
    write: "file lock ownership write made no progress",
    timeout: "exclusive file lock timed out after 20ms",
    lost: "exclusive file lock lost ownership before the critical section finished",
  });
});
