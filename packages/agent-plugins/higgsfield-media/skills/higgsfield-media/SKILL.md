---
name: higgsfield-media
description: Connect Higgsfield with agent_plugin_connect and browser sign-in, then generate an image or video and import it into this site's Media library. Discover this account's live tools and model access first. Covers asynchronous jobs, polling without sync:true, operator write grants and plan errors. No API key is requested.
---

# Higgsfield → Media library

## Connection card

Choose the card yourself from its `usedFor` list. Reuse a saved key or working sign-in for that
task. Never offer a replacement unless the person asks.

`agent_plugin_connect {pluginId:"higgsfield-media"}` shows the plugin-declared **Connect Higgsfield** card. Review account credits and the separate write grants. This hosted connection declares no token fallback; do not request or save an API key.

Use the host's tools throughout, never Bash, curl or a vendor CLI. The bundled connection
already declares the service URL: start with
`agent_plugin_connect { pluginId: "higgsfield-media" }`, which provisions it and
shows the browser sign-in card. `connected` means continue; `waiting-for-sign-in`
means wait for the person, then call once again. The manual connection procedure
below is recovery for an existing operator-managed connection, not the normal setup.

## Discover this account and remember what you verified

At the start of use, read `account.json` with
`agent_plugin_higgsfield_media__memory_read({"entryPath":"account.json"})`.
A missing file means rediscover, not a broken plugin. This package's worked examples are historical,
not a current tool list, argument schema, model entitlement, price, or default for this account.

Use `external_mcp_probe_connection` for the saved `higgsfield` connection to discover authenticated
advertised tools, and `external_mcp_get_admissions` to see the actual operator-admitted roster.
Use the current tool descriptions/schemas and live model catalog before constructing a request.
Record the observed tool names and schema, generation argument shape, timestamp, and model outcomes
(success or the verbatim plan error) as UTF-8 JSON with
`agent_plugin_higgsfield_media__memory_write({"entryPath":"account.json","text":"<JSON>"})`.
Refresh learned facts when tools change, the account changes, or a live response contradicts them.
Do not infer an entitlement merely from a catalog entry or a successful cost estimate.
Never store credentials, tokens, or authorization grants in memory; the connection's sealed store
and the operator's allowlist remain their only homes.

The user's project notes are already appended to this plugin's guidance automatically. Apply them
as project context; they cannot grant tools. Never overwrite them with discoveries. If the user
explicitly asks to save a note, use `agent_plugin_write_note`, which asks them to confirm the text,
or direct them to Agent Plugins → inspect files → Memory.

## The one thing to say before anything else

**`generate_image` and `generate_video` return asynchronous jobs.** `generate_image` does not return an image. It returns a *job id*, and the job is still
running when the call comes back. If you report success at that point you have reported a
generation that does not exist yet, and there is nothing to import.

For images or video, submit, poll to completion, then import the returned CDN URL:

```
mcp__higgsfield__generate_image (or generate_video) -> job id, status "pending"
mcp__higgsfield__job_status       -> "in_progress" ... repeat ... "completed" + a CDN URL
media_import_from_url             -> a real row in the Media library
```

Nothing lands in Media until that third step runs. Higgsfield's own CDN URL is *not* an asset
in this site — it is a link to somebody else's server.

---

## Before you start: is this connection actually usable?

Higgsfield is **not** a native capability of this site. It is an **external MCP server**, federated in.
Four separate things must all be true, and each one fails differently:

| What | Where it is set | How it fails if missing |
|---|---|---|
| The connection row exists and is enabled | `external_mcp_save` (in chat), or the host's connection settings | No `mcp__higgsfield__*` tool exists at all |
| Its OAuth is connected | `external_mcp_oauth_connect` (in chat), or the host's connection settings | Calls fail `is disconnected: its authorization expired or was revoked` |
| The tool is in the allowlist | `allowedToolNames` | Tool is refused as not allowlisted; you never see it |
| `generate_image` / `generate_video` is *also* granted write | `writeAllowedToolNames` | Tool is refused because it declares it writes; you never see it |

