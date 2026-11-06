# Backing up the site itself to a private repository

`site_backup_plan` and `site_backup_push` copy **this site** into one folder of a private GitHub
repository, in one commit: its database, media, themes, installed plugins and skills, and settings.
Both are native host tools. They push with the same saved credential `custom_credential_*` uses:
the plugin’s card: open the secure connection card.

---

## Which tool

Three tools can put the site's things in a repository. They do three different jobs.

| The human wants… | Use |
|---|---|
| A copy of the site itself (content, members, media, settings) to keep or restore from | `site_backup_plan`, then `site_backup_push` |
| The site's **rendered** HTML published into a repository (Pages, a static host) | `source_control_execute_commit` — see `source-control.md` |
| A few named files: a config, a workflow, a script | `custom_credential_write_files` — see `repo-files.md` |

The rendered export holds no database. It is what the site *looks like*, not the site, and nothing
can be restored from it. Going the other way, `custom_credential_write_files` cannot carry a backup:
25 files and 1 MiB each, and every byte would pass through your context. The database holds members
and admin accounts, so that is not a size problem. It is a reason never to try.

---

## Plan, then push

```
site_backup_plan({
  owner: "<owner>",
  repo: "<repo>",
  // all optional:
  credential: "github",          // needed only when more than one saved credential points at GitHub
  branch: "<branch>",            // default: the repository's default branch; must already exist
  folder: "<folder>",            // default: the site's folder name; replaced as a whole on each backup
  include: { media: false },     // database, media, themes, plugins, settings: each defaults to true
  commitMessage: "<message>"     // default: the host's backup message with the site name and time
})
```

**The plan writes nothing.** It checks the credential, that the repository is private, that the
credential can push, and that the branch exists. Then it snapshots the database, lists every file
with its size, and checks the limits. It returns a `planId`, which is **single-use and valid for
10 minutes**, plus everything the human needs to see.

**Show the human the plan before you push:** repository, branch, folder, and whether that folder
already exists (it will be replaced). Also what is included, the file count and total size, and
anything in `skipped` or `notes`. Then:

```
site_backup_push({ planId: "<planId>" })
```

**No dialog: the push starts at once.** The plan you showed is the human's review, so show it
first. The push re-checks the repository (still private, branch not moved, files unchanged) before
the first upload.

A large site can take longer than one call. The push waits about 4 minutes; if the upload is still
running then, it returns `{ pushed: false, cancelled: false, inProgress: true, planId, progress,
message }`, where `progress` is `{ filesDone, filesTotal, bytesDone, bytesTotal }`. Tell the human
how far it got, then **call `site_backup_push` again with the same `planId`** to keep waiting. That
does not start a second upload, and nothing is committed until every file is up: the backup is
still one commit. Keep re-calling while it answers `inProgress`.

The `planId` is used up when its push finishes, whatever the outcome. After a failure, a second
attempt starts with a fresh `site_backup_plan`. A server restart drops a running push; nothing is
committed, so plan again.

GitHub hiccups (a timeout, a 5xx, a rate limit) are retried inside the push with backoff, up to 5
tries per request. A failure that reaches you is final, and its message names the file it stopped at.

---

## Private repositories only

A public or internal repository is refused (`REPOSITORY_NOT_PRIVATE`) at plan time, and checked
again at push time. The database holds members, form submissions, admin accounts and saved
credentials. That is not a warning to talk the human past. Never suggest a public repository.

The repository must also **already have one commit**. An empty repository is refused
(`REPOSITORY_EMPTY`). The fix is on GitHub: add a README, then plan again.

---

## What the push returns

| Result | Meaning |
|---|---|
| `{ pushed: true, commitSha, commitUrl, repository, branch, folder, filesWritten, totalBytes }` | Written. Report the SHA and URL. |
| `{ pushed: false, cancelled: false, inProgress: true, planId, progress, message }` | Still uploading. Report the progress, then call `site_backup_push` again with the same `planId`. |
| `{ pushed: false, cancelled: false, reason: "abandoned" }` | The run ended while the push was waiting. The upload stopped and nothing was committed. Plan again. |
| `{ pushed: false, cancelled: false, code, message }` | Refused. See the codes below. Nothing was written. |

---

## Limits

- **100 MiB per file.** That is GitHub's own limit. A media, theme or plugin file over it is **left
  out** of the backup and listed in the plan's `skipped` with its size, **never truncated or
  split**; tell the human which files those are. A database snapshot over it fails the plan
  (`LIMIT_EXCEEDED`), because a backup without its database is not a backup.
