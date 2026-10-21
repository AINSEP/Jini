import assert from "node:assert/strict";
import { test } from "vitest";

import { createMailSenderIdentityResolver, NON_DELIVERING_MAIL_DRIVERS, SenderIdentityNotConfiguredError } from "../index.js";

/**
 * @file The sender-identity decision order: a configured sender wins, a non-delivering driver keeps
 * the caller's `.local` placeholder, and a delivering driver with nothing configured refuses with a
 * coded error (neutral copy by default, host copy when supplied) instead of a From the provider rejects.
 */

const FALLBACK = { email: "no-reply@members.local", name: "Members" };

test("a configured sender wins on any driver, borrowing the fallback name when it has none", async () => {
  const reads: string[] = [];
  const resolver = createMailSenderIdentityResolver({ readDriver: () => assert.fail("not read") }, {
    readConfiguredSender: async ({ workspaceId }) => { reads.push(workspaceId); return { email: "hello@example.com" }; },
  });
  assert.deepEqual(await resolver.resolve({ workspaceId: "ws", fallback: FALLBACK }), { email: "hello@example.com", name: "Members" });
  const named = createMailSenderIdentityResolver({ readDriver: () => "smtp" }, { readConfiguredSender: async () => ({ email: "a@b.c", name: "Site" }) });
  assert.deepEqual(await named.resolve({ workspaceId: "ws", fallback: FALLBACK }), { email: "a@b.c", name: "Site" });
  assert.deepEqual(reads, ["ws"]);
  assert.deepEqual(await resolver.resolve({ workspaceId: "ws", fallback: { email: "x@y.local" } }), { email: "hello@example.com" }, "no name on either side: none invented");
});

test("with nothing configured, console and memory keep the placeholder; the driver is read after settle", async () => {
  assert.deepEqual([...NON_DELIVERING_MAIL_DRIVERS], ["console", "memory"]);
  const order: string[] = [];
  for (const driver of NON_DELIVERING_MAIL_DRIVERS) {
    const resolver = createMailSenderIdentityResolver({ readDriver: () => { order.push(`driver:${driver}`); return driver; } }, {
      readConfiguredSender: async () => null,
      settle: async () => { order.push("settle"); },
    });
    assert.deepEqual(await resolver.resolve({ workspaceId: "ws", fallback: FALLBACK }), FALLBACK);
  }
  assert.deepEqual(order, ["settle", "driver:console", "settle", "driver:memory"]);
  const bare = createMailSenderIdentityResolver({ readDriver: () => "memory" });
  assert.deepEqual(await bare.resolve({ workspaceId: "ws", fallback: FALLBACK }), FALLBACK, "no settings read means nothing configured");
});

test("a delivering or unknown driver with nothing configured refuses with the coded error, or the host's", async () => {
  const resolver = createMailSenderIdentityResolver({ readDriver: () => "resend" }, { readConfiguredSender: async () => ({ name: "only a name" }) });
  const error = await resolver.resolve({ workspaceId: "ws-1", fallback: FALLBACK }).then(() => assert.fail("must refuse"), (thrown: unknown) => thrown);
  assert.ok(error instanceof SenderIdentityNotConfiguredError);
  assert.equal(error.code, "mail_sender_not_configured");
  assert.equal(error.name, "SenderIdentityNotConfiguredError");
  assert.match(error.message, /^No sender address is configured for workspace ws-1, so the "resend" mailer cannot send/);

  const hostError = new SenderIdentityNotConfiguredError({ workspaceId: "ws-1", driver: "smtp" }, { message: "host copy" });
  const hosted = createMailSenderIdentityResolver({ readDriver: () => "smtp" }, { notConfigured: ({ workspaceId, driver }) => {
    assert.deepEqual([workspaceId, driver], ["ws-1", "smtp"]);
    return hostError;
  } });
  await assert.rejects(hosted.resolve({ workspaceId: "ws-1", fallback: FALLBACK }), (thrown) => thrown === hostError && hostError.message === "host copy");
});
