---
"@jini-ai/core": patch
---

Add three host-neutral type contracts, each an additive copy of declarations that stay in their owning package until the paired cutover. `./contracts/site/secrets-credential-token` (`CredentialTokenHint`, `CredentialConnection`) copies `@jini-ai/platform/secrets/credential-token`'s types. `./contracts/site/user-management` (`PrincipalRecord`, `UserRecord`, `RoleRecord`, `PolicyRecord`, the identity repository ports, `IdentityRepos`, `PasswordHasherPort` and their structural closure) copies `@jini-ai/user-management`'s record and port types. `./contracts/site/agentic-core` (`GuideTopic`, `PagePublication`, `PublishedPageAction`, `PublishedPageElement` and their closure) copies `@jini-ai/agentic/core`'s types.
