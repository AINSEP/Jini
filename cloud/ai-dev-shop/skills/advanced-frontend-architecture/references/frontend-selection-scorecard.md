# Frontend Selection Scorecard

Use this reference when `advanced-frontend-architecture` runs Selection Mode or
needs to re-evaluate an existing architecture.

## Tier 1: Intake Axes

The intake axes narrow candidates and set weights. They are not a final score.

### 1. Domain Complexity

| Level | Signals | Routing |
|---|---|---|
| Low | CRUD, forms over API, backend owns invariants | Prefer framework-native; avoid DDD/hexagonal unless other axes demand it |
| Medium | Workflows, validation, derived UI rules | Include vertical slices; consider FSD |
| High | Client-side invariants, offline decisions, rich domain vocabulary | Include DDD, hexagonal frontend, article stack |
| Multi-context | Multiple bounded contexts or products | Score DDD/module boundaries and ownership heavily |

### 2. UI Surface and Framework Diversity

| Level | Signals | Routing |
|---|---|---|
| Small single-framework | Few routes/screens, one framework | Prefer framework-native or lightweight vertical slices |
| Medium single-framework | Many routes, repeated feature patterns | Include FSD or vertical slices |
| Large single-framework | Complex app with many domains | Include modular monolith plus enforced internal patterns |
| Multi-framework | React plus Angular/Vue/Svelte/native surface, or likely reactivity split | Include pure core, hexagonal frontend, mirrored UI, article stack |

### 3. Team and Ownership Topology

| Level | Signals | Routing |
|---|---|---|
| Solo/pair | One or two developers | Avoid heavy ceremony; require revisit triggers |
| Squad | One team owns the app | Prefer modular monolith/internal boundaries over micro-frontends |
| Multi-team | Multiple teams share one app | Score ownership, public APIs, import guards heavily |
| Platform/autonomous teams | Teams need independent deploys | Include micro-frontends only if deploy autonomy is a real requirement |

### 4. Lifespan and Migration Pressure

| Level | Signals | Routing |
|---|---|---|
| Prototype | Less than 6 months, expected churn | Prefer framework-native; add migration trigger |
| Product | 1-3 year horizon | Score maintainability and migration cost |
| Platform | 3+ year horizon, multiple teams/surfaces | Score governance, enforcement, reversal cost |
| Brownfield migration | Existing conventions and user-facing risk | Score migration path first; do not greenfield-rewrite by default |

## Cost Gate

If all are true, skip deep scoring:

- low domain complexity;
- small single-framework surface;
- solo/pair or small squad;
- prototype or low migration pressure;
- single deployable;
- no compliance/performance/security trigger.

Recommendation: use framework-native conventions, keep files colocated, and add
a revisit trigger such as route count, domain-rule duplication, or cross-feature
import drift.

## Tier 2: Deep Dimensions

Default to these 8 dimensions.

| # | Dimension | Evaluates |
|---|---|---|
| 1 | Runtime and data fit | Rendering model, route data, server/client split, request/mutation shape |
| 2 | State ownership | Local/server/client/domain state placement and synchronization risk |
| 3 | Boundary clarity | Folder topology, public APIs, import direction, private internals |
| 4 | Domain fit | How well the pattern models business vocabulary and invariants |
| 5 | Cohesion and change locality | Whether one user action/domain change stays in one place |
| 6 | Coupling control | Framework coupling, API coupling, cross-slice dependencies, adapter seams |
| 7 | Testability payoff | Whether added seams produce simpler, higher-confidence tests |
| 8 | Ceremony, migration, and team legibility | Cost to adopt, learning curve, brownfield path, reversibility |

## Extended Split-out Rule

Split a primary dimension into explicit extended dimensions only when the merged
dimension would hide a material tradeoff.

Common split-outs:

- Rendering strategy
- Data-fetching and mutation boundary
- Performance and bundle/runtime cost
- Delivery/deployment independence
- Security/privacy/compliance
- Observability/resilience
- Design-system governance
- Direct infrastructure/team cost

Example: SSR/hybrid may score well on initial render but poorly on hydration or
server cost. Split Runtime and data fit into Rendering, Performance, and Cost.

## Scoring Scale

| Score | Meaning |
|---:|---|
| 1 | Poor fit; likely harmful without major mitigation |
| 2 | Weak fit; workable only with clear constraints or short lifespan |
| 3 | Adequate fit; tradeoffs are acceptable but not strong |
| 4 | Strong fit; risks are known and manageable |
| 5 | Excellent fit; aligns with constraints and reduces future risk |

Use confidence:

- High: grounded in inspected code, approved spec, ADRs, or explicit user facts.
- Medium: grounded in partial evidence and reasonable assumptions.
- Low: missing critical facts; name what would change the score.

## Weighting Rules

- Heavy: dimensions directly tied to the intake axes or explicit NFRs.
- Standard: relevant but not decisive.
- Light: mostly inherited from host architecture or low risk.
- N/A: does not apply to the candidate type being compared.

Do not compute a weighted-sum winner. Use weights to choose argument depth and
to explain tie-breaking.

## Candidate Disqualification Rules

- Micro-frontends require real independent deploy or autonomous-team pressure.
- Orc-BASH as an implementation skill requires React.
- Article stack requires at least one of: high domain complexity, multi-framework
  shared core, long lifespan with multiple surfaces, or strict guard enforcement.
- FSD requires willingness to adopt its vocabulary and import rules.
- Hexagonal frontend requires business logic or I/O seams worth isolating.
- Framework-native should be the null hypothesis for simple CRUD/admin work.
- Brownfield migrations must preserve existing conventions unless migration risk
  is explicitly justified.

## Framework Bias Guard

- Never recommend a framework-specific primitive as a generic architecture.
- Say "React Orc-BASH", "Angular services/DI", "Vue composables/Pinia", or
  "Svelte stores/load functions" when the mechanism is framework-bound.
- For multi-framework or framework-unknown contexts, prefer framework-free
  vocabulary: core module, port, adapter, use case, slice, view adapter,
  state owner, public API, boundary guard.

## Scoring Summary Template

```markdown
| Dimension | Weight | Candidate A | Candidate B | Candidate C | Winner | Confidence |
|---|---:|---:|---:|---:|---|---|
| Runtime and data fit | Heavy | 4 | 3 | 2 | A | Medium |
| State ownership | Standard | 3 | 4 | 4 | B/C | Low |
```

For high-weight dimensions, add the full argument chain. For light or N/A
dimensions, keep the rationale to one line.