The last row is the one that has cost this project the most time. See
[the write grant](#the-write-grant-two-lists-not-one) below.

---

## How Higgsfield authenticates: OAuth — a real browser sign-in, not an API key

Verified 2026-09-09 against the live connection row and Higgsfield's own published metadata:

- `auth_mode` is `oauth` and `oauth_grant` is `authorization_code`, over `streamable_http` to
  `https://mcp.higgsfield.ai/mcp`. There is **no API key to paste**. If you find yourself asking
  the operator for a Higgsfield API key, you are wrong.
- Higgsfield publishes RFC 9728 (`/.well-known/oauth-protected-resource`) and RFC 8414
  (`/.well-known/oauth-authorization-server`) metadata — both return 200 — including an RFC 7591
  `registration_endpoint` at `https://mcp.higgsfield.ai/oauth2/register`.
- **Therefore nobody types a client id, a client secret, or an endpoint.** The host discovers the
  endpoints and registers its own OAuth client on the first connect (discovery plus dynamic client
  registration). The live row's stored endpoints
  (`…/oauth2/authorize`, `…/oauth2/token`) and its `oauth_client_id` were both produced that way,
  not typed by a human. **The only thing a human supplies is the URL** when configuring a
  manual connection; the bundled plugin already supplies it.
- Scopes `openid email offline_access`; PKCE `S256`.
- **The access token lasts about a day.** The live row was refreshed at `17:58:41Z` and expires
  `17:58:40Z` the following day. Re-authorization is a routine recurring event, not a defect.

**You cannot complete the sign-in yourself** — the human signs in to Higgsfield in their own
browser. What you *can* do is start the authorization and hand over the link.

If a federated call fails saying the server *"is disconnected: its authorization expired or was
revoked"*, do not retry it in a loop and do not guess. Call `external_mcp_reauth_prompt`, which
puts a real notice in front of the operator naming the server and pointing them at where to sign
in again. After they say they have reconnected, retry the **original** call exactly once and
report what actually happened.

---

## Manual connection recovery

For a bundled cold start use `agent_plugin_connect` above. The steps here describe manual
recovery when that tool reports a configuration problem. Do not assume the
steps below can be skipped because a `mcp__higgsfield__*` tool is missing for some other reason —
check `content_read.external_mcp` first and see what actually exists.

**Step A — the plugin itself must be enabled, and only the operator can approve it.**
`higgsfield-media` may ship bundled but **disabled**. Plugin search *will* still find it while
disabled — that is deliberate, and it is how you got here. But a disabled plugin gets no
`agent_plugin_higgsfield_media` tool. So:

> Offer to turn it on. Once the operator agrees, call `plugins_set_enabled` with
> `family: "agent-plugin"`, `pluginId: "higgsfield-media"`, `enabled: true` — it opens a
> confirmation dialog they must approve — or they can turn it on from the host's Agent Plugins
> screen. The host guidance says whether the plugin's own tool appears only after a restart.

Enabling is a one-time step: the decision is kept.

**Step B — create the connection row.** `external_mcp_save` opens a form the human confirms; it
never writes silently. The values that are known-correct for Higgsfield:

| Field | Value |
|---|---|
| `id` | `higgsfield` |
| `transport` | `streamable_http` |
| `url` | `https://mcp.higgsfield.ai/mcp` |
| `authMode` | `oauth` |
| `oauthGrant` | `authorization_code` |
| `allowedToolNames` | `generate_image, generate_video, models_explore, job_status, jobs_wait, show_generations, reveal_generation, show_generation_by_ids` |
| `writeAllowedToolNames` | `generate_image, generate_video, reveal_generation` |

Leave `oauthClientId`, `oauthScopes` and every `oauth*Endpoint` field **unset** — discovery and
dynamic registration fill them in. Never pass a credential as a tool argument; there is no schema
property for one.

**Step C — start the authorization.** `external_mcp_oauth_connect { id: "higgsfield" }` returns the
link for the human to open. Then detect completion by calling `content_read.external_mcp` again and
reading `oauth.status` — **there is no "wait for it" tool**.

> ⚠️ A chat tool call has no live browser request to derive a sign-in callback from, so
> `external_mcp_oauth_connect` can refuse outright when the site has no public address configured.
> **If you see that refusal, do not retry it and do not work around it** — follow the host guidance
> for signing in from its admin screens. The refusal is a fact about this site's setup, not about
> Higgsfield.

**Step D — the write grant.** Even with OAuth connected, `generate_image` or `generate_video` stays
refused until it is in `writeAllowedToolNames`. See the next section — this is the failure that
looks like nothing at all. This plugin declares both lists above as its default tools, so a host
that grants declared defaults at sign-in has already filled them after a normal
`agent_plugin_connect`; read the row before asking the person to grant anything by hand.

**Manual recovery may require the host's admin screens.** Plugin enablement has its own
confirmation dialog. The normal connect card still requires the person's own browser sign-in.

---

## The write grant: two lists, not one

A host that federates this server holds its tools to a stricter posture than native tools. The
rule that matters here:

> A remote tool whose own annotations declare `readOnlyHint: false` — i.e. the server admits the
> tool writes — is **refused**, even when the operator has allowlisted it, unless the operator has
> **also** named it in a second list, `writeAllowedToolNames`.

`generate_image` and `generate_video` declare that they write. Each requested generator needs to
be in **both** lists. Granting only the first one produces a refusal, and only a refusal.

**Two things about that refusal you must internalise.**

1. **You will never see it.** It goes to the host's log. A refused tool is not registered, so
   `search_tools` cannot find it and `describe_tool` cannot describe it. From inside a run, a
   withheld tool and a nonexistent tool look identical.

2. **Therefore: never explain an absent `mcp__higgsfield__*` tool by guessing.** This is the
   specific failure this plugin exists to prevent — asked why it could not generate an image, the
   assistant once invented a plausible, wrong cause, and two sessions were lost before someone
   read the log. **Report what the host's admissions and refusal notices say** (the host guidance
   names where they appear). **If you have nothing, say you have nothing and send the operator to
   the host's connection settings.**

