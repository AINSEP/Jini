# DR-001: Secret storage, sessions and credential reset

Status: recorded from existing design; no runtime changes.

## Context

A username/password lookup must not reveal which part failed, and resetting a compromised password is ineffective if old sessions continue validating. Passwords, raw API keys and raw session tokens are secret material.

## Decision

Create a human credential only together with a fresh human principal. Store password hashes and hashes of bearer credentials, never raw secrets. Make login failures constant-shaped for missing, disabled or incorrect credentials. Validate session status and absolute expiry server-side; expiry is not sliding. Password reset uses the same hashing path and revokes all active sessions. Raw newly-issued credentials cross the boundary only at issuance.

## Consequences and current limits

Consumers supply hashing/credential verification and choose current supported session configuration. Disabling a principal takes effect on subsequent session validation. Tool responses must omit password hashes. Expiry and revocation remain enforced before authorization.

## Defect prevented

Binding a new password to an existing privileged principal, username enumeration, persisted bearer-token theft, or password reset leaving an attacker's session usable.

## Source and enforcement

Restated from inherited design and review reasoning. Historical provenance is kept outside the engine. The current behavior contract and local code establish the enforcement boundary; this record adds no runtime behavior.

Evidence: [src/server/auth-service.ts](../../src/server/auth-service.ts), [src/server/admin-crud-service.ts](../../src/server/admin-crud-service.ts).
