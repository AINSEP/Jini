# Reference: Cohesion and API Surface

Two module-level diagnostics that `component-coupling-metrics.md` deliberately
does not cover. Coupling asks how a component relates to the rest of the tree.
These two ask about the component itself:

- **Cohesion** — do this unit's own pieces belong together, or is it several
  unrelated things sharing a name?
- **API surface** — how much does it promise to the outside, and is that number
  growing because someone decided to grow it?

They are read together because they pull in opposite directions. Splitting an
incohesive module improves cohesion and *raises* total surface. Neither number
is a verdict on its own.

## Why these two and not a score

Both are counts of a thing you can go and look at — independent pieces, and
public names. Neither is a weighted index. A "modularity score" combining them
would be invented precision: the weights would be assumed, and calibrating them
needs an outcome dataset this toolkit does not collect. Same reasoning as the
hotspot tiers in `<AI_DEV_SHOP_ROOT>/harness-engineering/sensors/change-history.md`.

## The metric set

| Metric | Unit | Meaning |
|---|---|---|
| **LCOM4** | class | independent groups of methods, linked by shared state or calls |
| **groups** | module | independent groups of files, linked by imports within the module |
| **linkage** | module | share of the module's files in its largest group |
| **public** | module | public top-level names, summed over the module's files |
| **declared** | module | what the package's `__init__.py` puts on the front door |
| **reexports** | module | public names bound by an import rather than defined here |
| **delta** | module | change in `public` against a baseline run |

`LCOM4 = 1` and `groups = 1` mean one connected thing. `LCOM4 = 4` means the
class is four unrelated things and the split is already drawn for you.

LCOM4 is the Hitz & Montazeri (1995) variant, the one Sonar ships. Chidamber &
Kemerer's original LCOM counts method *pairs*, so it grows with class size and
ranks big classes above incohesive ones — a different question from the one
being asked.

## Running it

```
python3 <AI_DEV_SHOP_ROOT>/skills/codebase-analysis/scripts/cohesion.py <SOURCE_ROOT>
python3 <AI_DEV_SHOP_ROOT>/skills/codebase-analysis/scripts/api_surface.py <SOURCE_ROOT>
```

Useful flags:

- `--json` — machine-readable, including the group membership behind each count
- `--top N` — truncate the rows **in every output format, JSON included**. The
  summary still describes the whole run, and the JSON `run` block records the
  full totals and a `truncated` flag so a consumer can tell. `api_surface.py`
  **refuses a truncated file as a `--baseline`**, because a module missing from
  the baseline would read as brand-new surface and manufacture growth
- `--depth N` — collapse modules to the first N path segments
- `--scope classes|modules` — cohesion only, when one granularity is enough
- `--include-constructor` — cohesion; see the counting rules below
- `--baseline <json>` — api_surface only; the growth reading

**Growth needs two runs.** A single `api_surface.py` run is a level. Save its
`--json` output, and pass it as `--baseline` on a later run to get the per-module
delta. Without a baseline the script says so rather than implying a trend.

**A baseline must carry the current `schema_version`.** The JSON output declares
one, and the reader requires an exact match — a file written before that field
existed, or by a later version whose rows mean something else, is refused rather
than read as if it agreed. The same refusal covers a duplicate module row and an
unreadable `run` block: whichever row was meant is exactly what the reader cannot
know, so it reads nothing. Re-capture the baseline after upgrading rather than
hand-editing an old one.

## Reading the output

**A split is a candidate boundary, not a defect.** Three shapes score high and
are usually correct as written:

- **Delegation classes.** A facade whose methods each forward to a different
  collaborator shares no state by construction. It will score `LCOM4 = n` and be
  exactly right.
- **Protocol and interface classes.** Abstract methods touch nothing, so every
  one is its own group.
- **Namespace modules.** A `utils` directory of unrelated helpers scores
  `groups = n` because nothing imports anything. That is what it is; whether it
  should exist is a judgment the number cannot make.

