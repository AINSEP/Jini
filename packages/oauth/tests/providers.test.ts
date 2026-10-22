import { fixtureGuard, fixtureRegistry } from "./fixtures.js";
import assert from "node:assert/strict";
import { test } from "vitest";
import { assertValidOAuthProvider, buildOperatorOAuthProvider } from "../src/index.js";
import type { OAuthProviderDescriptor } from "../src/ports.js";
function descriptor(overrides: Partial<OAuthProviderDescriptor> = {}): OAuthProviderDescriptor {
    return {
        providerId: "b05-provider", label: "Fixture provider", supportedGrants: ["authorization_code", "device_code"],
        tokenEndpoint: "https://auth.example.com/token", authorizationEndpoint: "https://auth.example.com/authorize",
        deviceAuthorizationEndpoint: "https://auth.example.com/device", defaultScopes: ["read"], usesPkce: true, clientAuth: "none",
        ...overrides,
    };
}
// F4.3/F4.4: change only the named invalid field; don't let missing endpoints mask id validation.
for (const providerId of ["", "Uppercase", "-leading", "has space", "a".repeat(65)]) {
    test(`provider id validation rejects ${JSON.stringify(providerId)}`, () => {
        assert.throws(() => assertValidOAuthProvider({
            descriptor: descriptor({ providerId }),
            guard: fixtureGuard
        }), {
            code: "OAUTH_INVALID_REQUEST",
            message: `'${providerId}' is not a valid provider id (lowercase letters, digits and hyphens)`,
        });
    });
}
for (const [overrides, message] of [
    [{ supportedGrants: [] }, "provider 'b05-provider' declares no supported grants"],
    [{ authorizationEndpoint: undefined }, "provider 'b05-provider' supports the browser redirect grant but declares no authorization endpoint"],
    [{ deviceAuthorizationEndpoint: undefined }, "provider 'b05-provider' supports the device grant but declares no device authorization endpoint"],
] as const) {
    test(`descriptor validation: ${message}`, () => {
        assert.throws(() => assertValidOAuthProvider({
            descriptor: descriptor(overrides),
            guard: fixtureGuard
        }), { code: "OAUTH_INVALID_REQUEST", message });
    });
}
for (const [field, label] of [
    ["tokenEndpoint", "token endpoint"], ["authorizationEndpoint", "authorization endpoint"],
    ["deviceAuthorizationEndpoint", "device authorization endpoint"],
] as const) {
    test(`registration refuses an unsafe ${field} before admitting its id`, () => {
        const invalid = descriptor({ providerId: `b05-invalid-${field.toLowerCase()}`, [field]: "https://10.1.2.3/oauth" });
        assert.throws(() => fixtureRegistry.register({
            descriptor: invalid
        }), {
            code: "OAUTH_UNSAFE_ENDPOINT", message: `${label}: provider endpoint resolves to an internal address, which is not allowed`,
        });
        assert.throws(() => fixtureRegistry.get({
            providerId: invalid.providerId
        }), { code: "OAUTH_INVALID_REQUEST" });
    });
}
test("operator descriptors derive both grants from endpoints, preserve overrides and force PKCE", () => {
    assert.deepEqual(buildOperatorOAuthProvider({
        guard: fixtureGuard,
        providerId: "b05-operator", label: "Operator provider", tokenEndpoint: "https://auth.example.com/token"
    }, {
        authorizationEndpoint: "https://auth.example.com/authorize", deviceAuthorizationEndpoint: "https://auth.example.com/device",
        scopes: ["write", "offline_access"], clientAuth: "client_secret_post"
    }), {
        providerId: "b05-operator", label: "Operator provider", tokenEndpoint: "https://auth.example.com/token",
        authorizationEndpoint: "https://auth.example.com/authorize", deviceAuthorizationEndpoint: "https://auth.example.com/device",
        supportedGrants: ["authorization_code", "device_code"], defaultScopes: ["write", "offline_access"],
        usesPkce: true, clientAuth: "client_secret_post",
    });
});
for (const [field, grant] of [["authorizationEndpoint", "authorization_code"], ["deviceAuthorizationEndpoint", "device_code"]] as const) {
    test(`a single operator endpoint enables only ${grant} and defaults scopes and client auth`, () => {
        assert.deepEqual(buildOperatorOAuthProvider({
            guard: fixtureGuard,
            providerId: "b05-single", label: "Single grant",
            tokenEndpoint: "https://auth.example.com/token"
        }, { [field]: "https://auth.example.com/flow" }), {
            providerId: "b05-single", label: "Single grant", tokenEndpoint: "https://auth.example.com/token",
            [field]: "https://auth.example.com/flow", supportedGrants: [grant], defaultScopes: [], usesPkce: true, clientAuth: "none",
        });
    });
}
test("operator configuration with no flow endpoints is refused instead of inventing a grant", () => {
    assert.throws(() => buildOperatorOAuthProvider({
        guard: fixtureGuard,
        providerId: "b05-no-flow", label: "No flow", tokenEndpoint: "https://auth.example.com/token"
    }), {
        code: "OAUTH_INVALID_REQUEST", message: "provider 'b05-no-flow' declares no supported grants",
    });
});
// F1.6/F7.5: all registry mutations belong to this test; read back by id and check replacement order.
test("registry reads its shipped example, replaces a descriptor by id and refuses an invalid replacement", () => {
    assert.deepEqual(fixtureRegistry.get({
        providerId: "example-oidc"
    }), {
        providerId: "example-oidc", label: "Example OIDC-shaped provider", supportedGrants: ["authorization_code", "device_code"],
        authorizationEndpoint: "https://oauth.example.com/authorize", tokenEndpoint: "https://oauth.example.com/oauth/token",
        deviceAuthorizationEndpoint: "https://oauth.example.com/oauth/device/code", defaultScopes: [], usesPkce: true, clientAuth: "none",
    });
    const first = descriptor({ providerId: "b05-registry-a" });
    const second = descriptor({ providerId: "b05-registry-b", label: "Second" });
    fixtureRegistry.register({
        descriptor: first
    });
    fixtureRegistry.register({
        descriptor: second
    });
    const replacement = descriptor({ providerId: "b05-registry-a", tokenEndpoint: "https://new.example.com/token", label: "Moved" });
    fixtureRegistry.register({
        descriptor: replacement
    });
    assert.deepEqual(fixtureRegistry.get({
        providerId: "b05-registry-a"
    }), replacement);
    assert.deepEqual(fixtureRegistry.list({}).filter((item) => item.providerId.startsWith("b05-registry-")), [replacement, second]);
    assert.throws(() => fixtureRegistry.register({
        descriptor: { ...replacement, supportedGrants: [] }
    }), { code: "OAUTH_INVALID_REQUEST" });
    assert.deepEqual(fixtureRegistry.get({
        providerId: "b05-registry-a"
    }), replacement);
    const snapshot = fixtureRegistry.list({}) as OAuthProviderDescriptor[];
    snapshot.length = 0;
    assert.deepEqual(fixtureRegistry.get({
        providerId: "b05-registry-b"
    }), second);
    assert.throws(() => fixtureRegistry.get({
        providerId: "b05-unregistered"
    }), {
        code: "OAUTH_INVALID_REQUEST", message: "no OAuth provider is registered as 'b05-unregistered'",
        operatorAction: "Pick a provider from the list, or define this one's endpoints on the connection.",
    });
});
