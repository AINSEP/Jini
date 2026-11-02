# GitHub Actions: dispatch, follow, diagnose

Everything here goes through `custom_credential_make_request` against the saved GitHub credential.
Nothing here needs a new tool, and nothing here needs a shell.

---

## Before you dispatch anything

Three facts, none of which you may guess:

1. **The repository** — `owner/repo`, exactly.
2. **The workflow** — its filename (`deploy.yml`) or its numeric id. The filename is what a human
   recognizes, so prefer it.
3. **The ref** — the branch to run on. GitHub reads the workflow definition *from that ref*, so the
   workflow file must already exist there. `GET /repos/{owner}/{repo}` returns `default_branch` if
   you need it; do not assume `main`. And naming the ref is not knowing it — resolve it to a commit
   before you dispatch, per the section below.

And one check worth its single call: confirm the workflow is actually registered.

```
custom_credential_make_request({
  label: "github",
  method: "GET",
  url: "https://api.github.com/repos/<owner>/<repo>/actions/workflows"
})
```

Each entry carries `id`, `name`, `path`, and `state`. A workflow whose `state` is
`disabled_manually` or `disabled_inactivity` accepts a dispatch and then never runs — worth
catching here rather than in a confused poll loop ten minutes later.

If a file you just wrote is not in that list, GitHub has not picked it up yet, or it is not on the
ref you are looking at. Do not dispatch into that gap.

---

## Resolve the ref to a commit, and say which commit, before you dispatch

**A branch name is not a commit.** `main` reads as the same string on the day your work lands on it
and on a day it is a month behind — the name cannot tell those two apart, and neither can the human,
unless you tell them. One GET turns the name into a fact:

```
custom_credential_make_request({
  label: "github",
  method: "GET",
  url: "https://api.github.com/repos/<owner>/<repo>/branches/<ref>"
})
```

Three fields off that response:

| Field | What it gives you |
|---|---|
| `name` | The ref, confirmed to exist. A 404 here is the same missing ref the dispatch would have returned as a **422**, caught one call earlier and in a message that names it plainly. |
| `commit.sha` | The exact commit this run will build. |
| `commit.commit.committer.date` | When that commit landed on the ref. |

**State all three before you POST the dispatch**, with the age in plain words:

> Deploying `main` @ `f2997c6e` — committed 2026-09-11, 7 days ago.

The date is the half that does the work. A tip a week old, told to someone who has been working all
week, is the visible shape of *"this is about to ship something other than what you just wrote"* —
and it is one line, at the only moment it is still cheap.

**This step reports. It never blocks.** Say what the ref resolves to, then dispatch. Do not ask for
confirmation, do not refuse, and do not wait to be told to continue. Whether this deploy should go
out is the human's call, and they can only make it if you have said what it is.

### One more comparison, already paid for

The runs list you will poll *after* the dispatch also answers a question worth asking *before* it:

```
custom_credential_make_request({
  label: "github",
  method: "GET",
  url: "https://api.github.com/repos/<owner>/<repo>/actions/workflows/<file.yml>/runs?per_page=1"
})
```

If `workflow_runs[0].head_sha` equals the `commit.sha` you just resolved, this run will build
**byte-identical source to the last one**. Say so, in those words, before you dispatch. A green run
that changes nothing is the most confusing outcome anything in this document can produce, and it is
fully predictable one call ahead of it happening.

### What you cannot compare against

The human's own working copy. There is no `git` and no shell here — their local branch, their
uncommitted work, and whether they have pushed any of it are all invisible to you. Do not guess at
them, and do not imply you checked. Give them the ref, the SHA and its date; if that tip reads older
than the conversation you are having, say the date out loud and let them draw the conclusion.

---

## Dispatch

```
custom_credential_make_request({
  label: "github",
  method: "POST",
  url: "https://api.github.com/repos/<owner>/<repo>/actions/workflows/<file.yml>/dispatches",
  headers: { "Accept": "application/vnd.github+json", "Content-Type": "application/json" },
  body: "{\"ref\":\"<branch>\"}"
})
```

**Success is 204 with an empty body, and 204 means QUEUED.** Not built, not deployed, not started.
This is the single most reported-wrong result in this whole document. Say "queued", then follow it.

The failures you will actually see, and what each one means:

| Status | What it actually is |
|---|---|
| **404** | The workflow file does not exist at that path — *or* the token cannot see this repository at all. Both look identical here. Confirm the repo with `GET /repos/{owner}/{repo}` before you assume the path is wrong. |
| **422** | The workflow exists but has no `workflow_dispatch` trigger, or the `ref` you named does not exist. GitHub's message names which; read it rather than retrying. |
| **403** | Usually the token lacks Actions write. Occasionally an org policy. See `auth-and-tokens.md`. |

