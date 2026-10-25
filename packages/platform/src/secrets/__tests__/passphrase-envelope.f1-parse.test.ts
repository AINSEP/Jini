import { beforeAll, describe, expect, it } from "vitest";
import { openWithPassphrase, sealWithPassphrase } from "../index.js";

// F1 fix wave (Stryker L1 §4 passphrase-envelope.ts:88-124 — salt regex anchors, ±16 ciphertext
// bound, typeof/isRecord guards, size limit). One sealed envelope, then exactly one field broken
// per case. Parser refusals happen before any KDF work and carry one exact message; inputs the
// parser ACCEPTS but that change the authenticated header fail later as "authentication failed",
// which is how each accepted boundary is told apart from a refused one.
const INVALID = "Passphrase envelope: invalid or unsupported envelope";
const AUTH = "Passphrase envelope: authentication failed";
const passphrase = "fixture passphrase";
let base: { header: Record<string, any>; sealed: Record<string, any> };

beforeAll(async () => {
  base = JSON.parse(await sealWithPassphrase({ payload: "p", passphrase }, { randomBytesFn: ({ byteLength }) => Buffer.alloc(byteLength, 0xab) }));
});
const clone = () => JSON.parse(JSON.stringify(base)) as typeof base;
const open = (envelope: unknown) => openWithPassphrase({ envelope: typeof envelope === "string" ? envelope : JSON.stringify(envelope), passphrase });

describe("top-level shape", () => {
  it.each([["array", []], ["null", null], ["JSON string", JSON.stringify("x")], ["number", 1], ["header null", { header: null, sealed: {} }], ["header array", { header: [], sealed: {} }]])("%s → invalid", async (_l, value) => {
    await expect(open(value)).rejects.toThrow(new TypeError(INVALID));
  });
  it("non-string envelope → TypeError expected a string", async () => {
    await expect(openWithPassphrase({ envelope: 42 as never, passphrase })).rejects.toThrow(new TypeError("Passphrase envelope: expected a string"));
  });
  it("invalid JSON → TypeError invalid JSON", async () => {
    await expect(openWithPassphrase({ envelope: "{", passphrase })).rejects.toThrow(new TypeError("Passphrase envelope: invalid JSON"));
  });
  it("an envelope over 24 MiB is refused by size before parsing", async () => {
    await expect(openWithPassphrase({ envelope: " ".repeat(24 * 1024 * 1024 + 1), passphrase })).rejects.toThrow(new RangeError("Passphrase envelope: size limit exceeded"));
  });
});

describe("header", () => {
  it.each<[string, (e: typeof base) => void]>([
    ["wrong format", e => { e.header.format = "other"; }],
    ["version 2", e => { e.header.version = 2; }],
    ["version as string", e => { e.header.version = "1"; }],
    ["kdf null", e => { e.header.kdf = null; }],
    ["kdf array", e => { e.header.kdf = []; }],
    ["kdf name", e => { e.header.kdf.name = "pbkdf2"; }],
    ["salt number", e => { e.header.kdf.salt = 7; }],
    ["salt 31 hex", e => { e.header.kdf.salt = e.header.kdf.salt.slice(1); }],
    ["salt 33 hex", e => { e.header.kdf.salt += "a"; }],
    ["salt trailing newline", e => { e.header.kdf.salt += "\n"; }],
    ["salt leading junk", e => { e.header.kdf.salt = `x${e.header.kdf.salt.slice(1)}`; }],
    ["salt non-hex", e => { e.header.kdf.salt = `g${e.header.kdf.salt.slice(1)}`; }],
    ["N too small", e => { e.header.kdf.N = 8192; }],
    ["N too large", e => { e.header.kdf.N = 131072; }],
    ["N as string", e => { e.header.kdf.N = "32768"; }],
    ["r", e => { e.header.kdf.r = 7; }],
    ["p", e => { e.header.kdf.p = 2; }],
  ])("%s → invalid", async (_l, mutate) => {
    const e = clone(); mutate(e);
    await expect(open(e)).rejects.toThrow(new TypeError(INVALID));
  });

  it.each<[string, (e: typeof base) => void]>([
    ["upper-case salt (regex is /i)", e => { e.header.kdf.salt = e.header.kdf.salt.toUpperCase(); }],
    ["N=16384 (allowed cost)", e => { e.header.kdf.N = 16384; }],
    ["an extra header field (authenticated as AAD)", e => { e.header.extra = 1; }],
  ])("%s is accepted by the parser but fails authentication", async (_l, mutate) => {
    const e = clone(); mutate(e);
    await expect(open(e)).rejects.toThrow(new Error(AUTH));
  });
});

describe("sealed", () => {
  const b64 = (n: number) => Buffer.alloc(n, 1).toString("base64");
  it.each<[string, (e: typeof base) => void]>([
    ["sealed null", e => { (e as any).sealed = null; }],
    ["sealed array", e => { (e as any).sealed = []; }],
    ["alg", e => { e.sealed.alg = "aes-128-gcm"; }],
    ["keyId", e => { e.sealed.keyId = "v2"; }],
    ["nonce non-string", e => { e.sealed.nonce = 12; }],
    ["nonce 11 bytes", e => { e.sealed.nonce = b64(11); }],
    ["nonce 13 bytes", e => { e.sealed.nonce = b64(13); }],
    ["nonce non-canonical base64", e => { e.sealed.nonce = `${e.sealed.nonce}\n`; }],
    ["ciphertext 15 bytes", e => { e.sealed.ciphertext = b64(15); }],
    ["ciphertext over 16 MiB + 16", e => { e.sealed.ciphertext = b64(16 * 1024 * 1024 + 17); }],
    ["ciphertext unpadded", e => { e.sealed.ciphertext = e.sealed.ciphertext.replace(/=+$/, ""); if (!/=$/.test(base.sealed.ciphertext)) e.sealed.ciphertext += "="; }],
  ])("%s → invalid", async (_l, mutate) => {
    const e = clone(); mutate(e);
    await expect(open(e)).rejects.toThrow(new TypeError(INVALID));
  });

  it.each([16, 16 * 1024 * 1024 + 16])("ciphertext of exactly %d bytes passes the bound (then fails authentication)", async (n) => {
    const e = clone(); e.sealed.ciphertext = b64(n);
    await expect(open(e)).rejects.toThrow(new Error(AUTH));
  });
});
