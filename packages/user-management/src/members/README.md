# Members

The member principal for `@jini-ai/user-management`: member/tier/subscription/session/challenge records and their repository ports, in-memory repos, the fail-closed content-access resolver, the consent chokepoint, admin writes, sign-in and password flows, the Trash bridge, the agent tool catalog, a capability card, and member-facing mail rendering. Every module is its own leaf subpath (`@jini-ai/user-management/members/<module>`); there is no barrel. For why this package exists and how its entries are laid out, see the [package README](../../README.md).

## Wiring

- **Injected:** `renderEmailForSend`, a field of the `required` argument of `renderMemberAuthMail`. It takes `{ html, values }` and returns `{ subject, html, text }` (any extra fields the host's renderer returns are ignored).
- **Provides:** `renderMemberAuthMail` from `@jini-ai/user-management/members/auth-mail`. It chooses the built-in sign-in or password-reset template and returns `{ subject, html, text }`. It persists nothing, and a renderer error propagates unchanged.
- **Never imports:** `@jini-ai/platform` or any host code. The host passes the renderer in.
- **Injected (members write service):** `MembersWriteServiceDeps` from `members/ports` (assemble it with `buildMembersWriteServiceDeps`). The host passes the repositories, `clock`, `ids`, a positional mailer (`@jini-ai/core/contracts/mail` `PositionalMailer`), `principals`, and optionally `mailStatus`, `origin`, `senderIdentity`, `passwordHasher`, `credentialLifecycle` (core `StorageKernel`'s `transaction`/`lockKey`; password writes refuse without it) and `mailTransport`.
- **Injected (challenge mail transport):** `mailTransport: MembersMailTransport` (`members/ports`) = `{ isDeliveryAvailable(mailer), senderIdentityFor({ mailer }, { senderIdentity? }), renderEmailForSend }`, the host's mail-platform functions. Without it, `requestSignInLink`/`requestPasswordReset`/`prepareMemberChallenge` (`members/member-challenge-request`) refuse with `MemberSignInUnavailableError` before any address lookup.
- **Provides (write path):** `prepareMemberChallenge`, `requestMemberChallenge`, `requestSignInLink`, `requestPasswordReset` from `members/member-challenge-request`, and the grouped `membersWriteService` from `members/write-service`.
- **Injected (Trash bridge):** `trashMember` takes `remove`, core's structural `RemoveEntity` from `@jini-ai/core/contracts/site/plugins-host`. Without it the call refuses.
- **Provides (`./members/repo`):** the SQL repositories, one Kysely query body for every dialect: `new SqlMemberRepo({ kernel, tables })` and likewise `SqlMemberTierRepo`, `SqlMemberSubscriptionRepo`, `SqlMagicLinkTokenRepo`, `SqlMemberConsentRepo`, `SqlMemberExternalIdentityRepo`; `new SqlMemberSessionRepo({ kernel, tables, keepStoredRevocation })`. Database errors propagate; guarded upserts that change no row raise `MemberConflictError`.
- **Injected (SQL repositories):** a schema-free `StorageKernel<Kysely<unknown>, unknown>` (`kernel`, with `transaction`/`lockKey`), the host's table names (`tables: MemberTables`; no default here) and, for sessions, `keepStoredRevocation` (the host's one-way revocation expression for the session upsert). `kysely` is an optional peer: only this subpath needs it.
- **Host-owned, not here:** the concrete database handle and schema, the mail transport functions bound into `mailTransport`, and the assistant tool registrations.
- **Runtime:** `access-resolver`, `member-credentials`, `member-challenge`, `member-challenge-request`, `member-sign-in`, `password-auth` and `write-service` are `node` entries (node:crypto, Argon2, session tokens). The others are universal.

```ts
import { renderMemberAuthMail } from "@jini-ai/user-management/members/auth-mail";
import { renderEmailForSend } from "@jini-ai/platform/mail/email-template";

const { subject, html, text } = renderMemberAuthMail({
  purpose: "signin", // or "password_reset" (no code field)
  link, // absolute link built from trusted origin evidence
  code, // one-time code; defaults to "" when absent
  renderEmailForSend,
});
await mailer.send({ to, from, subject, html, text });
```
