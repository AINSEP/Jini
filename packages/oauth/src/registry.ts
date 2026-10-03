import type { OAuthRequiredArgs, OAuthOptionalArgs, OAuthEmptyArgs } from './args.js';
/** Provider descriptor validation and independent registries. No provider is registered as a module side effect. */
import { assertSafeProviderEndpoint } from "./endpoint-safety.js";
import { OAuthError } from "./errors.js";
import type { OAuthGrantKind, OAuthProviderDescriptor, OAuthUrlGuard } from "./ports.js";
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export function assertValidOAuthProvider({ descriptor, guard }: {
    readonly descriptor: OAuthProviderDescriptor;
    readonly guard: OAuthUrlGuard;
}): void {
    if (!PROVIDER_ID_PATTERN.test(descriptor.providerId)) {
        throw new OAuthError({
            code: "OAUTH_INVALID_REQUEST", message: `'${descriptor.providerId}' is not a valid provider id (lowercase letters, digits and hyphens)`,
            operatorAction: "Choose a provider id made of lowercase letters, digits and hyphens."
        });
    }
    if (descriptor.supportedGrants.length === 0) {
        throw new OAuthError({
            code: "OAUTH_INVALID_REQUEST", message: `provider '${descriptor.providerId}' declares no supported grants`,
            operatorAction: "Declare at least one of the browser-redirect or device-code grants."
        });
    }
    assertSafeProviderEndpoint(descriptor.tokenEndpoint, "token endpoint", guard);
    if (descriptor.supportedGrants.includes("authorization_code")) {
        if (!descriptor.authorizationEndpoint) {
            throw new OAuthError({
                code: "OAUTH_INVALID_REQUEST", message: `provider '${descriptor.providerId}' supports the browser redirect grant but declares no authorization endpoint`,
                operatorAction: "Add this provider's authorization endpoint URL."
            });
        }
        assertSafeProviderEndpoint(descriptor.authorizationEndpoint, "authorization endpoint", guard);
    }
    if (descriptor.supportedGrants.includes("device_code")) {
        if (!descriptor.deviceAuthorizationEndpoint) {
            throw new OAuthError({
                code: "OAUTH_INVALID_REQUEST", message: `provider '${descriptor.providerId}' supports the device grant but declares no device authorization endpoint`,
                operatorAction: "Add this provider's device authorization endpoint URL."
            });
        }
        assertSafeProviderEndpoint(descriptor.deviceAuthorizationEndpoint, "device authorization endpoint", guard);
    }
}
export interface OperatorOAuthProviderInput {
    readonly providerId: string;
    readonly label: string;
    readonly tokenEndpoint: string;
    readonly authorizationEndpoint?: string;
    readonly deviceAuthorizationEndpoint?: string;
    readonly scopes?: readonly string[];
    readonly clientAuth?: OAuthProviderDescriptor["clientAuth"];
}
export function buildOperatorOAuthProvider(requiredArgs: OAuthRequiredArgs<OperatorOAuthProviderInput> & {
    readonly guard: OAuthUrlGuard;
}, optionalArgs: OAuthOptionalArgs<OperatorOAuthProviderInput> = {}): OAuthProviderDescriptor {
    const input = { ...optionalArgs, providerId: requiredArgs.providerId, label: requiredArgs.label, tokenEndpoint: requiredArgs.tokenEndpoint };
    const { guard } = requiredArgs;
    const supportedGrants: OAuthGrantKind[] = [];
    if (input.authorizationEndpoint)
        supportedGrants.push("authorization_code");
    if (input.deviceAuthorizationEndpoint)
        supportedGrants.push("device_code");
    const descriptor: OAuthProviderDescriptor = {
        providerId: input.providerId,
        label: input.label,
        supportedGrants,
        ...(input.authorizationEndpoint === undefined ? {} : { authorizationEndpoint: input.authorizationEndpoint }),
        tokenEndpoint: input.tokenEndpoint,
        ...(input.deviceAuthorizationEndpoint === undefined ? {} : { deviceAuthorizationEndpoint: input.deviceAuthorizationEndpoint }),
        defaultScopes: input.scopes ?? [],
        usesPkce: true,
        clientAuth: input.clientAuth ?? "none",
    };
    assertValidOAuthProvider({
        descriptor: descriptor,
        guard: guard
    });
    return descriptor;
}
/** A new registry starts empty. Returned snapshots cannot mutate its stored configuration. */
export interface OAuthProviderRegistry {
    register(requiredArgs: {
        readonly descriptor: OAuthProviderDescriptor;
    }): void;
    list(requiredArgs: OAuthEmptyArgs): readonly OAuthProviderDescriptor[];
    get(requiredArgs: {
        readonly providerId: string;
    }): OAuthProviderDescriptor;
}
export function createOAuthProviderRegistry(deps: {
    readonly guard: OAuthUrlGuard;
}): OAuthProviderRegistry {
    const providers = new Map<string, OAuthProviderDescriptor>();
    return {
        register({ descriptor }) {
            assertValidOAuthProvider({
                descriptor: descriptor,
                guard: deps.guard
            });
            providers.set(descriptor.providerId, structuredClone(descriptor));
        },
        list(_requiredArgs) { return [...providers.values()].map(item => structuredClone(item)); },
        get({ providerId }) {
            const descriptor = providers.get(providerId);
            if (!descriptor)
                throw new OAuthError({
                    code: 'OAUTH_INVALID_REQUEST', message: `no OAuth provider is registered as '${providerId}'`,
                    operatorAction: "Pick a provider from the list, or define this one's endpoints on the connection."
                });
            return structuredClone(descriptor);
        },
    };
}
