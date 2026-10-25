import { IntegrationError } from "../argument-error.js";

// Request validation is distinct from validation of stored credentials, which belongs to the resolver.
/** Shared refusal identity lets composed callers classify validation without loading the executor. */
export class CredentialedRequestValidationError extends IntegrationError {}
