Spec ID: SPEC-JINI-ADMIN-BEHAVIOR
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:d9040ccf49279d98c589e4b53a1c1b51166aabff0c2781ba52710d6bbd0a041b
spec_mode: reverse_spec


# Admin behavior contract

## Purpose and evidence

This specification records current rules for consumers of the package. Evidence is `src/core/{manifest,routing,permissions,transport,entities}`, `src/browser`, `src/react/{shell,entities,components,hooks}` and their colocated tests. Test assertions were inspected, not run. Port-only promises below require a conforming consumer adapter; they are not backend implementations supplied by this package.

## Guards and precedence

- The panel resolver shall retain only panels for which every required capability and permission is present. Missing lists shall act as empty lists. A literal `*` grant shall satisfy every permission; `records.*` shall not imply prefix matching.
- The shell model shall derive routing, navigation and reported agent page from the same resolved panel set. For root or an unmatched URL, it shall select `defaultPanelId` with null view, empty params and preserved query. If that default is absent or filtered out, it shall return no renderer.
- WHILE session state is checking, anonymous or error, the shell shall omit protected panels, sidebar and authenticated slots. Navigation subscription/interception and appearance hooks still run before this render gate. Session invalidation shall retire older reads before exposing anonymous state.
- The permission helper shall decide visibility only. The consumer backend shall independently authorize reads, writes and destructive operations.
- The agent map shall default panel reachability to false. Explicit panel flags shall override `defaultReachable`; the map shall separately publish every param-free route with `agentPageId`, even on a panel with `agentReachable: false`. Parameterized routes shall not become destinations. Consumers shall pass resolved panels and review both opt-in mechanisms.
- The agent page reporter shall use the first matching route view's `agentPageId`, otherwise the panel id. This is reporting, not an authorization check.
- Explicit tone shall override deprecated `destructive`; otherwise destructive true shall yield danger, else default. Dialog cancel text shall prefer explicit prop, nearest defaults provider, then `Cancel`.
- Controlled color scheme shall override saved preference; absent/invalid stored preference shall use system. Without an environment, the appearance hook shall return undefined and resolve internally to light.

## Ordering and URL rules

- The resolver shall preserve panel registration order. Nav shall put ungrouped entries first; named groups shall follow first registration occurrence; entries shall sort ascending by order with stable ties. Missing order shall compare as `Number.MAX_SAFE_INTEGER`.
- Route matching shall select the first registered panel id and first matching declared detail pattern. Matching shall be case-sensitive, segment-based, ignore empty slash segments, and parse query separately. Captures shall remain encoded until a consumer decodes them. There shall be no splats or regex.
- The core matcher shall return dashboard for root even without a registered dashboard; unknown panel or unmatched trailing segments shall return null panel. The shell shall apply its separate host-owned fallback.
- `adminHref` shall add a leading route slash and concatenate the base without normalizing its trailing slash. `currentRoutePath` shall strip only an exact base or base plus slash, otherwise return the supplied pathname or `/`.
- WHEN programmatic navigation targets the current normalized pathname, query and fragment, it shall change neither history nor events. One final pathname slash shall be ignored in this comparison. A different query or fragment shall count as navigation. Replace shall use replaceState; otherwise pushState. A completed change shall dispatch `jini:admin-navigate`.
- The link interceptor shall handle only unprevented primary clicks without modifiers, on same-origin anchors within the exact mount or its slash-prefixed subtree. It shall leave download links, non-self targets and fragment-only links to the browser. Intercepted URLs shall preserve query and fragment.
- The simple browser reader shall return path only. The shell navigation snapshot shall include query and exclude fragment. Subscribers shall receive popstate and package navigation events and provide teardown.
- Entity routes shall encode entity and row segments, reserve `/new` for create, and put existing rows under `/row/:id`, including rows named `new`. Dot-only segments shall receive a `~` marker; literal tildes shall be percent-encoded. Route hrefs shall contain the base; the navigation callback shall receive only route path.

## Transport and composition

- The HTTP transport shall concatenate `baseUrl + path`, forward RequestInit and default credentials to same-origin. Per-request credentials shall override that default.
- For every HeadersInit form, precedence shall be per-call headers over transport headers over `Content-Type: application/json`; merging uses the native Headers API.
- The transport shall attempt JSON parsing once. Any parse rejection, including an empty 204 or invalid JSON in a success response, shall become `{}`. Parsed bodies shall be returned without runtime schema validation.
- WHEN a response has `ok: false`, the transport shall throw AdminApiError with status, parsed body, string code when supplied, and `String(body.error ?? 'request failed (<status>)')`. Fetch rejections shall propagate unchanged.
- The client assembler shall invoke factories synchronously in Object.entries order with the same transport instance. It shall reject group name `transport`; it shall not roll back previously called factories on a later failure.
- The package shall provide no request retry, rate limit, timeout, mutation idempotency key or abort controller. Consumers shall supply policy through their fetch/transport and RequestInit.signal. Duplicate entity submits shall be suppressed only while that mounted editor's mutation is pending, not across clients or requests.