The reverse error matters more: **`LCOM4 = 1` is not a certificate.** A god class
where every method touches one shared `state` dict scores 1 and is the worst
file in the repository. Cohesion detects the *absence* of a connection, never
the quality of one.

For API surface, the number to read is rarely the raw count. A serialization
library legitimately exports a lot. The three readings that carry signal:

- **`no front door`** — a multi-file module with no `__init__.py`. Nothing marks
  the intended entry point, so every public name in every file is reachable
  surface by default.
- **A large `interior` against a small `declared`** — the package has decided on
  a front door and most of its surface is not behind it.
- **`delta`** — surface that grew. This is the reading the harness otherwise
  lacks; a diff adding fourteen exports to a domain package is visible here and
  invisible in any single run. Modules present in the baseline and **absent
  now** appear as `removed_modules` with a negative delta and are included in
  the net change — a deleted package is surface change, and omitting it made a
  net of `+0` describe a repository that had lost five exports.

## How this feeds the analysis

Phase 2 of `../SKILL.md` runs both alongside `main_sequence.py`. The three
answer different questions about the same module and are most useful joined:

- High `Ca` **and** high `groups` — many dependents on something that is not one
  thing. Splitting it is likely to help, and the split is already drawn.
- High `Ca` **and** large `public` — the expensive combination. Every dependent
  is bound to a wide surface, so almost any change is breaking.
- Low `Ca` and large `public` — surface nobody uses. Cheap to shrink.

Cite the numbers as evidence. Severity still comes from the Flaw Categories
table in the SKILL, never from a cohesion or surface value.

## This is evidence, not a finding

Same rule as `component-coupling-metrics.md`, restated because it is the one
that gets forgotten:

- **Nothing here gates.** Both scripts exit 0 always. No sensor consumes their
  output, no disposition is derived from them, and
  `<AI_DEV_SHOP_ROOT>/harness-engineering/sensors/code-structure-quality.md`
  records public-API growth as covered by no *sensor* — these scripts do not
  change that.
- **Do not ratchet on them.** A cohesion target is trivially satisfied by adding
  a field every method touches. A surface target is trivially satisfied by
  prefixing names with an underscore. Both make the number better and the code
  no different.
- **The scripts' own tests do block.** Their counting-rule tests run in
  `run-all.sh`, so a regression in the measuring instrument fails that profile.
  No measured value from a subject codebase blocks anything, ever.

---

# Counting rules

Every rule below has a test in `../scripts/test_cohesion.py` or
`../scripts/test_api_surface.py`.

## What links two methods (LCOM4)

An edge exists between methods A and B when either holds:

1. They reference the same `self.X`. Either the same field, or both calling the
   same helper — both are evidence they belong together.
2. One references the other by name (`self.b()` inside `a`). The callee never
   references its own name, so rule 1 alone cannot see this edge.

`self` is **the first parameter's actual name**, not the literal word `self`.
Code using `this` or `cls` is read correctly.

## What LCOM4 excludes

- **Constructors** (`__init__`, `__new__`, `__post_init__`), by default. A
  constructor assigns every field, which links every method that reads any of
  them. Including it collapses LCOM4 to 1 for almost every class that has one —
  the metric's best-known failure mode. `--include-constructor` restores the
  naive reading for comparison.
- **Static methods and methods with no parameters.** No receiver means they can
  share nothing, so each would always be its own group — inflating the count by
  the number of static helpers rather than by anything about cohesion.
- **Classes with fewer than two eligible methods.** One method cannot be
  incohesive and zero methods is a data holder; scoring them would fill the
  results with dataclasses.

## Scope rules (LCOM4)

- A **nested class** has its own `self`. Its methods are scored as their own
  class, and its `self.X` references never link the outer class's methods.
- A **closure inside a method** is part of that method. A nested function
  touching `self.value` is that method touching `self.value` — **unless it
  rebinds the receiver name**, either as a parameter (`def inner(self): …`,
  `lambda self: …`) or by assignment in its own body (`def inner(c): self = c`).
  Attributing a rebound receiver's reads to the enclosing method invented an
  edge and merged two independent method groups into a falsely cohesive class.
