# API Security Design Minimums And Resource Limits

## Use When

- the API exposes object identifiers, sensitive properties, role-dependent behavior, or expensive operations
- the API is externally callable or vulnerable to automated abuse
- the contract needs explicit quota, throttling, or resource-consumption rules

## Security Design Minimums

- Define object-level authorization rules for every operation that accepts a user-supplied resource identifier.
- Define function-level authorization rules for privileged or administrative operations.
- Define property-level exposure and write-allowlist rules for request and response bodies. Do not rely on serializers or ORM defaults to choose what is visible or writable.
- Define which fields are omitted, masked, or role-gated when the payload contains sensitive data.
- Define whether the API accepts caller-supplied URLs or remote fetch targets. If it does, describe the SSRF controls.
- Define which flows are vulnerable to high-value automation abuse and what compensating controls exist.

## Resource-Consumption And Abuse Controls

- Choose quota scope intentionally: per-user, per-API-key, per-IP, per-tenant, or per-operation.
- Choose both burst behavior and sustained-rate behavior. They are not the same policy.
- Define the failure response when the limit is exceeded. For HTTP APIs, `429 Too Many Requests` is the normal default.
- If callers are expected to retry after throttling, define `Retry-After` behavior.
- Document which operations are expensive enough to need special quotas or business-flow protection.
- If the project exposes machine-readable limit headers, define them consistently across the surface.

## Design Questions

- Can a caller enumerate or mutate another user's object by guessing an ID?
- Can a caller read or write properties they should not control?
- Can an ordinary user reach an admin or back-office function?
- Can one caller consume disproportionate CPU, storage, bandwidth, or paid downstream actions?
- Can an automated client abuse a business flow even if authentication is valid?

## References

- OWASP Top 10 API Security Risks – 2023: https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- HTTP Semantics (for `429` and `Retry-After` context): https://www.rfc-editor.org/rfc/rfc9110.html
