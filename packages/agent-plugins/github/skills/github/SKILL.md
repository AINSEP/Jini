---
name: github
description: Work against a GitHub repository through this workspace's own saved credentials — write and update files in one atomic commit, dispatch and follow a GitHub Actions run, read a failed run's logs, commit the site's rendered static export, back up the site itself to a private repository, deploy the host's server through its GitHub Actions deploy workflow — with no git, no gh CLI, and no token ever passing through the assistant. Encodes the rules generic GitHub knowledge gets wrong here: a 204 dispatch means queued and never deployed, a workflow only fires on the branch its own trigger names, a repository secret is always the human's step, a 403 on an org-wide listing is a normal app-scoped-token boundary rather than a broken credential, and editing an existing file means diffing the MODIFIED files and not only the added and deleted ones.
---

# GitHub, through the site's saved credentials

## Connection card

Choose the card yourself from its `usedFor` list. Reuse a saved key or working sign-in for that
task. Never offer a replacement unless the person asks.

Open **Connect GitHub** through the secure connection card; it saves the API credential labelled `github`. For `github-source-control`, open the secure connection card; it saves through the source-control owner. For Pages hosting use the `github-pages` plugin’s card. These remain distinct save contracts. Each card names the repository permissions and links to fine-grained token creation. Never collect a token in chat.

## Scope

This plugin owns **GitHub**: repositories, commits, branches, Actions, and the token and permission
semantics behind all of them. It owns nothing else.

It knows nothing about where a build is *deployed to*. Fly, Render, Railway, a container registry,
a VPS — none of that is here, and a rule that only makes sense for one host does not belong here.
A host-specific procedure (the bundled `fly` plugin's server deploy is the one that ships
today) is expected to describe its own hosting rules and then hand the GitHub half to this
document. That split is deliberate: every
skill of every enabled plugin reaches the assistant's prompt at the same time, so the same rule
written twice, slightly differently, becomes a contradiction rather than emphasis.

---

## Which job is this? Source control or a deploy

Decide this first; the two jobs use different tools.

- **Source control and backup** — write files into a repository, commit the site's rendered export,
  back up the site, or start and follow any other workflow: the tools in the rest of this document.
- **Deploying the host's server with GitHub Actions** — use the deployment tools with platform
  `github-actions`, never a hand-built dispatch. Call `deployment_ops_deploy` with target
  `owner/repo` and the branch or tag. It resolves the ref to a full SHA and dispatches the host's
  deploy workflow pinned to that commit; the host guidance describes that workflow's own inputs and
  refusals. Say which commit will build. A started deploy is queued, never deployed: follow it with
  `deployment_ops_wait` (pass the returned runId) until `finished`, then check the live site. Use
  `deployment_ops_status` and `deployment_ops_logs` to find a failed job and step. Never retry a
  deploy whose connection dropped before checking `deployment_ops_status`. The saved
  `api.github.com` credential needs Actions write. Setting up the server host itself (its config,
  volume and secrets) is the host plugin's job, not this one's.

---

## What you are allowed to use, and what does not exist here

Two native host tools do everything below. **This plugin ships no MCP server and adds no tool.**
Its deploy half is only the `github-actions` platform behind the core `deployment_ops_*` tools.

| Tool | What it is |
|---|---|
| `custom_credential_make_request` | One authenticated `GET`/`POST`/`PUT`/`PATCH`/`DELETE` to GitHub's REST API through a saved credential. You pass a `label` and a **full absolute URL**; the server injects the real `Authorization` header. |
| `custom_credential_write_files` | A human-confirmed, atomic write of 1–25 named files onto an **existing** branch (blob → tree → commit → non-force ref update). |

Two more exist for a narrower job — `source_control_get_capabilities` and
`source_control_execute_commit` — and they are **not** general-purpose repo writes. See
`references/source-control.md` before you reach for either; the distinction between them and
`custom_credential_write_files` is the single easiest thing to get wrong in this document.

And two back up the site itself — `site_backup_plan`, then `site_backup_push` — into a private
repository. See `references/site-backup.md`.

There is no `git`, no `gh`, and no shell path. **Never shell out to `curl`, `wget`, or `git` to
talk to GitHub.** A raw shell request bypasses the saved-credential store entirely and either
fails outright or forces a token into your context to make it work — which is exactly the thing
the store exists to prevent.

### You do not choose the host