- **At most 3000 files and 1 GiB in total.**

Every limit is checked by the plan, before anything is uploaded (`LIMIT_EXCEEDED`). Relay the
message. The fix is to remove or shrink the named files, or leave out the scope that holds them.
Media usually holds the most files and the most bytes. A backup without media is a different
backup, so say plainly that media would be left out and get the human's agreement before you plan
with `include: { media: false }`.

When media lives in object storage rather than on this server, `notes` says so: those files are
not in the backup, though the database still lists every media item. Pass that on.

**Never in a backup, by design:** chat history and chat attachments, the rendered export, MCP
server config files (they can hold tokens), plugin OAuth data, and `.git`. Symbolic links are never
followed; each is listed in `skipped`. The Site key is not in the backup either. The saved
credentials inside the database are encrypted with it, so the human needs to keep it safe on their
own.

---

## The codes, and what to tell the human

| Code | What it means | What to tell them |
|---|---|---|
| `CREDENTIAL_NOT_FOUND` | No saved credential has that label, or none points at `https://api.github.com` | Open the secure connection card, or name the right label with `credential`. Never have a token typed into the chat. |
| `CREDENTIAL_AMBIGUOUS` | More than one saved credential points at GitHub | Ask which one, then plan with `credential` |
| `CREDENTIAL_UNREADABLE` | The credential **is saved** but this server cannot decrypt it | Not a bad GitHub token, so replacing it is the wrong first move. It starts with the **Site key**, and the message names which case applies. No Site key: start the host with it (the host guidance names how). Malformed: fix it in the host's Site key setting. A different Site key from the one the credential was saved under: check that setting, or save the credential again. |
| `REPOSITORY_NOT_FOUND` | This credential cannot see that `owner/repo` | Confirm the names, then the token's repository access |
| `REPOSITORY_NOT_PRIVATE` | Public or internal | Back up to a private repository. Never offer a public one |
| `NO_PUSH_PERMISSION` | The token can read the repository but not push to it | The token needs write access to the repository's contents. That change is made on GitHub. |
| `REPOSITORY_EMPTY` | No commits yet | Add a first commit (a README) on GitHub, then plan again |
| `BRANCH_NOT_FOUND` | The named branch does not exist | Name an existing branch, or leave `branch` out for the default |
| `FOLDER_IS_FILE` | The folder's path is a file on that branch | Choose another `folder` |
| `LIMIT_EXCEEDED` | Over a limit above | See **Limits** |
| `DATABASE_SNAPSHOT_FAILED` | The host could not take a consistent copy of the database | A host-side problem, not a GitHub one. Report it |
| `PLAN_NOT_FOUND` / `PLAN_EXPIRED` | The `planId` was already used, is over 10 minutes old, or a server restart dropped it | Plan again |
| `PLAN_STALE` | A file on the site changed after the plan | Plan again, and show the new plan |
| `DIVERGED_BRANCH` | Someone pushed to the branch after the plan. Nothing was written | Plan again, and show the new plan |
| `PROVIDER_ERROR` | GitHub rejected a request | The message names what went wrong. Pass it on |
| `NETWORK_UNREACHABLE` | GitHub could not be reached, even after retries | Says nothing about the credential. Try again later, from a fresh plan |
| `UNAVAILABLE` | This runtime has no site folder on disk | A backup cannot be made from here |
| `SITE_BACKUP_FORBIDDEN` | The person lacks the backup or credential-write permission | An admin grants it. Nothing was touched |
| `SITE_BACKUP_INVALID_INPUT` | A field was malformed | The message names the field. Fix it and plan again |

---

## Never force

`site_backup_push` has no force option, and every write it makes is a **non-force** ref update on
top of the exact commit the plan saw. That is why `DIVERGED_BRANCH` is a refusal, not a lost commit.

So when a push is refused because the world moved (`PLAN_EXPIRED`, `PLAN_STALE`,
`DIVERGED_BRANCH`), the answer is always **plan again** and show the human the new plan. Never force
the branch through `custom_credential_make_request`, never delete and recreate the branch, and never
rebuild the backup out of `custom_credential_write_files` calls. Each of these would throw away
someone else's commit, or push content the human never reviewed.

There is no restore tool unless the host guidance names one. Do not promise one.
