# Models, plans, and credits

**Historical examples, not current account knowledge.** Read or refresh `account.json` in this
plugin’s learned memory and confirm the live schema. Never copy these examples into learned memory
as if this account had produced them.

Everything here was observed against the live connected Higgsfield account on 2026-09-09. Where a
fact is about *this* account rather than about Higgsfield in general, it says so.

---

## `models_explore` — what it actually answers

`mcp__higgsfield__models_explore` takes an `action`:

| action | Use it for |
|---|---|
| `recommend` | "which model suits this goal" — pass `query` plus input context |
| `get` | one model's constraints (`model_id` required) |
| `list` / `search` | browsing the catalog |

Useful filters: `type` (`image` / `video` / `audio` / `3d`) and `input` (`text` for text-only,
`image` for models that accept reference media). For a plain text prompt with no reference image,
`{"action":"recommend","type":"image","input":"text"}` is the right query.

Each returned item carries its own `aspect_ratios`, `parameters`, and durations. Some carry
`supports_unlim` — see below, and do not read it as "this is free for me."

**`models_explore` is read-only and needs no write grant.** Only `generate_image` does.

---

## Cost preflight: `get_cost`

`generate_image` accepts `get_cost: true` inside `params`. It prices the request and **submits
nothing**:

```json
{ "params": { "model": "recraft_v4_1", "prompt": "…", "get_cost": true } }
```

Observed response:

```
Cost preflight for recraft_v4_1: 1.25 credits (1.25 exact). No job submitted.
```

with `structuredContent.cost = { credits: 1.25, credits_exact: 1.25 }`.

Use it when the operator asks what something will cost, or before a model you have not used
before. It is the one call in this integration that is guaranteed free of side effects.

**A successful preflight does not mean the generation will be accepted.** On this account the
preflight for `recraft_v4_1` succeeded *and the submit that followed it was refused* by the plan
gate. Preflight proves the connection, the auth, and the model id are all fine. It says nothing
about the account's entitlement to start a job.

---

## The plan gate

Some models are refused at submit time with exactly this:

```
Error starting generation: Requires basic plan or higher.
```

The structured payload carries `monetization_intent: "upgrade"`, a `recovery_tool` of
`show_plans_and_credits`, and a `request_id`.

Observed on the connected account, 2026-09-09:

| Model | Preflight | Submit |
|---|---|---|
| `gpt_image_2` (Higgsfield's own stated default) | — | ✗ Requires basic plan or higher |
| `recraft_v4_1` | ✓ 1.25 credits | ✗ Requires basic plan or higher |
| `z_image` | — | ✓ Job submitted, image delivered |

### How to read this correctly

**It is an account gate, not a model gate.** Two different models from two different providers
returning the *identical* message is the tell. Do not conclude "that model id is wrong" or "the
Higgsfield connection is broken" — the connection is demonstrably fine, because the preflight on
the same model can succeed through another available tool.

**Do not retry it.** The account's plan does not change between two tool calls.

**Try a model that is not gated before you escalate.** `z_image` is the one verified to work on
this account. This is worth one attempt, and it is the difference between delivering the image
and handing the operator a bill.

**If everything is gated, stop and ask.** Present it as a real choice — upgrading the Higgsfield
plan is the operator's money. Note that `show_plans_and_credits`, the recovery tool Higgsfield
itself names, is **not in this deployment's operator allowlist**, so you cannot call it. Say what
you found and let them decide.

---

## The free-trial "unlim" allowance is not a fallback

`models_explore` reports a top-level `unlim` block, and items may carry `supports_unlim`. On this
account it reports:

```
unlim: { available: false }
```

with the server's own note that unlim is *"not spendable right now"* and that passing `use_unlim`
returns a typed rejection rather than a generation.

So: **`supports_unlim` on a model does not mean you can use it.** The model-level flag says the
model *accepts* unlim generations; the top-level `available` says whether this caller can spend
any. Read the top-level one. When it is `false`, `use_unlim` is not an escape from the plan gate
— it is a second, differently-worded refusal.

Note also that `use_unlim` caps `count` to 1 regardless of what you asked for.

---

## What is and is not enabled here

This plugin covers images and video. The workflow's tool list includes `generate_image` and
`generate_video`, followed by `job_status` polling and import the media from its URL for the completed
CDN asset. The owner confirmed video coverage on 2026-10-04. Consult the live federated tool list
for each generator's input schema and the current connection's allowlist/write grants.

The seven-tool, image-only allowlist recorded during the September image trial was a snapshot of
that operator's connection, not a limit imposed by this plugin. `plugin.json` currently declares
only `models_explore` and `job_status` as default read tools; it does not deny video or automatically
grant generation writes. For a video request, `generate_video` must be both allowlisted and granted
"may write", just as `generate_image` is for images. SKILL.md's setup table includes both.

For video, use the same asynchronous chain: submit `generate_video`, poll `job_status` without
`sync:true` until completion, then import the video CDN URL by importing it from its URL.
The import tool accepts `video/mp4` and `video/webm`. A job id alone does not mean the video
exists or has reached the site's Media library. Select a video model using the live model list;
image-model plan results above do not establish a video model's availability.

Other advertised tools (upscaling, billing, publishing, deployment, or sandbox execution) still
require their own operator allowlist entries and write grants where applicable. A
not-allowlisted refusal describes that connection's current policy; report the missing
grant only when it blocks the capability the operator requested.