`custom_credential_make_request` refuses any URL whose host is not on that credential's own saved
allowlist (its base URL plus any saved additional hosts), **before any request is sent**. This is
not a limitation to route around. It is the property that makes an agent-held credential safe at
all: the human decided, once, at save time, which origins this token may ever reach.

So: build every URL from `https://api.github.com` (or whatever base the credential actually
saved — GitHub Enterprise has its own). If a call is refused, the error names the hosts that
*are* allowed. Read it and use one; do not try a different host to see what sticks.

To find the label, list the saved credential labels. It returns each saved
credential's label, category, base URL and additional hosts — never a token. A workspace with a
credential labelled `github` is the expected case, but do not assume the label: read it.

---

## The rules

These rules prevent credential and repository mistakes.

### Rule 1 — A repository secret is ALWAYS the human's step. This is not negotiable.

Creating or updating a GitHub Actions secret through the API requires encrypting the value against
the repository's own public key. To do that, **the secret value would have to pass through your
context** — you would have to hold the plaintext token in order to encrypt it.

That is not an inconvenience on the way to a shortcut. **It is the failure mode.** The entire
saved-credential design exists so a secret never reaches the assistant, and a step that requires
holding one is a step the assistant does not perform, no matter how much friction it saves.

So you never call `PUT /repos/{owner}/{repo}/actions/secrets/{name}`, you never fetch
`.../actions/secrets/public-key` in order to encrypt something, and you never ask a human to paste
a token into the chat so you can do it for them. You hand them the exact instruction instead:

> Go to **Settings → Secrets and variables → Actions → New repository secret** in
> `<owner>/<repo>`. Name it exactly `<SECRET_NAME>`. Paste only the value — do not commit it
> anywhere, and do not paste it into this chat.

Then **wait for them to confirm.** Do not dispatch a workflow that needs a secret before they have
said it is set: the run fails on the runner in a way that reads like a config problem rather than a
missing secret, and you will debug the wrong thing.

The same rule covers environment secrets, organization secrets, and Dependabot secrets. Reading
which secret *names* exist (`GET .../actions/secrets`) is fine — GitHub never returns a value — and
is a genuinely useful way to confirm a human's "I set it" without asking twice.

### Rule 2 — A 204 from a workflow dispatch means QUEUED. It does not mean anything ran.

`POST /repos/{owner}/{repo}/actions/workflows/{file}/dispatches` returns **204 with an empty body**
on success. All that 204 asserts is that GitHub accepted the request.

Nothing has built. Nothing has deployed. Nothing has even started — the run may not appear in the
runs list for a second or two, and it may sit `queued` behind another run after that.

**Never report success at the dispatch.** Report "queued", then follow the run
(`references/actions.md` has the poll loop and how to read a failure). Say what you actually
observed, at the stage you observed it.

### Rule 3 — A workflow only fires on the branch its own trigger names.

A workflow's `on: push:` names branches. A push to any other branch does **nothing** — no run, no
error, no warning. The same is true of `workflow_dispatch`: the `ref` you dispatch against must be
a branch the workflow file exists on, and GitHub reads the workflow definition *from that ref*.

Two failure shapes follow, and both look like "the workflow is broken":

- You wrote the workflow onto a branch its own `push:` trigger does not list, pushed, and nothing
  happened. Nothing is broken; the trigger simply did not match.
- You dispatched against a `ref` where the workflow file does not exist yet. GitHub returns
  **422**, not 404, and the message is about the workflow rather than the ref.

So before you push or dispatch: read the workflow's own trigger, and name the branch explicitly.
Never assume `main`; a repository's default branch is a fact to look up
(`GET /repos/{owner}/{repo}` → `default_branch`), not a convention to rely on.

### Rule 4 — When you EDIT an existing file, diff the MODIFIED files. Not just added and deleted.

This one has already cost two silent production failures.

A history force-push once rewrote a workflow file and dropped two `--build-arg` flags from it. A
review that looked at which files were **added** and which were **deleted** saw nothing wrong —
the file was neither. It was modified, and the modification quietly removed two load-bearing lines.
Two deploys failed before anyone connected the two facts.

`custom_credential_write_files` replaces a file's **entire content**; it does not patch. So when
you are updating a file that already exists:

1. Read the current content first (`GET /repos/{owner}/{repo}/contents/{path}?ref={branch}`,
   which returns base64, or the raw blob via the Git Data API).
2. Produce the new content from what is actually there — never from memory, and never from a
   template you assume matches.
