# Tokens, scopes, and permission boundaries

## Where the token lives, and why you never see it

Open `credential_save {kind:"plugin-provider",target:"github"}` for the plugin’s own GitHub card. It saves label `github` and base URL `https://api.github.com`, with the token sealed server-side. Existing rows can still be rotated by their exact saved label.

You name the **label**. The server resolves the credential and injects the real `Authorization`
header itself. The token never appears in a tool's input, in a tool's output, or anywhere in your
context.

To discover what is saved, call `content_read.custom_credential` with `{}`. It returns
each credential's label, category, base URL, and additional hosts — never a token, and never a
saved username. An empty list is the signal to ask a human to save one, not to look for another
way in.

Two headers you must never set on `custom_credential_make_request`: `Authorization` and `Cookie`
(also `Host` and `Proxy-Authorization`). The server injects the real one, and a call trying to set
any of these is refused.

---

## The host allowlist is a feature

Every URL you pass must have a host on that credential's own saved list — its base URL plus any
saved additional hosts. Anything else is refused **before any request is sent**, and the error
names which hosts *are* allowed.

This is the property that makes an agent-held credential safe: the human decided once, at save
time, which origins this token may ever reach. Do not try alternate hosts to find one that works.
Read the error, use a named host, or ask.

The same policy follows **zero redirects**. A GitHub endpoint that answers with a 302 to an
object-store host (the Actions job-logs endpoint is the one you will actually hit) simply ends
there. See `actions.md`.

---

## Repository secrets are the human's step. Always.

Writing a GitHub Actions secret through the API requires encrypting the value against the
repository's public key — which requires **holding the plaintext value**, in your context, to
encrypt it.

That is the failure mode the entire credential design exists to prevent. It is not a shortcut you
are being denied; it is the thing that must not happen.

So you never:

- call `PUT /repos/{owner}/{repo}/actions/secrets/{name}`,
- fetch `GET /repos/{owner}/{repo}/actions/secrets/public-key` in order to encrypt something,
- ask a human to paste a token into chat so you can set it for them,
- or accept one they volunteer. If a secret appears in the conversation anyway, do not use it, do
  not repeat it, and tell them to rotate it.

You hand them this instead:

> **Settings → Secrets and variables → Actions → New repository secret** in `<owner>/<repo>`.
> Name it exactly `<SECRET_NAME>`. Paste only the value — do not commit it anywhere, and do not
> paste it into this chat.

Then **wait for confirmation before dispatching anything that needs it.** A run that starts without
its secret fails on the runner in a way that reads like a config problem, and you will spend the
next twenty minutes debugging the wrong thing.

What you *may* do: **list secret names.** `GET /repos/{owner}/{repo}/actions/secrets` returns names
and timestamps and never a value. It is the honest way to verify a human's "I set it" without
asking them twice, and it catches the common typo of a name that does not match the workflow's
`${{ secrets.… }}` reference.

Organization secrets, environment secrets, and Dependabot secrets are all covered by the same rule.

---

## Scopes, and what a 403 actually means

**A 403 on an org-wide or account-wide listing endpoint is a normal permission boundary for an
app-scoped or repo-scoped token. It is not a broken credential.**

Misreading this cost a full debugging session once already, and nearly got a perfectly good
credential replaced. A token scoped to one repository can fully manage that repository and still
403 on any call that enumerates an organization or an account.

The rule that follows: **prefer per-resource endpoints over listings.** Resolve `owner/repo` from
the human, from the conversation, or from a file already in the repository — never by listing an
org and searching it. If you have no identifier, ask. One question beats one wrong diagnosis.

Roughly what each capability needs, so you can say something useful when a 403 does appear:

| To do this | The token needs |
|---|---|
| Read a repository, its contents, its branches | read access to that repository |
| Write files, create commits, update a ref | **write** access to repository contents |
| Write anything under `.github/workflows/` | contents write **plus** workflow permission — a token without it is refused specifically on workflow paths and nowhere else, which is confusing if you do not know to look for it |
| Dispatch a workflow, read runs and jobs | Actions permission (read for following, write for dispatching) |
| Read secret **names** | Actions/secrets read |

The workflow-permission row is the one that surprises people: a write that succeeds for every other
path and fails only for `.github/workflows/…` is a scope problem, not a path problem.

---

## Reading `authDiagnostic`

A 401 or 403 response from `custom_credential_make_request` carries an `authDiagnostic` object
alongside GitHub's untouched `bodyText`. **Read it before reporting a bare failure.**

- On a **401** where the scheme sent was `Bearer` and no username is stored, `hint` names the one
  narrow guess the system is willing to make: this provider may need HTTP Basic with a saved
  username. Treat it as a hypothesis. Ask the human for the username, save it with
  `custom_credential_set_username`, retry **once**. Never invent a username, and never loop past
  one retry.
- When a username is already stored, there is no hint — the cause is something else and unguessable.
- On a **403 there is no hint at all**, deliberately. 403 covers scopes, org policy, rate limits,
  and missing headers; a Basic-auth guess there would be a false lead rather than a hedge. Report
  the failure and GitHub's own message plainly.

If you suspect the credential itself, `custom_credential_verify` checks one saved credential
against its own API, live, and reports `valid` / `invalid` / `unreachable`. **`unreachable` does
not mean the credential is bad** — it is a network failure. Do not tell a human to replace a token
over a DNS error.

---

## Rate limits

Every response carries `x-ratelimit-remaining` and `x-ratelimit-reset`. **A 403 with
`x-ratelimit-remaining: 0` is a rate limit**, and saying "your token is broken" when a human is
merely throttled is an avoidable, expensive mistake. Read the header before you diagnose.

Polling an Actions run is the only thing here that makes a meaningful number of calls — which is
the practical reason to leave a real gap between polls.

---

## The rule under all of the above

**Never print, echo, or reconstruct a secret.** Not in a file you write, not in a commit message,
not in a summary of what the human just did, not partially masked. Nothing in this plugin's
procedures requires you to hold one, which is what makes that rule cheap to keep and inexcusable to
break.