Never retry a 422 with a different guess. Fix the actual cause.

---

## Follow the run

There is no callback and no webhook here. You poll.

```
custom_credential_make_request({
  label: "github",
  method: "GET",
  url: "https://api.github.com/repos/<owner>/<repo>/actions/workflows/<file.yml>/runs?per_page=1"
})
```

Read `workflow_runs[0]`: `id`, `status`, `conclusion`, `html_url`, `head_branch`, `head_sha`,
`created_at`. `head_sha` is the commit that actually built: check it against the SHA you resolved
before dispatching, and report it next to the conclusion. The two differ when someone pushed
between your read and your dispatch — a fact to state, not a problem to solve.

**Two things to get right before you interpret it:**

- The newest run may not be yours. Check `created_at` against when you dispatched, and check
  `head_branch`. Reporting on someone else's run is worse than reporting nothing.
- `status` and `conclusion` are different fields. `status` is `queued` / `in_progress` /
  `completed`. `conclusion` is `null` until `status` is `completed`, and only then is it
  `success` / `failure` / `cancelled` / `timed_out` / `skipped` / `action_required`.

**A run sitting in `queued` is not stuck.** A concurrency group that queues rather than cancels
will hold a run behind another one for as long as that one takes. Say "queued behind an earlier
run" — do not diagnose a hang, and do not dispatch a second run to "get things moving": that
lengthens the queue you are complaining about.

Poll a handful of times with a real gap between calls, and report what you actually see each time.
If it is still running when you run out of patience, say so and give the human `html_url`. An
honest "still in progress after N checks, here is the link" is a better answer than a guess.

---

## When a run fails

Do not report "the workflow failed" and stop. Find the step.

```
custom_credential_make_request({
  label: "github",
  method: "GET",
  url: "https://api.github.com/repos/<owner>/<repo>/actions/runs/<run_id>/jobs"
})
```

Each job carries `name`, `status`, `conclusion`, and a `steps` array where every step has its own
`name`, `number`, and `conclusion`. **The first step whose `conclusion` is `failure` is the
answer** — everything after it is `skipped`, and reporting a skipped step as the failure sends the
human to the wrong place.

Report: the job name, the step name and number, and the run's `html_url`.

### The raw-logs endpoint does not work from here, and that is by design

`GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs` does not return logs. It returns a **302**
whose `Location` points at an object-store host.

`custom_credential_make_request` follows **zero** redirects, and that object-store host is not on
the credential's saved allowlist, so you cannot follow it either. You will see the 302 and its
`Location` header, and that is where it ends. This is not a bug to work around — following an
arbitrary redirect target with a credential attached is exactly the egress hazard the single-hop
policy exists to close.

So the honest procedure is:

1. Get the failing job and step from the `/jobs` response above. That is genuinely most of what a
   log would tell you.
2. Give the human the run's `html_url` and name the failing step, so one click lands them on it.
3. If the actual log text matters, **ask them to paste the relevant lines.** Do not claim you read
   logs you did not read.

### Telling failure signatures apart

These four are the ones that get confused with each other, and each needs a different next move:

| Signature | What it means | What to do |
|---|---|---|
| The run never appears | The trigger did not match, or the file is not on that ref | Re-read the workflow's own `on:` block and the ref you pushed to. Do not re-dispatch. |
| Fails immediately, in the first seconds, on a setup or auth step | A missing or wrong repository secret | Confirm with the human that the secret is set, by exact name. `GET .../actions/secrets` lists names (never values). |
| Fails mid-run in a build or deploy step | A real error in the thing being built or shipped | Name the step and hand over the run URL. This is not a GitHub problem. |
| `conclusion: "action_required"` | Waiting on a human — an approval, or a first-time contributor gate | Tell the human it is waiting on them, and where. Nothing you can do moves it. |

A cancelled run and a timed-out run are also distinct from a failure, and both are commonly a
human's or a queue's doing rather than a defect. Read `conclusion` before you write the word
"failed".

---

## Rate limits

Every response carries `x-ratelimit-remaining` and `x-ratelimit-reset`. A **403 with
`x-ratelimit-remaining: 0`** is a rate limit, not a permission problem — and telling a human their
token is broken when they are merely throttled is a real, avoidable mistake.

Polling is the only thing here that makes a meaningful number of calls, which is the practical
argument for a real gap between polls rather than a tight loop.