3. Before writing, state what changed, **line by line, including every line you removed.**

The confirmation dialog names each path as a create or an update, resolved against the branch's
real current state. An "update" label is your cue that a full-content replacement is about to
happen and that everything you did not carry forward is about to be gone.

### Rule 5 — A 403 on an org-wide or account-wide listing is a permission BOUNDARY, not a broken credential.

Many real tokens are scoped to a single repository or a single app. Such a token can fully manage
its own resource and still **403 on any call that enumerates an organization or an account** — the
org's repositories, the account's installations, every-app-in-the-org listings.

That 403 looks *exactly* like an expired, revoked, or wrong-scoped credential. It is neither.
Misreading it can cause a working credential to be
replaced.

The rule: **prefer per-resource endpoints over listings.** If you know the `owner/repo`, ask about
that repository directly. Resolve the identifier from the human, from a file already in the repo,
or from the conversation — never by listing the org and searching it. If you genuinely have no
identifier, ask rather than guess the cause.

If a call does come back 401 or 403, **read the `authDiagnostic` field on the result before
reporting a bare failure**, follow the remedy it names, and retry at most **once**. There is
deliberately no diagnostic hint on a 403 at all — 403 covers scopes, policy, and missing headers,
so any guess would be a false lead. Report the failure and GitHub's own message plainly.

### Rule 6 — Never print, echo, or reconstruct a secret.

Not in a file you write, not in a commit message, not in a summary of what the human just did, not
"redacted" with the first four characters showing. If a secret value must exist, the human types
it — into GitHub's own secret form, or into the host's credential form's masked field.

Nothing in this plugin's procedures requires you to see one, which is what makes this rule cheap to
keep.

---

## Choosing the right tool

Answer one question first: **is this app source, or is it the site's rendered output?**

| You want to… | Use |
|---|---|
| Add or update named files — a config file, a workflow, a script, a Dockerfile | `custom_credential_write_files` |
| Read anything at all from GitHub | `custom_credential_make_request` (`GET`) |
| Deploy the host's server through its deploy workflow | `deployment_ops_deploy` with platform `github-actions` — see "Which job is this?" above |
| Start any other workflow, or follow a run | `custom_credential_make_request` — see `references/actions.md` |
| Back up the **site itself** (database, media, themes, plugins, settings) into a private repo | `site_backup_plan`, then `site_backup_push` — see `references/site-backup.md` |
| Publish the **site's rendered static export** into a repo | `source_control_execute_commit` — see `references/source-control.md` |

Conflating the last row with the rest wastes real work. `source_control_execute_commit` runs a
fresh static export of the site and commits the resulting HTML and assets, and it **deletes** paths
it previously wrote that the export no longer produces. It is a publishing target, not a way to put
a file in a repository. A container build needs app source, and a rendered export is not app
source — a build fed the wrong one either fails or, worse, succeeds and ships a site with no
server. `references/source-control.md` states the difference in full; read it before you use
either tool for the first time in a task.

---

## Reporting rules

- **Report the stage you actually reached.** Queued is queued. Confirmed-but-unrun is not written.
- **Name the branch, the repository, and the commit** in your result. A commit SHA and URL come
  back from a successful write; use them rather than describing what you believe happened.
- **A declined confirmation is a real outcome, not an error.** Say the human declined and stop.
  Do not re-raise the dialog to see if they change their mind.
- **Never re-dispatch on a hunch.** A second run queued behind a broken one wastes the human's
  time and tells you nothing new.
- **Say what you left unverified.** A value you guessed, a branch you assumed, a placeholder you
  did not replace — each is a thing the human needs to know, not a detail.

## References

- `references/repo-files.md` — writing and updating files: the confirmation dialog, the limits,
  every refusal reason, the workflow-path warning, and the read-then-replace procedure for edits.
- `references/actions.md` — dispatching a workflow, polling a run, reading a failed run's logs,
  and telling the distinct failure signatures apart.
- `references/auth-and-tokens.md` — what a saved GitHub credential can and cannot do, scopes,
  `authDiagnostic`, rate limits, and why repository secrets are the human's step.
- `references/source-control.md` — `source_control_execute_commit` versus
  `custom_credential_write_files`: two different credential stores, two different jobs, and the
  app-source-versus-rendered-export distinction.
- `references/site-backup.md` — backing up the site itself: plan then push, private repositories
  only, what the dialog shows, the limits, every code and what to tell the human, and why a refused
  push is planned again rather than forced.
