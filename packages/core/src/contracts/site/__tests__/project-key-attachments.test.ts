import { expectTypeOf, test } from "vitest";

import type { KeyAttachments, ProjectKeyTransaction } from "../project-key-attachments.js";

test("ProjectKeyTransaction preserves the caller's generic result", () => {
  const transaction: ProjectKeyTransaction = async ({ run }) => run();
  expectTypeOf(transaction<number>).returns.toEqualTypeOf<Promise<number>>();
  expectTypeOf(transaction<{ id: string }>).parameter(0).toEqualTypeOf<{ run: () => Promise<{ id: string }> }>();
});

test("attach takes the immutable site id, key id and display name", () => {
  expectTypeOf<Parameters<KeyAttachments["attach"]>>().toEqualTypeOf<[
    required: { siteId: string; keyId: string; siteName: string },
    optional?: Record<string, never>,
  ]>();
});

test("a port without keyForLabel still substitutes for KeyAttachments", () => {
  type WithoutLabelLookup = Omit<KeyAttachments, "keyForLabel">;
  expectTypeOf<WithoutLabelLookup>().toMatchTypeOf<KeyAttachments>();
  const port: WithoutLabelLookup = {
    keysFor: async () => [],
    attach: async () => undefined,
    detach: async () => undefined,
    isAttached: async () => false,
    usersOf: async () => [],
    removeKey: async () => undefined,
    renameSite: async () => undefined,
  };
  const substituted: KeyAttachments = port;
  expectTypeOf(substituted.keyForLabel).toEqualTypeOf<KeyAttachments["keyForLabel"]>();
});
