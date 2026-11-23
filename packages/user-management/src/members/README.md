# Members

Member-facing mail rendering for `@jini-ai/user-management`. For why this package exists and how its entries are laid out, see the [package README](../../README.md).

## Wiring

- **Injected:** `renderEmailForSend`, a field of the `required` argument of `renderMemberAuthMail`. It takes `{ html, values }` and returns `{ subject, html, text }` (any extra fields the host's renderer returns are ignored).
- **Provides:** `renderMemberAuthMail` from `@jini-ai/user-management/members/auth-mail`. It chooses the built-in sign-in or password-reset template and returns `{ subject, html, text }`. It persists nothing, and a renderer error propagates unchanged.
- **Never imports:** `@jini-ai/platform` or any host code. The host passes the renderer in.

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
