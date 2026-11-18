/**
 * @module redact-url-params
 *
 * Which URL query and fragment parameter NAMES carry a credential. Pure vocabulary, no I/O, no host state.
 */

// A secret word must END a name segment (split at . _ - or the name's end): api_key, apiKey,
// authtoken, X-Amz-Signature and custom.Token-value are masked, while author, keyword, design,
// signup and page stay readable. Names that merely end in a secret word (zipcode, error_code,
// monkey) are masked too; over-masking a URL value is the cheaper failure. Empty values stay.
// Match through a trailing fragment; field separators (&/;), quotes, parentheses or whitespace end it.
// Both name runs are bounded so a long separator-free run costs linear time, not quadratic.
// `code` is deliberately not a word: postal, promo and error codes (zipcode, promo_code) end in it and are
// not credentials. Only exact names that carry a credential (`code`, an OAuth authorization code; the PKCE
// verifier; one-time login and verification codes) are masked, each as a whole name.
const URL_SECRET_WORDS = 'token|key|secret|signature|sig|password|passwd|pwd|auth|authorization|credential';
// The set of exact code names above (also activation, reset, invite, ...): not "anything ending in code": zipcode, promo_code and error_code are public values.
const URL_CODE_NAMES = 'code_verifier|code|otp|totp|(?:activation|authorization|auth|verification|verify|confirmation|confirm|login|signin|session|device|'
  + 'security|access|reset|recovery|invite|invitation|magic|pairing|oauth|sms|mfa|otp|two[_.-]?factor|one[_.-]?time)[_.-]?code';
export const URL_SECRET_PARAM_RE = new RegExp(
  `[?&#;]((?:${URL_CODE_NAMES})(?==)|[\\w.-]{0,128}?(?:${URL_SECRET_WORDS})s?(?=[._=-])[\\w.-]{0,128})=[^&;\\s"'<>()]+`,
  'gi',
);
