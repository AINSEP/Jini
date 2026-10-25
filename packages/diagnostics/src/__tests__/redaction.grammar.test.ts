/**
 * @file One table per credential grammar in `redaction.ts`, asserting the EXACT redacted output so a
 * dropped `?`, anchor or alternative fails: URL query names (`api-key`/`api_key`/`apikey`, each
 * separator `?`/`&`/`#`), bare `name=value`/`name: value` pairs after each allowed boundary (start,
 * space, tab, `,`, `;`) and NOT mid-identifier, and the HTTP auth schemes. Values are plain words so
 * the shared secret-shape catalog cannot be what redacts them. Closes L10 survivors at redaction.ts:5,11.
 */
import { describe, expect, test } from "vitest";
import { redactText } from "../redaction.js";

const r = (text: string) => redactText({ text });

describe("URL query secrets", () => {
  test.each([
    ["?api-key=v4lue", "?api-key=[REDACTED]"], ["?api_key=v4lue", "?api_key=[REDACTED]"], ["?apikey=v4lue", "?apikey=[REDACTED]"],
    ["?KEY=v4lue", "?KEY=[REDACTED]"], ["?auth=v4lue", "?auth=[REDACTED]"], ["?dsn=v4lue", "?dsn=[REDACTED]"],
    ["?access_token=v4lue", "?access_token=[REDACTED]"], ["?refresh_token=v4lue", "?refresh_token=[REDACTED]"], ["?id_token=v4lue", "?id_token=[REDACTED]"],
    ["?a=1&password=v4lue&b=2", "?a=1&password=[REDACTED]&b=2"], ["#secret=v4lue", "#secret=[REDACTED]"],
    ["?token=v4lue\"rest", "?token=[REDACTED]\"rest"], ["?token=v4lue#frag", "?token=[REDACTED]#frag"], ["?token=", "?token=[REDACTED]"],
  ])("https://x.example/p%s", (query, expected) => {
    expect(r(`https://x.example/p${query}`)).toBe(`https://x.example/p${expected}`);
  });

  test.each(["?api~key=v4lue", "?apiXkey=v4lue", "?keyring=v4lue", "?mytoken=v4lue"])("%s is not a secret name and stays", (query) => {
    expect(r(`https://x.example/p${query}`)).toBe(`https://x.example/p${query}`);
  });
});

describe("bare name=value secrets", () => {
  test.each([
    ["password=v4lue", "password=[REDACTED]"], ["api-key=v4lue", "api-key=[REDACTED]"], ["api_key=v4lue", "api_key=[REDACTED]"], ["apikey=v4lue", "apikey=[REDACTED]"],
    ["auth=v4lue", "auth=[REDACTED]"], ["authorization=v4lue", "authorization=[REDACTED]"], ["secret: v4lue", "secret: [REDACTED]"], ["token:v4lue", "token:[REDACTED]"],
    ["token:   v4lue", "token:   [REDACTED]"], ["access_token=v4lue", "access_token=[REDACTED]"], ["id_token=v4lue", "id_token=[REDACTED]"],
    ["a=1 token=v4lue", "a=1 token=[REDACTED]"], ["a=1\ttoken=v4lue", "a=1\ttoken=[REDACTED]"], ["a=1,token=v4lue", "a=1,token=[REDACTED]"], ["a=1;token=v4lue", "a=1;token=[REDACTED]"],
    ["token=v4lue,next", "token=[REDACTED],next"], ["token=v4lue;next", "token=[REDACTED];next"], ["token=v4lue next", "token=[REDACTED] next"],
  ])("%j -> %j", (text, expected) => {
    expect(r(text)).toBe(expected);
  });

  test.each(["not_a_token=v4lue", "mytoken=v4lue", "x.password=v4lue", "api~key=v4lue", "token=", "token = v4lue"])("%j stays (mid-identifier, unknown name or no value)", (text) => {
    expect(r(text)).toBe(text);
  });
});

describe("HTTP auth schemes", () => {
  test.each([
    ["Authorization: Bearer abcd~efgh", "Authorization: [REDACTED] [REDACTED]"], ["X-Auth Bearer abcd~efgh", "X-Auth Bearer [REDACTED]"], ["bearer abcd", "bearer [REDACTED]"], ["Token\tab+/=", "Token [REDACTED]"],
    ["Basic   user:pass", "Basic [REDACTED]"], ["x Bearer abcd y", "x Bearer [REDACTED] y"],
  ])("%j -> %j", (text, expected) => {
    expect(r(text)).toBe(expected);
  });

  test.each(["Bearer abc", "Bearerabcd", "xBearer abcd"])("%j stays (too short or not a word boundary)", (text) => {
    expect(r(text)).toBe(text);
  });
});
