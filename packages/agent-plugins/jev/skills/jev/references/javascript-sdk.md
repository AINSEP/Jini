# JavaScript SDK reference

Sources: `docs.typesafe.ai/sdk/javascript.md` (quickstart), `docs.typesafe.ai/sdk/javascript/api.md`
(API index) and these reference sub-pages under `docs.typesafe.ai/sdk/javascript/api/`:
`classes/TypeSafeClient`, `interfaces/TypeSafeClientConfig`, `interfaces/RequestOptions`,
`interfaces/RetryPolicy`, `interfaces/SystemOneRequest`, `variables/ENV`, `functions/choice`,
`functions/score`, `functions/noul`, `type-aliases/ScoreCriteria`, the error classes, and
`sdk/javascript/changelog`. All checked on 2026-09-21 against SDK `v0.6.0`. Append `.md` to any of
those paths to read the raw page. If the installed package's version differs, trust its `.d.ts`
files over this page.

## Install

Requires Node.js 20+. The package ships ESM, CommonJS, and TypeScript declarations.

```sh
npm install @typesafe-ai/sdk
```

## Client

```ts
import { choice, score, noul, TypeSafeClient } from "@typesafe-ai/sdk";

const client = new TypeSafeClient();            // key from TYPESAFE_API_KEY
const pinned = new TypeSafeClient({ apiKey });  // explicit key wins over the env var
```

`new TypeSafeClient(config?)` throws if the API key is missing, the config is invalid, or the runtime
is unsupported. Explicit options win over environment variables, which win over SDK defaults. Empty
or whitespace-only env values are ignored.

`TypeSafeClientConfig` (all optional):

| Option | Env fallback | Default |
|---|---|---|
| `apiKey` | `TYPESAFE_API_KEY` | none. Required from one source or the other. |
| `baseURL` | `TYPESAFE_BASE_URL` | `https://api.typesafe.ai` |
| `defaultModel` | `TYPESAFE_DEFAULT_MODEL` | `jev-latest` |
| `logLevel` | `TYPESAFE_LOG_LEVEL` | `warn`. `info` logs request summaries. `debug` adds headers and bodies. Credential headers are redacted, bodies are not. |
| `timeout` | none | `10000` ms per attempt. There is no total retry budget. |
| `retry` | none | `Partial<RetryPolicy>`, see below |
| `defaultHeaders` | none | extra headers on every request |
| `fetch` | none | global `fetch` |
| `logger` | none | a prefixed `console` |
| `dangerouslyAllowBrowser` | none | `false` |

**Don't set `dangerouslyAllowBrowser` in code that ships to a browser.** The docs say it exposes the API key to page
users. Call Jev from server-side code, never from an admin or site bundle that ships to a browser.

## Calling `systemOne`

```ts
const response = await client.systemOne(
  {
    state: { document: "I was charged twice. Please fix this ASAP." },
    questions: {
      category: choice("What is this ticket about?", { billing: null, technical: null, other: null }),
      frustration: score("How frustrated the customer appears", [
        "Calm, just stating facts",
        "Frustrated but civil",
        "Very angry, strong language",
      ]),
      billing: noul("Is this about billing?"),
    },
    // model: "jev-1.13.0",  // optional; omitted uses the client's defaultModel
  },
  { timeout: 5000 }, // optional RequestOptions
);

response.answers.category.choice;     // "billing" | "technical" | "other"
response.answers.frustration.score;   // number, 0..2
response.answers.billing.noul;        // number, 0..1
response.model;                       // resolved versioned id, e.g. "jev-1.13.0"
response.usage;                       // input and output token counts
```

- `systemOne(request, options?)` returns an `APIPromise<SystemOneResult<Q>>`. `request` is
  `{ state, questions, model? }`, and `questions` must be non-empty.
- Answer types are inferred from the helper that built each question. For example, `.choice` is
  narrowed to the criteria's keys.
- Question helpers:
  - `choice(instructions, criteria)`: `criteria` maps each label to a description, or to `null` for
    an undescribed label.
  - `score(instructions, criteria)`: `criteria` is an ordered array of at least two level
    descriptions, indexed from 0. Since `v0.6.0` it is an array. Earlier versions took an object
    keyed by integers, so check the installed version if you see that shape.
  - `noul(instructions?, criteria?)`: `criteria` is optional `{ true?, false? }`.
- `instructions` and every description accept `EntryType`: text, a JSON object or array, or `null`.
  This is the same structured shape the HTTP API documents (see `primitives-reference.md`).
- `systemOne()` also throws if the questions are empty or a Score has fewer than two levels.

`RequestOptions` (per call): `timeout`, `retry` (a `Partial<RetryPolicy>`), `headers` (merged over
`defaultHeaders`), and `signal` (an `AbortSignal` that cancels the request and any pending retries).

## Retries

Retries are on by default, so don't wrap `systemOne` in your own retry loop. `RetryPolicy` defaults:

| Field | Default |
|---|---|
| `maxRetries` | `2` (after the first attempt; `0` disables) |
| `httpStatuses` | `408`, `429`, and `500`–`599` (this covers `529 Overloaded`) |
| `apiConnectionError` / `apiTimeoutError` | `true` / `true` |
| `backoffInitialMs` / `backoffMaxMs` | `500` / `5000` (doubles each retry) |
| `backoffJitter` | `0.25` |
| `respectRetryAfter` / `maxRetryAfterMs` | `true` / `60000` |

## Errors

Every SDK error extends `TypeSafeError`:

- `APIError`: a non-2xx response after retries. It has `status`, `body`, `headers`, and `requestId`
  (from `x-typesafe-request-id`). Subclasses by status:
  - `BadRequestError` (400), `AuthenticationError` (401), `PermissionDeniedError` (403),
    `NotFoundError` (404), `UnprocessableEntityError` (422), `RateLimitError` (429, also has
    `retryAfterMs`), `InternalServerError` (5xx, which includes `529`).
- `APIConnectionError`: DNS, TLS, or connection failure. Its subclass `APITimeoutError` fires when
  the full response didn't arrive within `timeout`.
- `APIUserAbortError`: the caller aborted through `signal`.

```ts
import { APIError, RateLimitError, UnprocessableEntityError } from "@typesafe-ai/sdk";

try {
  await client.systemOne({ state, questions });
} catch (err) {
  if (err instanceof UnprocessableEntityError) {
    // Malformed question. err.body names the offending field. Fix it; don't retry.
  } else if (err instanceof RateLimitError) {
    // Retries are already exhausted here.
  } else if (err instanceof APIError) {
    // Log err.status and err.requestId.
  }
  throw err;
}
```

## Not covered here

`client.models.list()` returns the models available to the account as `ModelCard[]`. The API index
also lists `APIPromise`/`WithResponse` (probably access to the raw HTTP response), `Logger`,
`ModelCard`'s fields, and `VERSION`. Their pages weren't checked for this skill. Read the page or the
installed `.d.ts` before relying on them.
TypeSafe's own agent-skill FAQ names "the agent invents request or response fields" as a known
failure mode.
