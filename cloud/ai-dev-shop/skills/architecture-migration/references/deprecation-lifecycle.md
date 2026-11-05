<!-- Source: Addy Osmani / agent-skills / deprecation-and-migration -->

# Deprecation Lifecycle

## Code Is A Liability

Every feature, API, flag, migration shim, and compatibility layer carries cost:

```text
maintenance cost = understanding + testing + debugging + security review + migration drag
```

Code that no longer serves its purpose still consumes engineering attention. Deprecation is how teams retire liability deliberately instead of letting it accumulate.

## Compulsory vs Advisory Deprecation

| Type | Use when | Team obligation |
|---|---|---|
| Compulsory | The old path creates security risk, data loss risk, correctness problems, platform incompatibility, or unsustainable operational cost | Set a migration deadline, provide a supported path, track adoption, and remove the old behavior |
| Advisory | The new path is preferred, simpler, faster, or more maintainable, but the old path remains safe for now | Communicate the recommendation, provide examples, and migrate opportunistically |

Choose compulsory deprecation only when continued support has real cost or risk. Choose advisory deprecation when the goal is guidance without forcing churn.

## The Churn Rule

If you own the infrastructure being deprecated, you are responsible for migrating users or providing backward-compatible updates.

Do not externalize platform churn onto product teams without tooling, compatibility, or direct migration support. The owner of the change owns the migration burden.

## Zombie Code

Zombie code has no clear owner but still has active consumers.

Identify it with criteria such as:

- It is not in any team's active roadmap.
- No team claims operational responsibility.
- It still receives traffic, imports, calls, or user activity.
- Incidents or bugs route to "who knows this?" instead of a named owner.
- Removal is blocked because consumers exist, but no migration plan exists.

Force a decision:

```text
assign owner or deprecate
```

If nobody owns the code, nobody can responsibly maintain it.

## Hyrum's Law And Deprecation

Users depend on observable behavior, including behavior that was never documented. Response ordering, timing, default values, error text, side effects, and quirks can all become implicit contracts.

Deprecation plans must assume undocumented dependencies exist. Measure usage, communicate clearly, provide warnings, and stage removals so hidden dependencies surface before the final cutoff.

## Plan Removal At Design Time

When building anything new, ask:

```text
How would we remove this in 3 years?
```

Design with ownership, usage measurement, migration hooks, compatibility boundaries, and sunset criteria from the start.

## Celebrate Removing Code

Treat removal as a positive engineering outcome. Celebrate deleted code, retired systems, removed flags, and simplified operational paths. A culture that only celebrates launches will keep accumulating liabilities.