## Entity rules and limits

- Registry creation shall validate all descriptors before returning a shallow-frozen null-prototype object. It shall aggregate key/name mismatch, empty labels, no fields, empty/duplicate/reserved-id field names, absent/non-text title field, and relations to unregistered names. It shall not freeze ports/descriptors or impose a field-name grammar.
- Entity lookup shall use own-property membership and return null on a miss. Erasure without diagnostics shall return the original port. With onViolation, it shall wrap list/get/create/update, report each violation and return rows/pages unchanged. Optional remove shall remain absent when unsupported and preserve adapter method context when present.
- Conformance checking shall require string text/relation, parseable string datetime, integer numbers, finite real numbers and booleans. JSON shall permit finite scalar JSON values, arrays and plain/null-prototype objects only. It shall stop after depth 32 or more than 10,000 visited values per field; exceeding either shall yield a mismatch rather than unbounded recursion.
- Page-size parsing shall use Number(raw): a positive integer shall be capped at 200; null, empty, nonpositive, fractional or nonfinite values shall use 25. This is a UI request bound; the adapter shall honor its requested limit.
- Relation loading shall issue one parallel list request per distinct resolvable target with limit 100. It shall not walk further pages. It shall retain target list order, fall back to row id for missing titles, and mark truncation from non-null nextCursor. An unknown target shall be absent; a target request failure shall reject the complete load.
- Drafts shall contain only declared fields. Required booleans shall start false; all other new values shall start undefined. An existing defined row value shall replace that floor. Required checks shall treat undefined and non-JSON empty string as blank; false, zero and JSON empty string shall remain valid answers.
- Kind validation shall use the same core mismatch function as diagnostics. Invalid JSON text shall block saving without discarding the last valid parsed draft. Create shall omit undefined fields; update shall forward explicit undefined for optional clearing. Consumer HTTP adapters shall encode clearing explicitly because JSON.stringify drops undefined properties.
- Datetime controls shall show UTC, carry seconds and nonzero milliseconds, and append Z on conversion back. Empty input shall return undefined; unparseable input shall remain raw for later validation. The core checker uses Date.parse, not a strict ISO grammar.
- Entity lists shall preserve backend order and maintain forward cursor history locally; they shall not enable DataTable's page-local sorting. The generic DataTable shall sort only supplied rows when controlled sort identifies a sortable column, without mutating input.

## Port-only obligations and deliberate boundaries

| Port family | Consumer adapter obligation / limitation |
|---|---|
| Gated/database/recovery | Plan is read-only/idempotent; confirm binds the reviewed plan; execute uses returned confirmToken. Reject restore confirmation with disclosureAcknowledged false; verify execution token against restorePointId. No token store, expiry or restore engine is implemented here. Reversible flags alone do not prove a reachable undo UI. |
| Settings | Effective resolution is user > workspace > global > default. Require principalId for user set/clear. Namespace reset lacks a principalId input; define targeting in the adapter. |
| Identity/members | Operator identities and members are separate. No deleteUser or enableMember is declared. Magic-link response is enumeration-safe `{delivered: true}`. |
| Media/comments | Trash and hard purge are distinct; permanent actions must not imply undo. Comment moderation includes expectedVersion and returns void; purge has no version input. No media restore method is declared. |
| Menus | Whole-tree writes carry expectedVersion. Deletion of a non-trash row trashes it even with force; deletion of an already-trash row attempts purge, blocked by bindings unless force. Assignment can displace another binding. This is not safe to blindly retry. Custom target kinds require property checks in addition to discriminant checks. |
| Forms | Slug is immutable; fields replacement may add/edit/reorder but not remove existing field ids. No definition delete; submission delete is permanent. Submission pages have required nextCursor. |
| Redirects | Tombstoning retains the disabled record. Batch results distinguish created from per-item failed. A resolved batch does not mean every item succeeded; transport/auth failures can still reject. A regex literal in the open type is not proof a backend supports regex. |
| SEO/integrations/analytics | SEO sitemap acceptance is not completion. Subscription delete retains the disabled record; no worker/secret rotation is supplied. Recent-hit limit defaults to adapter policy, without historical reporting. |

The package shall not provide login credential storage, tenant selection, server handlers, database schema, durable entity storage, referential integrity, optimistic concurrency for generic entities, audit persistence, a queue, assistant runtime or product stylesheet. Open string unions document extensibility; they do not implement capabilities.

## Composition and interaction guarantees

Sidebar supplies object arguments to its preference, section and routing helpers. RowMenu supplies item count and DOM ports to its hook, passes `{onSelect}` on selection, and uses object-shaped tone/agent helpers. ConfirmDialog uses the same agent helper contract. Transport headers are normalized through `Headers`, including record, tuple and Headers input; precedence is per-call over transport over the JSON content-type default. No server route factories are shipped. Recovery uses GatedOperation with its additional restore fields; media undo requires a separate host restore capability.