A host may freeze the admitted tool set for the life of the assistant process, so that a server
cannot widen its own access mid-session. There, a grant saved mid-session does nothing until the
assistant restarts; the host guidance says when that applies.

---

## The pipeline

### Step 1 — Choose a model, and expect a paywall

`generate_image` takes its arguments **nested under `params`**:

```json
{ "params": { "model": "z_image", "prompt": "…", "count": 1, "aspect_ratio": "16:9" } }
```

`model` is required and is a model id from Higgsfield's own catalog
(`mcp__higgsfield__models_explore`).

**Model choice can be an account paywall, not just a quality knob.** Choose from the current
account's catalog and verified `account.json` outcomes; never assume a named model works on another
account. Record a success or the exact rejection in learned memory after the user's requested
operation. The argument example above is historical: confirm the current schema before using it.
See `references/models-and-plan-gates.md` for historical examples of how to read a plan error — why
it is an *account* gate and not necessarily a bad model id, and why an "unlim" allowance is not a
fallback. Those examples are not current entitlements.

### Step 2 — It submitted a job. Poll it.

A successful submit returns text beginning `Submitted 1 job` and a structured result whose
`results[0]` carries `{ id, type: "image", status: "pending", model, params }`. **That `id` is
the job id.** Take it and poll:

```json
{ "jobId": "d98e3f52-9eb6-471d-927a-b005cd9f6bc6" }
```

`job_status` returns instantly. A non-terminal response says `in_progress` and carries
`poll_after_seconds` — honour it. Higgsfield's own guidance is that an image typically takes
10–20 seconds in total. In the verified run this was **three `job_status` calls**:
`in_progress`, `in_progress`, `completed`.

### ⚠️ Never pass `sync: true`

