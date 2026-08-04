# The `{type:"json"}` value-schema variant: a narrow, policed exception

## What it is

`SettingValueSchema` (`packages/cms/src/settings/types.ts`) is deliberately small and total —
`string` / `number` / `boolean` / `enum`, each exhaustively validatable. `{type:"json"}` is the one
variant that isn't scalar: it accepts any JSON value (object, array, or scalar) and
`validateValueAgainstSchema`'s `case "json"` (`settings.ts`) validates nothing about its internal
shape — that is the *registering feature's own write-path* responsibility, never the ledger's.

## Why the exception exists, and why it's this narrow

The variant was added for one real consumer: a site-owned SEO feature's `robotsRules` setting — a
variable-length array of `{userAgent, allow?, disallow?}` entries that genuinely cannot be
decomposed into scalar fields the way, say, a boolean toggle can. A sibling field on the same
feature (`defaultRobots`) *could* be decomposed into two booleans and was, specifically so the
`json` variant's footprint stayed limited to the one field that actually needed it, rather than
becoming the path of least resistance for every future nested-shape setting.

**Enforcement rule that must survive any refactor of this code:** the variant is not a general
escape hatch for "any field I don't want to model properly." Code Review must confirm, per use, that
the data is genuinely unbounded and list/object-shaped with no reasonable scalar decomposition
available — the check is per-use, not a headcount, and it is meant to keep this variant rare.
Someone extending `SettingValueSchema`'s consumers who reaches for `{type:"json"}` because it's the
path of least resistance is exactly the drift this rule exists to catch.

Certified in `packages/cms/src/settings/__tests__/settings.json-schema-variant.test.ts` (accepts
object/array/scalar/null-if-nullable; rejects null when not nullable).

## Source

This was decided as part of a feature ADR for a site-owned SEO module built on top of this
settings ledger (the ledger's own architecture ADR predates that feature and didn't need the
variant). The decision text: *"`robotsRules` ... needs `{type:"json", nullable?: boolean}` added to
`SettingValueSchema` with one matching `case "json": return true;` branch in
`validateValueAgainstSchema` — the ledger schema only asserts 'this is a value', not its internal
shape; [the feature's] own write-path validator ... checks the [size/shape] rules ... before ever
calling `set()`. This is additive and backward-compatible — no existing definition's schema
changes."* The accompanying enforcement note: Code Review must confirm every use is genuinely
unbounded data with no scalar decomposition available, not a general escape hatch.

## Related: the non-null-default invariant (a spec/implementation intentional divergence)

`ensure-definitions.ts`'s `SettingDefinitionSpec.defaultValue` is typed `Exclude<JsonValue, null>` —
every non-secret definition needs a non-null default, full stop. `validateDefinitionInput`
(`settings.ts`) enforces this at runtime with no nullable-schema carve-out.

This is worth calling out explicitly because the ledger's own originating architecture decision's
prose describes a nullable-schema carve-out ("a genuinely-optional setting declares an explicit
typed default the schema admits, which may be JSON `null` iff the schema is nullable"). The shipped
implementation does not carry that carve-out through: a nullable schema does not exempt a definition
from needing a non-null `default_json`. A field that is nullable *in spirit* needs a sentinel
instead — a distinguished non-null value the host's own code treats as "unset" — not a literal
`null` default.

Anyone reconciling the code against that originating prose should trust the code and this note, not
the older prose: the totality guarantee ("a live key always has a validated fail-safe default, so
`getEffective` never throws or returns undefined") is what actually shipped and is covered by tests;
loosening `validateDefinitionInput` to match the older nullable-carve-out language would reopen the
`getEffective`-returns-undefined case that guarantee was written to close.
