import { describe, expect, expectTypeOf, it } from "vitest";
import type { KeyringPort as VaultKeyringPort } from "@jini-ai/core/contracts/vault";
import type { KeyringPort } from "../ports.js";

/**
 * The keyring has one owner: `@jini-ai/core/contracts/vault`. A host's vault keyring must plug into
 * every integrations seam (and back) without an adapter, so the two names must be the same type.
 * This is a type-level test: `tsc -p packages/integrations/tsconfig.json` fails if they split again.
 */
describe("KeyringPort has a single owner", () => {
  it("integrations' KeyringPort is the vault contract's KeyringPort, assignable both ways", () => {
    expectTypeOf<KeyringPort>().toEqualTypeOf<VaultKeyringPort>();
    const vault = { activeKey: async () => ({ keyId: "k1" }) } as unknown as VaultKeyringPort;
    const fromVault: KeyringPort = vault;
    const backToVault: VaultKeyringPort = fromVault;
    expect(backToVault).toBe(vault);
  });
});
