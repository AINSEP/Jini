# Failure modes

Every failure in this file was observed on this integration; the host guidance has the host's
exact log lines. Match the symptom, then act — do not reason from first principles about what a
federated failure "probably" means. That habit is what produced an invented explanation and cost
this project two sessions.

---

## 1. The tool is not there at all

**Symptom:** `search_tools` finds no `mcp__higgsfield__generate_image`; `describe_tool` cannot
describe it. From inside a run this is indistinguishable from the tool never having existed.

**Three different causes, all invisible from here:**

- the tool declares that it writes and is not in `writeAllowedToolNames`;
- the tool is not in the operator's allowlist (`allowedToolNames`);
- the connection is disabled or absent entirely.

**What to do:** do **not** guess which. Report what the host's admissions or refusal notices say
(the host guidance names where they appear). If none of them tells you anything, say exactly that
and send the operator to the host's connection settings.

**Remember the restart where the host freezes admissions.** A grant saved mid-session may not be
live until the assistant restarts, and no amount of retrying will make it live.

---

## 2. `Error starting generation: Requires basic plan or higher.`

**Cause:** an account entitlement gate on the selected model. Not a bad model id, not a broken
connection, not an auth problem.

**Do:** try a model that is not gated (`z_image` is verified working on this account). If they
are all gated, stop and put the choice to the operator.

**Do not:** retry the same model; conclude the integration is broken; silently switch to
`media_generate_asset`, which spends money on a *different* vendor's credential.

Full detail in `models-and-plan-gates.md`.

---

## 3. The request timed out

**Cause, when it follows a `job_status` call with `sync: true`:** a structural incompatibility,
not a slow network. Higgsfield's `sync` mode polls server-side for **up to ~25 seconds**. The
host's hosted-MCP transport aborts a federated request sooner (the host guidance gives its
ceiling), so the request is always killed before it can answer.

**Do:** call `job_status` again **without** `sync`, and poll. It returns instantly and it works.

**Do not:** tell the operator Higgsfield is slow or down. Nothing is wrong with Higgsfield here.

---

## 4. A bare internal error after a federated call

**Cause:** the host lost the real reason on the way out to you. The true reason may exist in the
run detail. On this integration it most often wraps the timeout above.

**Do:** treat it as "the reason was lost", not as "an unknown catastrophe". Re-run the same call
on a path that reports properly, or drop the flag that most likely caused it (`sync: true` is the
usual culprit on this integration). Report it honestly as a lost error message.

**Do not:** invent a cause. **Do not** report it to the operator as though `INTERNAL_ERROR` were
the actual diagnosis.

---

## 5. The server "is disconnected: its authorization expired or was revoked"

**Cause:** the OAuth access token has expired. It is short-lived — on the order of a day.

**Do:** call `external_mcp_reauth_prompt`. It shows the operator a real in-chat notice naming the
server and pointing them at where to sign in again. **You cannot finish an OAuth sign-in
yourself**, and neither can that tool.

After the operator confirms they have reconnected, retry the **original** failed call exactly
once, and report its real outcome.

**Do not:** call this tool for any other kind of failure. **Do not** keep retrying the failing
call while the notice is up.

---

## 6. `media_import_from_url` returns 403 or 404

**Cause:** almost always an expired vendor URL. Higgsfield's CDN links are time-limited.

**Do:** get a fresh URL from `job_status` for the same job id and import that.

**Do not:** retry the same dead URL, and do not fall back to downloading the file and re-uploading
it — you do not need to hold the bytes, and there is no path for you to do so anyway.

---

## 7. `media_import_from_url` rejects the file

**Cause:** the format is outside the accepted set. The host checks the **actual bytes**, not the
served `Content-Type`, and accepts only the image and video formats it supports. A URL that
returns HTML (an error page, a login wall) is refused rather than stored as a broken asset.

**Do:** check that the URL you passed is the `uri` from the completed `job_status` resource link,
not a page URL. Report the refusal as-is — it is the guard working.

---

## 8. Everything succeeded but nothing is in Media

**Cause:** you stopped after `generate_image`, or after `job_status`. Neither one puts anything in
the Media library. Only `media_import_from_url` does.

**Do:** run step 4. Then confirm by the returned `media.id` and `media.publicUrl` — not by the
fact that earlier calls returned 200.
