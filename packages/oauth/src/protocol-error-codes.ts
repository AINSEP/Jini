/** Only recognized protocol codes may enter public text or metadata; identifier syntax is not trust.
 * Registration, device authorization and callbacks share this vocabulary. Token requests retain
 * their narrower endpoint-specific set. No provider value extends either allowlist. */
export const OAUTH_PROTOCOL_ERROR_CODES: ReadonlySet<string> = new Set([
'invalid_request', 'unauthorized_client', 'access_denied', 'unsupported_response_type',
    'invalid_scope', 'server_error', 'temporarily_unavailable',
    'invalid_grant', 'unsupported_grant_type', 'invalid_target', 'authorization_pending',
    'slow_down', 'expired_token', 'invalid_dpop_proof', 'use_dpop_nonce',
    'invalid_redirect_uri', 'invalid_client_metadata', 'invalid_software_statement', 'unapproved_software_statement',
    'invalid_client',
]);
