# Writing and updating files in a repository

`custom_credential_write_files` is the only way to put a file in a GitHub repository from here.
Never shell out to `git`, and never hand-roll the Contents API through
`custom_credential_make_request` — this tool exists so you do not have to, and it carries a human
confirmation the raw API call would skip.

---

## The call

```
custom_credential_write_files({
  label: "github",
  owner: "<owner>",
  repo: "<repo>",
  branch: "<branch>",
  commitMessage: "<message>",
  files: [
    { path: "path/relative/to/repo/root", content: "<the file's exact full text>" }
  ]
})
```

**One call does everything.** It resolves the branch's real current state, raises an interactive
confirmation, and **waits** — it does not return until the human answers. There is no second call
to make, and calling again while one is pending raises a second, separate dialog rather than
answering the first.

On confirm, every file lands in **one atomic commit**, never one commit per file, built directly on
the branch's current tree. Nothing else on the branch is touched, moved, or deleted.

### What comes back

| Result | Meaning |
|---|---|
| `{ executed: true, commitSha, commitUrl, filesWritten }` | Written. Report the SHA and URL — do not describe what you believe happened. |
| `{ executed: false, cancelled: true }` | The human declined. Nothing was written. This is a real outcome; say so and stop. |
| `{ executed: false, cancelled: false, reason: "expired" \| "abandoned" }` | Nobody answered in time, or the run ended first. Nothing was written. |
| `{ executed: false, cancelled: false, reason: "error", message }` | GitHub rejected the write, or the branch moved since this call started. Nothing was written — **never a half-commit.** Retry fresh; never assume partial success. |

A branch that moved mid-write is refused rather than force-pushed. That is deliberate: the loser of
a race is told, never silently overwritten. Re-read the file, rebuild your content on what is now
there, and call again.

---

## The rules this tool enforces for you

**The branch must already exist.** This tool never creates one, and it does **not** default to the
repository's default branch. Name it explicitly. If you are unsure what exists, look it up
(`GET /repos/{owner}/{repo}/branches`) or ask — a wrong branch name is refused before anything is
written, but a *valid-but-wrong* branch name is not.

**Paths are repository-relative.** Never absolute, never containing a `..` segment, never naming or
nesting under `.git`. Refused before any confirmation or network call.

**Limits:** at most 25 files per call, 1 MiB per file, 4 MiB total, no two files naming the same
path. Exceeding any of these is a refusal with a reason that names which one.

Every refusal above happens **before** the dialog is raised and before any network call. So a
refusal costs the human nothing — but it also means a refusal is a real signal to read, not a
transient error to retry.

---

## Updating a file that already exists

This is where the damage happens. Read `Rule 4` in `SKILL.md` first; this is the procedure it
requires.

**`custom_credential_write_files` replaces a file's entire content. It does not patch.** Whatever
you do not carry forward is gone.

1. **Read what is actually there.**
   ```
   custom_credential_make_request({
     label: "github",
     method: "GET",
     url: "https://api.github.com/repos/<owner>/<repo>/contents/<path>?ref=<branch>"
   })
   ```
   The response's `content` is base64. For a large file, `Accept: application/vnd.github.raw` gets
   you the text directly.

2. **Build the new content from that**, never from memory and never from a template you assume
   matches what is on the branch.

3. **State every line you removed.** Not "updated the workflow" — the actual removals. A dropped
   build flag reads as nothing at all in a summary that only lists what was added.

The confirmation dialog labels each path a **create** (new path) or an **update** (already exists
on the branch), resolved against the branch's real state, never guessed. **An "update" label is
your warning** that a full-content replacement is about to happen. If you expected a create and see
an update, stop: something is already at that path and you are about to overwrite it.

---

## Workflow files get an extra warning, and they have earned it

If any path is inside `.github/workflows/`, the confirmation dialog carries a **second, more
prominent warning** naming every such path, because a workflow file controls what code runs
automatically on every future push to that repository.

Do not treat that warning as noise to talk the human past. When you write a workflow:

- **Say what the workflow will do**, in plain terms, before they confirm — what it triggers on,
  what it runs, what credentials it will use.
- **Name every secret it references**, so they can confirm each one is actually set. See
  `auth-and-tokens.md`: setting them is their step, always.
- **Do not silently regenerate a workflow from a template** when one already exists. That is the
  exact shape of the force-push that dropped two build arguments and broke two deploys.

---

## Templates and placeholders

A plugin that ships a template file expects it to be read off disk and written into the human's
repository, with every placeholder replaced.

After you write, **re-read what you wrote and confirm no placeholder marker survived.** A leftover
placeholder is, at best, a confusing failure — and at worst a run that succeeds against the wrong
target. Then **say which values you left at a default**: an unverified default the human never
chose is a fact they need, not an implementation detail.

---

## What is happening underneath

Worth knowing because it explains the guarantees above: one blob per distinct file content, one
tree built on top of the branch's current tree (`base_tree`, always — so every path you did not
name is inherited unchanged), one commit object, and one **non-force** ref update.

That last step is the only irreversible one, and GitHub itself rejects it with 422 if the branch
moved. Which is why "diverged" is a refusal here rather than a lost commit.