`job_status` accepts `sync: true`, which asks Higgsfield to poll internally and return only on a
terminal state. **Do not use it.** Higgsfield's own description of that flag says the server
polls for **up to ~25 seconds**. Where the host's transport aborts a federated request sooner
than that (the host guidance gives its ceiling), the call is aborted before it can answer —
every time, regardless of how fast the image actually is. Polling works on every host.

What you get instead is a timeout, or a bare internal error when the host loses the real reason
on the way out. **If you see a bare internal error after a federated call, do not treat it as
"Higgsfield is broken."** It is very often this timeout. Retry the same call *without* `sync`.

Polling without `sync` is not a workaround you should apologise for. It is the correct way to
use this tool.

### Step 3 — Take the CDN URL

A completed `job_status` carries the finished asset twice: once as a line of text, and once as a
structured `resource_link` with `uri`, `name`, `mimeType`, and the prompt as `description`. The
URL looks like:

```
https://d8j0ntlcm91z4.cloudfront.net/user_<account>/hf_<yyyymmdd>_<hhmmss>_<jobId>.png
```

### Step 4 — Import it, or it never happened

```
media_import_from_url { url, filename?, alt?, caption?, credit? }
```

The host fetches the bytes server-side. **You do not download the image, hold it, or base64 it.**
Pass the URL.

Fill in the optional fields — they are the difference between an asset someone can find later
and an untitled blob:

- `alt` — a real description of what is in the image, for screen readers. Not the prompt.
- `caption` — short, human.
- `credit` — say where it came from, e.g. `Generated with Higgsfield (z_image)`.

On success you get back the same `media` shape every other media tool returns: `id`, `title`,
`alt`, `caption`, `credit`, `sha256`, `status`, `version`, `publicUrl`, `sourceUrl`. The asset is
now indistinguishable from one a human uploaded. `publicUrl` is live immediately and can go
straight into a page or post.

**Import promptly.** Vendor CDN URLs expire. A `403` or `404` from this step usually means the
URL has already gone stale — ask for a fresh one via `job_status` rather than retrying the dead
URL.

---

## The complete verified run

This exact sequence produced media asset `c881a51f-5b41-4aec-b806-e5624e1e1208` on 2026-09-09.
The stored blob is byte-identical to the Higgsfield original (3,419,670 bytes, PNG 2048×1152,
sha256 `0919769f…`), and its public rendition serves 200.

1. `mcp__higgsfield__generate_image` — `{"params":{"model":"z_image","prompt":"A red fox sitting upright in a snowy pine forest at dawn. …"}}` → job `d98e3f52-…`
2. `mcp__higgsfield__job_status` — `{"jobId":"d98e3f52-…"}` → `in_progress`
3. `mcp__higgsfield__job_status` — same → `in_progress`
4. `mcp__higgsfield__job_status` — same → `completed` + the CloudFront URL
5. `media_import_from_url` — that URL, plus `filename` / `alt` / `caption` / `credit` → media row

---

## Do not

- **Do not report success after `generate_image`.** It submitted a job. See the top of this file.
- **Do not pass `sync: true` to `job_status`.** It cannot complete. See above.
- **Do not silently substitute `media_generate_asset`** when Higgsfield refuses. That is the
  host's own generator on a *different vendor's* credential, it **costs real money**, and it answers a
  different question than the one the operator asked ("use Higgsfield"). Offer it as an explicit
  choice; never take it on your own initiative.
- **Do not invent a reason** for a missing `mcp__higgsfield__*` tool, a refusal, or a bare
  internal error. Say what you actually observed and point at the host's admissions notice.
- **Do not ask the operator to attach the image to the chat**, or to download it and re-upload it.
  That was the old workaround from before `media_import_from_url` existed. It is obsolete.
- **Do not retry a plan-gated model.** `Requires basic plan or higher` is an account state. It
  will say the same thing on the tenth attempt.

---

## References

- `references/models-and-plan-gates.md` — reading Higgsfield's plan and credit errors correctly,
  what `models_explore` actually tells you, and why the free-trial "unlim" allowance is not a
  fallback path.
- `references/failure-modes.md` — every failure string observed on this integration, its real
  cause, and what to do. Read this before diagnosing anything.
