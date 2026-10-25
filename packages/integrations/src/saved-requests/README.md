# Saved requests

`@jini-ai/integrations/saved-requests` interprets data supplied by a trusted host. It is
not registered as a model-callable HTTP tool. The model supplies only the input object to
one already-selected definition. No scripts, expressions, path/header/host interpolation,
credential selection, redirects, retries or tool chaining are supported.

```ts
import {
  parseSavedRequestDefinition, executeSavedRequest,
  type SavedRequestDeps,
} from '@jini-ai/integrations/saved-requests';
import { makeCredentialedRequest } from '@jini-ai/integrations/credentialed-http';

const definition = parseSavedRequestDefinition({ value: {
  version: 1,
  method: 'GET',
  url: 'https://catalog.example/products/search?catalog=public',
  credential: { id: 'credential-123', revision: '7', origin: 'https://catalog.example' },
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['query'],
    properties: { query: { type: 'string', minLength: 1, maxLength: 200 } },
  },
  queryBindings: { q: 'query' }, bodyBindings: {},
  output: { path: ['products'], maxItems: 10, fields: {
    title: { path: ['title'], type: 'string', maxLength: 200 },
    price: { path: ['price'], type: 'number' },
    available: { path: ['available'], type: 'boolean' },
    link: { path: ['url'], type: 'url', maxLength: 500, allowedOrigin: 'https://shop.example' },
  } },
} });

// Bind the credential owner's executor in trusted composition, never in model input.
declare const ports: Omit<SavedRequestDeps, 'executeCredentialedRequest'>;
const deps: SavedRequestDeps = { ...ports, executeCredentialedRequest: makeCredentialedRequest };
declare const signal: AbortSignal;
const result = await executeSavedRequest(
  { deps, workspaceId: 'mounted-workspace', definition, input: { query: 'tea' } },
  { signal },
);
// { trust: 'untrusted', items: [{ title, price, available, link }, ...] }
```

Bindings map destination query/body names to top-level declared input property names.
Absent optional properties are omitted. Query values use `URLSearchParams`; body values
use JSON serialization. `staticBody` pins constant JSON fields for POST/PUT/PATCH/DELETE.
Bindings cannot override fixed query values or static body fields. Authentication names
are refused in bindings and fixed query/body keys. GET cannot have a body. The method is
not an effect/risk declaration: the host independently classifies the operation.

Schemas use the already-supported `@cfworker/json-schema` validator with a deliberately
small checked subset: closed objects, string/boolean/number/integer properties, bounded
arrays, primitive enums, string lengths and numeric ranges. Every string needs maxLength
(<=4096), every numeric field needs finite minimum/maximum, and every array needs maxItems
(<=50). Object width <=32, depth <=4, enum size <=32. Unknown keywords, `$ref`, unions,
regex, formats, defaults and schema coercion are refused. Definitions and inputs are
snapshotted at invocation to prevent changes across async work.

The host resolves the opaque credential ID in the mounted workspace and returns the
current revision, base URL and connection. Missing/revoked credentials, revision changes
and origin changes refuse. The revision must cover account/token/visitor-use grant
changes; use an authoritative storage revision, not a display label or timestamp. No
decryption is needed for save/review. Resolution occurs once, only at execution. The
request URL must match the reference origin and credential base origin exactly;
additionalHosts never expands that grant. Supply the site's public/admin/API/control
origins in `deps.forbiddenOrigins`, from trusted configuration rather than request Host.
Include every site alias (custom domains and platform hostnames); exclusion compares
hostnames across ports and schemes. Targets, credential origins and output URL origins
must use HTTPS on the default port 443.

The interpreter constructs platform's existing guarded client using the equivalent of
`SINGLE_HOP_HTTPS_EGRESS_POLICY`: HTTPS only, empty development allowlist, private/mixed
DNS addresses denied, pinned peers, no redirects, 10s idle ceiling and whole-request
deadline, 65,536-byte encoded and decompressed limits. Inject the platform's pinned Node
transport/DNS ports and a clock implementing timeoutSignal. No raw fetch implementation
belongs here. Cancellation is forwarded through DNS and body completion.

Non-2xx, redirects, non-JSON media, truncation and oversized bodies refuse. Complete JSON
strings are decoded and redacted by the existing credentialed-request owner before any
projection, including JSON-escaped secret echoes. Credential-bearing JSON keys and numeric
values refuse the body; answered provider refusals retain their actual audit status.
Output selects only own-property paths,
typed scalar fields and at most maxItems records; missing/wrong-type/oversized selected
values refuse. A scalar object becomes a one-item result, while arrays are deliberately
limited to the approved row count. Serialized output is capped at 16 KiB, and input plus
the encoded request is separately capped at 16 KiB each. Configuration is capped at 16 KiB.

Errors are `SavedRequestError` with value-free codes: `invalid_definition`, `invalid_input`,
`credential_changed`, `execution_failed`, `invalid_response`. Transport failures expose no
provider diagnostics and never automatically retry. Existing credential-request audit
records remain transport evidence; the host owns invocation audit and its error policy.

Treat every result as untrusted content, including strings containing instructions or
links. Output cannot grant permissions or produce browser directives. Render tool-sourced
links only against the declared URL origins. The host still owns eligibility, modes,
public-data release approval, consent, live revision checks, quotas and visitor audit.

The subpath requires the package's existing platform peer plus optional
`@cfworker/json-schema` ^4.1.1. Other subpaths retain their existing imports and behavior.
