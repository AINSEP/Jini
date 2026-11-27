import { describe, expect, it } from "vitest";

import type { AdminExecutionCredential } from "@jini-ai/core/contracts/site/api-ai-assistant-api-types";
import { FakeRequestError as ApiError, isFakeRequestError } from "./request-error.fakes.js";
import {
  STORED_KEY_NO_ENDPOINT_COPY,
  STORED_KEY_OTHER_PROVIDER_COPY,
  createProbeErrorDescribers,
  hasUsableKey,
  storedKeyBlocksProbe,
  storedKeyIsForOtherEndpoint,
} from "../stored-credential-endpoint.js";

const { createProbeErrorDescriber, describeProbeError } = createProbeErrorDescribers({ isRequestError: isFakeRequestError });

/**
 * @file The stored-key endpoint rules, shared by the host's visitor key screen and its admin key screen.
 * The visitor screen's behavior through these rules is covered by the host. This file pins the rules
 * against the ADMIN credential's view shape, the second caller, and the server's exact admin-branch text.
 */

const GOOGLE = "https://generativelanguage.googleapis.com";
const OPENAI = "https://api.openai.com/v1";

function adminView(overrides: Partial<AdminExecutionCredential> = {}): AdminExecutionCredential {
  return {
    isSet: true,
    masked: "••••mw4w",
    protocol: "google",
    providerId: "google",
    baseUrl: GOOGLE,
    model: "gemini-flash-latest",
    maxTokens: null,
    updatedAt: "2026-09-13T00:00:00.000Z",
    ...overrides,
  };
}

describe("storedKeyIsForOtherEndpoint — admin credential view", () => {
  it("is true only when a key is stored for a different endpoint than the form's", () => {
    expect(storedKeyIsForOtherEndpoint({ stored: adminView(), baseUrl: OPENAI })).toBe(true);
    expect(storedKeyIsForOtherEndpoint({ stored: adminView(), baseUrl: GOOGLE })).toBe(false);
    expect(storedKeyIsForOtherEndpoint({ stored: adminView({ isSet: false }), baseUrl: OPENAI })).toBe(false);
    expect(storedKeyIsForOtherEndpoint({ stored: null, baseUrl: OPENAI })).toBe(false);
  });

  it("treats an unknown stored endpoint as not provably another one", () => {
    expect(storedKeyIsForOtherEndpoint({ stored: adminView({ baseUrl: null }), baseUrl: OPENAI })).toBe(false);
    expect(storedKeyIsForOtherEndpoint({ stored: adminView({ baseUrl: "   " }), baseUrl: OPENAI })).toBe(false);
  });
});

describe("storedKeyBlocksProbe", () => {
  it.each([
    { name: "nothing typed, key stored for another endpoint", apiKey: "", stored: adminView(), baseUrl: OPENAI, blocked: true },
    { name: "whitespace typed counts as nothing", apiKey: "   ", stored: adminView(), baseUrl: OPENAI, blocked: true },
    { name: "a typed key goes to the form's endpoint", apiKey: "sk-typed", stored: adminView(), baseUrl: OPENAI, blocked: false },
    { name: "the stored key at its own endpoint", apiKey: "", stored: adminView(), baseUrl: GOOGLE, blocked: false },
    { name: "nothing stored", apiKey: "", stored: adminView({ isSet: false }), baseUrl: OPENAI, blocked: false },
    { name: "stored key with no saved endpoint (the server answers)", apiKey: "", stored: adminView({ baseUrl: null }), baseUrl: OPENAI, blocked: false },
    { name: "not hydrated yet (the server answers)", apiKey: "", stored: null, baseUrl: OPENAI, blocked: false },
  ])("$name -> blocked=$blocked", ({ apiKey, stored, baseUrl, blocked }) => {
    expect(storedKeyBlocksProbe({ apiKey, stored, baseUrl })).toBe(blocked);
  });

  it("is exactly the case hasUsableKey rules out for a stored key", () => {
    // The two must never both say "go": a blocked probe has no usable key.
    expect(storedKeyBlocksProbe({ apiKey: "", stored: adminView(), baseUrl: OPENAI })).toBe(true);
    expect(hasUsableKey({ apiKey: "", stored: adminView(), baseUrl: OPENAI })).toBe(false);
    expect(hasUsableKey({ apiKey: "", stored: adminView(), baseUrl: GOOGLE })).toBe(true);
  });
});

describe("describeProbeError — the admin branch's endpoint-pin text", () => {
  it("replaces the server's MISMATCH refusal (owner screenshot 29) with the plain ask", () => {
    const refusal = new ApiError(
      { message: `the admin execution credential is saved for '${GOOGLE}' and cannot be probed against '${OPENAI}' — save the new endpoint first, or supply an apiKey for it in this request`,
      status: 400 },
      { code: "STORED_CREDENTIAL_ENDPOINT_MISMATCH" },
    );
    expect(describeProbeError({ e: refusal, fallback: "fallback" })).toBe(STORED_KEY_OTHER_PROVIDER_COPY);
  });

  it("replaces the server's UNSET refusal with plain language", () => {
    const refusal = new ApiError(
      { message: "the admin execution credential has no saved endpoint, so this probe has no approved destination — save a base URL for the credential first, or supply an apiKey in this request",
      status: 400 },
      { code: "STORED_CREDENTIAL_ENDPOINT_UNSET" },
    );
    expect(describeProbeError({ e: refusal, fallback: "fallback" })).toBe(STORED_KEY_NO_ENDPOINT_COPY);
  });

  it("keeps any other error's own message, and the fallback for a non-Error", () => {
    expect(describeProbeError({ e: new Error("API key not valid"), fallback: "fallback" })).toBe("API key not valid");
    expect(describeProbeError({ e: "boom", fallback: "fallback" })).toBe("fallback");
  });

  it("reads the code only from the host's request error, through the injected guard", () => {
    const lookalike = Object.assign(new Error("not the host's error"), { code: "STORED_CREDENTIAL_ENDPOINT_MISMATCH" });
    expect(describeProbeError({ e: lookalike, fallback: "fallback" })).toBe("not the host's error");
  });
});

describe("createProbeErrorDescriber — ExecutionTab's describeProbeError, in a screen's language", () => {
  const spanish = (key: string) =>
    key === STORED_KEY_OTHER_PROVIDER_COPY ? "Tu clave guardada es de otro proveedor. Pega una clave para este." : key;

  it("translates the plain-language copy that replaces an endpoint-pin refusal", () => {
    const refusal = new ApiError({ message: "saved for another endpoint", status: 400 }, { code: "STORED_CREDENTIAL_ENDPOINT_MISMATCH" });
    expect(createProbeErrorDescriber({ t: spanish })(refusal)).toBe("Tu clave guardada es de otro proveedor. Pega una clave para este.");
  });

  it("keeps a provider's own message, and words a non-Error throw by its string form", () => {
    expect(createProbeErrorDescriber({ t: spanish })(new Error("API key not valid"))).toBe("API key not valid");
    expect(createProbeErrorDescriber({ t: spanish })("boom")).toBe("boom");
  });
});

it("ignores endpoint metadata when presence is false, but accepts a newly typed key", () => {
  const stored = { isSet: false, baseUrl: GOOGLE };
  const empty = { apiKey: "", stored, baseUrl: OPENAI };
  expect(storedKeyIsForOtherEndpoint(empty)).toBe(false);
  expect(storedKeyBlocksProbe(empty)).toBe(false);
  expect(hasUsableKey(empty)).toBe(false);
  expect(hasUsableKey({ ...empty, apiKey: "fixture" })).toBe(true);
});
