/** Neutral OAuth copy; hosts may replace these messages without changing protocol identity. */
import type { OAuthMessages } from '@jini-ai/core/contracts/oauth';
export type { OAuthMessages } from '@jini-ai/core/contracts/oauth';
export const defaultOAuthMessages = {
    reservedAuthorizationParameter: ({ parameter }: { readonly parameter: string }): string =>
        `'${parameter}' is set by the OAuth client and cannot be overridden for this provider`,
    reservedAuthorizationParameterAction: "Remove that parameter from the provider's extra authorization parameters.",
    registrationRejectedAction: "The authorization server refused to register the client — check its OAuth requirements, or supply a client id by hand.",
} satisfies OAuthMessages;

