import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import * as platform from "../index.js";
import * as filesystem from "../fs/index.js";
import { createNodeGuardedHttpPorts } from "../http/guarded/index.js";
import { SmtpMailerAdapter, createNodemailerSmtpTransport } from "../mail/smtp.js";

test("each published subpath declares its intended runtime and preserves its targets", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  for (const [entry, conditions] of Object.entries(manifest.exports)) {
    const browserSafeEntries = ["./net/endpoint-policy", "./secrets/credential-token"];
    expect(manifest.jini.entries[entry]).toBe(browserSafeEntries.includes(entry) ? "universal" : "node");
    const target = conditions as { types: string; import: string; default: string };
    expect(target.types).toBe(target.import.replace(/\.js$/, ".d.ts"));
    expect(target.default).toBe(target.import);
  }
});

test("root namespaces and filesystem barrel expose the extracted APIs", () => {
  expect(platform.filesystem.createDurableJsonFile).toBe(filesystem.createDurableJsonFile);
  expect(platform.filesystem.createGuardedFileReader).toBe(filesystem.createGuardedFileReader);
  expect(platform.guardedHttp.createNodeGuardedHttpPorts).toBe(createNodeGuardedHttpPorts);
  expect(platform.smtp.SmtpMailerAdapter).toBe(SmtpMailerAdapter);
});



test("SMTP sends call the injected object-argument transport and kernel clock", async () => {
  const payloads: unknown[] = [];
  const adapter = new SmtpMailerAdapter({
    transport: { async sendMail({ mail }) { payloads.push(mail); return { messageId: "id" }; } },
    clock: { nowMs() { return Date.parse("2030-01-01T00:00:00Z"); } },
  });
  const result = await adapter.send({
    message: { workspaceId: "w", from: { email: "from@example.com" }, to: { email: "to@example.com" }, subject: "subject", text: "body" },
    workspaceId: "w", idempotencyKey: "key", sourceContext: { module: "example" },
  });
  expect(result).toEqual({ ok: true, providerMessageId: "id", acceptedAt: "2030-01-01T00:00:00.000Z" });
  expect(payloads).toEqual([{ from: { address: "from@example.com" }, to: { address: "to@example.com" }, subject: "subject", text: "body" }]);
});

test("nodemailer adapter bridges the native vendor payload at its boundary", async () => {
  const mail = { from: { address: "from@example.com" }, to: { address: "to@example.com" }, subject: "hello" };
  const transport = createNodemailerSmtpTransport({ host: "smtp.example.com", port: 465, secure: true,
    auth: { user: "user", pass: "pass" }, nodemailer: { createTransport() { return { async sendMail(payload) {
      expect(payload).toEqual(mail); return { messageId: "native-id" };
    } }; } },
  });
  expect(await transport.sendMail({ mail })).toEqual({ messageId: "native-id" });
});