- **Only a nested callable's body is shadowed, never its signature.**
  Decorators, parameter defaults and annotations evaluate in the enclosing
  scope, before the nested parameters exist — so in
  `def inner(value=self.shared, self=None)` the default reads the *outer*
  receiver and counts.
- Names that match a method are not counted as **fields**. A class whose only
  links are calls is flagged `no shared fields` — a namespace of related
  functions is a legitimate shape and is not the same evidence as methods
  agreeing about data.

## Module cohesion

- A module is a **directory** (or the first N path segments under `--depth`),
  the same unit `main_sequence.py` uses.
- An edge exists when one file in the module imports another **in the same
  module**. Cross-module imports are ignored: `pkg` importing `other` says
  nothing about whether pkg's own files belong together, and counting it would
  make every well-connected consumer look cohesive.
- Import resolution is **reused from `main_sequence.py`**, not re-derived. One
  home for that rule; its resolution limits below apply here unchanged.
- Modules with fewer than two files are not scored.

## What counts as public API

**"Top-level" means module scope, not `tree.body`.** The scan descends through
module-level control flow — `if TYPE_CHECKING:`, `try/except ImportError:`,
`for`, `while`, `with`, `match` — because a name bound in any of those *is* a
module attribute at runtime. It does not descend into `def` or `class` bodies,
which open a new scope. Reading only the outermost statement list reported a
surface of **zero** for any module using the `try: import fast as impl /
except ImportError: import slow as impl` idiom.

The counting rules below are checked against an oracle: `test_api_surface.py`
imports each fixture and compares the parser's answer to what the interpreter
actually bound. Hand-written expectations only restate the parser author's
assumptions; the oracle is what catches the cases the author did not think of.

- A module-scope name not starting with `_`: functions, classes, module
  constants, tuple/starred unpacking targets, `for` and `with … as` targets,
  walrus (`:=`) targets, `match` capture patterns (`case {'k': NAME}`,
  `case … as NAME`, `case [*NAME]`), and PEP 695 `type` aliases.
- `del NAME` removes it from the surface.
- **`except E as err:` binds nothing.** Python compiles an implicit `del err`
  at the end of the handler, so the name is gone afterwards — even if the body
  reassigned it.
- **A walrus inside a lambda body binds nothing** outside it; a walrus in a
  lambda's *default* does bind, because defaults evaluate where the lambda is
  written. A walrus in a comprehension binds in the enclosing scope (PEP 572).
- **The final binding wins.** `from x import Thing` followed by `class Thing:`
  is a local definition, not a re-export.
- **Imports count**, and are reported separately as `reexports`. `from .core
  import Thing` genuinely makes `Thing` an attribute of this module. `import
  a.b.c` binds `a`, not `a.b.c`.
- **An explicit `__all__` is the surface**, underscores included — a module
  listing `_internal` in `__all__` has decided it is public. That is what
  `__all__` is for.
- **`__all__` is evaluated in statement order, not unioned.** A later
  `__all__ = [...]` **replaces** everything before it, including an earlier
  computed value; `__all__ += [...]`, `__all__.extend([...])` and
  `__all__.append("x")` extend the current state. Accumulating every literal
  into a union reported `{'a','b'}` for a module whose real surface was `{'b'}`.

## What is not public API

- Anything under a `_` prefix, including dunders, absent an `__all__`.
- **Bindings that bind nothing new.** `registry[key] = value` and `obj.attr =
  value` bind no module-level name. A bare annotation (`counter: int`) declares
  a type and binds nothing at runtime.
- Anything not at the top level — nested definitions, class methods, and imports
  inside a function are not module surface.

## The `__all__` fallback

A computed `__all__` (`__all__ = _build()`, `__all__ = ['a'] + OTHER`) cannot be
read statically. The file falls back to the underscore convention and is flagged
`computed __all__`. Guessing the contents would be worse than admitting it.

