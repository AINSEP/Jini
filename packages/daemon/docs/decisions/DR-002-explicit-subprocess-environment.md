# DR-002: Agent subprocess environment is an explicit allowlist

Status: recorded from the existing local incident notes; no runtime changes.

## Context

Forwarding the whole host environment leaks unrelated credentials and ambient privileges. An over-narrow baseline can also prevent an authenticated CLI from finding its existing credential state even when HOME is present.

## Decision

Build subprocess environment from a fixed baseline of named host keys plus explicitly authorized overrides, never by copying process.env as a bag. Preserve the USER key where an authenticated CLI needs it to resolve its login context. Do not forward provider-specific variables merely to guess at an authentication failure.

## Consequences

The observed authentication failure was isolated by adding keys individually: USER restored login, while the broader provider-variable family did not. This evidence justifies one explicit baseline key, not a permissive inheritance branch. Hosts still own secrets, override policy and platform-specific required names.

## Defect prevented

Unrelated secrets inherited by child agents, or a legitimately authenticated CLI failing solely because its user identity is absent.

## Source and enforcement

The inherited local investigation was consulted. Historical archive locations remain outside this record. The original application decision archive was not recovered; this record preserves the limitation.

Evidence: [src/agent-executor.ts](../../src/agent-executor.ts).
