# Source Control: publishing the site's export, and why it is not a file write

The host has a second, narrower pair of GitHub tools. They are easy to reach for by mistake, because
their names sound general and they are not.

- `source_control_get_capabilities` — read-only. Which providers have a saved connection.
- `source_control_execute_commit` — commits the site's **rendered static export** to a repository.

Neither is a way to put a file in a repository. That is `custom_credential_write_files`.

---

## The distinction that actually matters

**App source is not a rendered export.**

| | `custom_credential_write_files` | `source_control_execute_commit` |
|---|---|---|
| What it commits | Exactly the files you name, verbatim | A **fresh static copy of the active theme** — generated HTML and assets — that it runs itself |
| Where the content comes from | You | The host's exporter. You do not supply file content at all |
| Deletes anything? | **Never.** It writes named paths and touches nothing else | **Yes.** Unchanged stale files recorded by this destination’s manifest are removed; human-edited stale files are preserved |
| Creates a branch? | No — the branch must already exist | Yes, if the named branch does not exist |
| Which credential | The Access Tokens page's saved custom provider (`label`) | The **Source Control** credential, falling back to a saved `github` API key only when no explicit connection exists |
| Repository layout | Wherever you name | Repository root by default, or the optional `folder` the user named |

A container build needs **app source** — the repository's real code, its Dockerfile, its lockfiles.
A rendered export is the *output* of running that code, and a build handed one either fails or,
worse, succeeds and ships a static site where a server was expected.

So when a task says "push the app to a repo so CI can build it", that is **not**
`source_control_execute_commit`. It is either app source the human already has in a repository, or
specific files you write with `custom_credential_write_files`. Conflating the two wastes a whole
build cycle before anyone notices what was actually committed.

`source_control_execute_commit` is for one job: **publishing the site's rendered output** into a
repository as a portable static copy. Hosting this layout requires configuration; use the static-publish flow for hosted deployment.

---

## Two credential stores, not one

This surprises people and is worth stating flatly.

- `custom_credential_*` reads the **Access Tokens** page's *Add custom provider* table. That is
  where a credential labelled `github` lives.
- `source_control_*` reads a **separate** table, connected through the secure connection card.

An explicit Source Control connection takes priority. If none exists, `source_control_execute_commit`
can use the saved `github` API key; capabilities identify this as `credentialSource:"saved-api-key"`.
A connected Source Control provider does not give `custom_credential_make_request` a label to use.

So: call `source_control_get_capabilities` before you promise a human anything about committing an
export. And never ask a human to paste a token into chat to bridge the gap — open the plugin’s source-control card, which saves it encrypted through that owner.

---

## Using `source_control_execute_commit`

```
source_control_execute_commit({
  provider: "github",
  owner: "<owner>",
  repo: "<repo>",
  commitMessage: "<message>",
  branch: "<branch>",   // optional — the repository's default branch when omitted
  folder: "static_sites", // optional — empty or omitted means repository root
  dryRun: true
})
```

Use the folder the user named. If the destination is unclear, ask “repository root or which folder?”.
Run a dry run first. Folder commits require `supportsFolder:true` from capabilities; an older
provider is refused rather than allowed to ignore the destination.

The package contains `Open website.html`, `README.txt`, `media/` and `sites/<theme>/`.
The README is deterministic so unchanged re-commits can report `NO_CHANGES`. Open the launcher to
view the copy. A theme directory needs its sibling `media/`; there is no generated root `index.html`.
Existing GitHub Pages/root-hosting URLs can break with this layout. The host's other static
publishing and export commands retain their current output.

Ownership is recorded at the host's managed-files ledger for that folder. Changing folders creates an independent
destination, preserving the previous root export and sibling folders. A folder commit never reads
the root manifest as a fallback.

Only `provider: "github"` is accepted. A gitlab or bitbucket credential can be **saved** and is
reported honestly by `source_control_get_capabilities` with `commitSupported: false` — committing
to either is not implemented. Say that plainly rather than letting a human discover it from a
failed attempt.

Like every gated write here, **one call raises the dialog and waits.** There is no second call.

### Reading the result

On success: `{ committed: true, folder, entryPath, branchCreated, commitSha, commitUrl, filesChanged, filesDeleted,
divergedPaths }`.

**Report the destination, `entryPath`, and `filesDeleted` to the human, always.** A nonzero value means real content was *removed*
from their repository, not merely added. Only paths this tool itself previously wrote, whose live
content still exactly matches what it wrote, are ever deleted — unrelated files and human-edited stale files are preserved. Current generated paths are replaced,
including the generated README at this destination.

`divergedPaths` lists paths that fell into that last case: no longer part of the export, but
preserved because their content no longer matches this tool's own record. Tell the human those need
their own manual review if removal is still wanted. Silence here reads as "everything is clean",
which is the opposite of what a non-empty `divergedPaths` means.

### The failure codes, and what each one is telling you

| Code | What it means | The right next move |
|---|---|---|
| `no-credential` | No Source Control credential is connected. Returned **without raising a dialog** | Point them at the admin's Source Control page. Call `source_control_get_capabilities` first next time |
| `REPOSITORY_NOT_FOUND` | The token cannot see that `owner/repo` | Confirm the identifiers, then the token's access. Not necessarily a bad token |
| `NO_CHANGES` | Nothing changed since the branch's last commit | **Not a failure.** Say nothing needed to commit |
| `DIVERGED_BRANCH` | Someone else pushed since this call started; the commit was refused rather than overwriting history | The human resolves it, exactly as with any rejected non-fast-forward push |
| `NETWORK_UNREACHABLE` | Could not reach GitHub at all | Says **nothing** about the credential. Do not tell them to replace it. Suggest retrying |
| `PROVIDER_ERROR` | GitHub's API rejected the request — expired token, insufficient scope, permission | The message names what went wrong. Never a raw body, never the credential |
| `EXPORT_FAILED` | The site failed to export cleanly, before any commit was attempted | A host-side problem, not a GitHub one. Fix the export |

`{ committed: false, cancelled: true }` is a human declining. Say so and stop.

Wait for the result and report the true outcome. Do not tell a human a dialog is open and then
stop, and do not call again while a call is pending — a fresh call raises a second, separate dialog
rather than answering the first.