`del __all__` restores the convention — it does not freeze the last literal.

**In-place mutation (`__all__[0] = 'NEW'`, `del __all__[0]`) makes the list
unreadable**, but every entry the mutation itself names is still recorded. From
that point the file keeps a conservative set: the literal in force when it went
unreadable, plus every later `append`/`extend`/`+=`/subscript assignment whose
value is itself a literal. That set only ever grows — a `.remove()` this walker
cannot evaluate must not delete a name some other path still exports.

**The guarantee, precisely: a superset over mutations this walker can read, not
over all mutations.** `__all__[0] = 'NEW'` reports both `NEW` and the name it
replaced, which is the intended over-report. But a mutation whose *value* is
computed — `__all__ += OTHER`, `__all__[:] = _build()`, or an alias
(`names = __all__; names.append(x)`) — adds names nothing static can recover,
and those are simply missing. Over-reporting is visible and conservative;
claiming a superset that a computed append can silently break is not.

A `from x import *` rebinds an unknown set of names into the module namespace.
The module is flagged `wildcard import` and its count is a **lower bound**.

## Honest limits

- **Python only.** Any other language is invisible, and a run over a polyglot
  repo silently measures the part it understands. Say so in the Sampling Notice.
  This is the same deliberate choice `main_sequence.py` made: `ast` is exact,
  and hand-lexing another language is where the wrong numbers come from.
- **LCOM4 sees declared structure, not behavior.** Methods coordinating through
  a module-level global, a database row, or an injected collaborator share state
  the metric cannot see, and will read as separate groups.
- **Inherited state is invisible.** A method reading `self.x` where `x` is
  defined in a base class links correctly to siblings that also read it, but a
  class whose cohesion lives entirely in its parent reads as incohesive.
- **Dynamic attributes are invisible.** `setattr(self, name, value)`,
  `__getattr__`, and dict-backed attribute access produce no `self.X` node.
- **An `__all__` reached through an alias is invisible.** The walker matches the
  name `__all__`, so `names = __all__; names.append(EXPORT)` mutates the real
  list while nothing static connects the two. Same for a mutation whose value is
  computed (`__all__ += _build()`). This is the one place the surface can
  under-report rather than over-report, and it is why the fallback promises a
  superset only over mutations it can read.
- **Module cohesion inherits every import-resolution limit** in
  `component-coupling-metrics.md` — ambiguous imports are dropped, absolute
  imports guess the source root, and a namespace package with no `__init__.py`
  may not be matched. `groups` is therefore an **upper bound**: unresolved
  imports read as absent edges.
- **API surface counts names, not compatibility.** Changing a function's
  signature breaks callers and moves no number here. Renaming one export and
  adding another nets to zero delta.
- **Re-exports are counted at both sites.** A name defined in `pkg/a.py` and
  re-exported from `pkg/__init__.py` contributes to `public` twice, because both
  are genuinely reachable. Compare `declared` against `interior` rather than
  reading `public` as a count of distinct symbols.
- **`delta` compares module names.** A renamed or moved module reads as one
  module disappearing (a negative `removed_modules` row) and a new one appearing
  at its full surface. The two cancel in the net, which is correct arithmetic
  and still hides that a rename happened.
- **`--depth` can collapse several packages into one component.** When that
  component contains more than one `__init__.py`, `declared` is reported as
  null rather than picking one, and `front_doors` carries the count. "The front
  door" is not a well-defined quantity for a collapsed component.
- **Unparseable and unreadable files are reported, not skipped.** They
  contribute no names and no classes, so an affected module's counts are bounds
  rather than measurements; the summary and the JSON both say how many.
- **Rebinding provenance is tracked; conditional execution is not evaluated.**
  A name bound in both branches of an `if` counts once, and a name bound only in
  a branch that never executes still counts. The scan is static.
- **Neither metric is calibrated.** There is no threshold here, no band, and no
  evidence that any particular value predicts anything in this harness.
