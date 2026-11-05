# Reference: Component Coupling Metrics

Load when Phase 2 needs coupling hotspots, or when a finding turns on whether a
module boundary is in the right place. Phase 2 otherwise identifies hotspots by
reading imports, which cannot see a dependency that closes through files the
sample never opened.

Function-local complexity says nothing about whether a boundary is correct. A
package of 5-line functions passes every structural gate in this toolkit and can
still be the thing that makes the codebase expensive to change. These metrics
measure that property at the component level, where boundaries live.

**Source:** Robert C. Martin, *Agile Software Development: Principles, Patterns,
and Practices* (2002), ch. 20; restated in *Clean Architecture* (2017), ch. 14.
Book material, not a paper — which is why the equations do not surface in a
search for the formula alone. JDepend, the Java tool that implemented them,
popularised the notation used here.

## The metric set

| Metric | Definition | Reading |
|---|---|---|
| **Ca** — afferent coupling | components outside that depend on this one | incoming; how much breaks if this changes |
| **Ce** — efferent coupling | components this one depends on | outgoing; how much can break this |
| **I** — instability | `Ce / (Ca + Ce)`, 0→1 | 0 = everyone depends on you and you depend on nobody; 1 = you depend on everything and nobody depends on you |
| **A** — abstractness | `abstract types / total types`, 0→1 | 1 = nothing but contracts |
| **D** — distance | `\|A + I − 1\|`, 0→1 | how far from the line `A + I = 1` |

The line `A + I = 1` is the **main sequence**. The claim behind it: a component
should be either **abstract and stable** or **concrete and unstable**. Sitting
far from that line means one of two named failures.

- **Zone of Pain** (A→0, I→0) — concrete, and everyone depends on it. Hard to
  change and expensive when you do. A core at `A=0.06, I=0.02, Ca=104` is
  sitting in it. **Both coordinates are load-bearing**: `I=0.02, Ca=104` with a
  high `A` is a stable abstract core, which is where a core is supposed to be.
  Never call something Pain from `I` and `Ca` alone.
- **Zone of Uselessness** (A→1, I→1) — abstract, and hardly anything uses it.
  Dead abstraction: interfaces, base classes and type modules with no
  implementors and no callers. The corner Martin names is `Ca=0`; the region
  the script reports also catches components with a few dependents and many
  dependencies, which is a weaker claim — read `Ca` before calling it dead.

**Ca is the multiplier on pain.** `A=0, I=0` with `Ca=2` is a leaf nobody cares
about; the same numbers with `Ca=104` is why every change costs a week. Always
read D next to Ca — the script prints them side by side for this reason.

## Running it

```bash
python3 <AI_DEV_SHOP_ROOT>/skills/codebase-analysis/scripts/main_sequence.py <SOURCE_ROOT>
```

**Python only.** Imports come from `ast`, so extraction is exact and only
resolution is heuristic. Useful flags:

| Flag | Effect |
|---|---|
| `--depth N` | collapse components to the first N path segments (default: the containing directory) |
| `--plot` | ASCII A-vs-I scatter with the main sequence drawn in |
| `--top N` | worst N rows only |
| `--sort ca` | rank by incoming dependencies rather than distance |
| `--json` | machine-readable, including each component's `depends_on` / `depended_on_by` |
| `--exclude DIR` | skip an extra directory name (repeatable), on top of the default list |
| `--source-root services/worker` | declare a directory that is on `sys.path` (repeatable) — needed when a real Python root matches no naming convention or project marker |
| `--include-tests` | count test files — off by default, because tests import production code and inflate its Ca |

Point it at the source root, not the repo root: a repo root sweeps fixtures,
examples and generated trees into the table. Use `--depth` on large trees, or
the component list is one row per directory.

The script **always exits 0**. It has no threshold flag and no baseline file, by
design — see "This is evidence, not a finding".

## Reading the output

```
component        files  types   abs    Ca    Ce      I      A      D  zone         notes
serena/util         17     26     0     7     4   0.36   0.00   0.64  far
```

Rows are ranked worst-distance-first, with isolated components sunk to the
bottom.

| Zone | Meaning | The move |
|---|---|---|
| `pain` | concrete and depended upon | extract the interface its dependents actually use, and depend on that. If `Ce` is also high it is a hub — split by client, not by noun. |
| `uselessness` | abstract and unused | delete it, or find the second implementor that justified it. An abstraction with one implementor and no external callers is speculative. |
| `near` / `drift` / `far` | distance bands | `far` on a low-`Ca` component is usually not worth acting on |
| `isolated` | `Ca + Ce = 0` | not a finding. Nothing depends on it, so its concreteness costs nothing — but check it is not dead code. |

The `notes` column is where `A` admits what it could not see. `I = 0` when
`Ca + Ce = 0` and `A = 0` when a component declares no types at all are both
assigned by convention rather than measured — a function-only module offers no
type-level abstraction, so `A=0` is the honest reading, but it did not come from
a type population. `no concrete types` marks the opposite hazard: `A=1.0` from a
population with no implementations in it. Read the `abs` column next to `types`
before believing any `A` value.

## How this feeds the analysis

| Phase 2 output | What the metrics supply |
|---|---|
| Coupling hotspots | `--sort ca`. The top rows are the depended-upon-by-many the phase asks for, counted rather than sampled — **components (directories), not individual files**. |
| Missing layers | a component in `pain` with high `Ca` is the mechanical signature of "no repository interfaces" — concrete, and everyone depends on it |
| Layer map | `--json` carries `depends_on` / `depended_on_by` per component, which is the layer map with the direction attached |

Dependency-direction violations and circular dependencies are **not** covered
here. Those are `no_cycle` and boundary-rule concerns owned by
`<AI_DEV_SHOP_ROOT>/harness-engineering/sensors/dependency-structure.md`; a high
`Ce` is not a cycle and must not be reported as one.

## This is evidence, not a finding

- **No calibrated thresholds exist.** Martin gives the line, not a cutoff. The
  `0.3` zone edges and the `near`/`drift`/`far` bands are the script's own
  convention, uncalibrated against anything. They order rows; they do not
  decide.
- **Not registered in
  `<AI_DEV_SHOP_ROOT>/harness-engineering/quality/gate-validation-status.md`.**
  It is not a sensor, it produces no findings, and no disposition is derived
  from it.
- **D is trivially gamed.** Adding a one-method interface in front of a class
  moves `A` without changing anything about how the system is coupled.
  Ratcheting on D would incentivise exactly that.
- **One thing here does block, and it is not the metric.** The script's own
  counting-rule tests run in `run-all.sh`, so a regression in the *script*
  fails that profile. That is an integrity check on the measuring instrument.
  No measured value from a subject codebase blocks anything, ever.
- A `D` value belongs in a finding's **Evidence**, never in its severity. Flaw
  categories and severities come from the SKILL's own table; a distance band is
  not one of them.

## Honest limits

- **Import-graph only.** Runtime coupling through DI containers, string-keyed
  registries, dynamic import, reflection or an event bus is invisible — a
  component can read `I=0` and be coupled to everything.
- **A is a proxy.** Counting `ABC`/`Protocol`/`abstractmethod`
  measures declared abstraction, not useful abstraction. Ten interfaces with one
  implementor each score `A=1.0` and abstract nothing.
- **Ce counts analysed components only.** Third-party and stdlib dependencies
  are dropped, same as JDepend — `I` measures internal instability. A component
  wrapping five vendor SDKs looks stable here.
- **Relative imports resolve by path; absolute ones do not.** `from ..pkg import
  x` is lexical and exact. An absolute `import pkg.mod` has to guess which
  directory is on `sys.path` (see `--source-root`), so a tree importing itself
  through a root this cannot infer under-reports, and a package directory with
  no `__init__.py` referenced as `import ns.sub` is not matched at all, because
  only files are indexed.
- **Symlinked source is followed to its target.** Paths are resolved, so a file
  reached through an alias directory is attributed to the real directory, not
  the alias.
- **Python resolution stays heuristic.** A top-level module sharing a name with
  an installed distribution can still absorb that import when it sits in a
  directory that looks like a source root, and a real root that matches no
  convention or marker (`services/worker` in a monorepo) is not found on its
  own. Pass `--source-root` to state the layout instead of leaving it to the
  guess. Affected components are inspectable in `--json` under `depends_on`.
- **Ambiguous Python imports are dropped, not guessed.** When two files share a
  resolvable suffix the run reports the count, and `Ce` is a lower bound for the
  components involved.
- **`from pkg import child` counts as depending on both `pkg` and `pkg.child`.**
  Usually correct — importing a subpackage does import its parent. It
  over-counts in the single case where `child` is an attribute bound in
  `pkg/__init__.py` *and* a subpackage directory of that name exists, which no
  import graph can disambiguate without executing the module.
- **Components are directories.** That is the usual unit for the metric, but it
  reads a badly-organised tree as badly-designed. Check the component list looks
  like the architecture before trusting the numbers.
- **Python only.** Any other language is invisible, and a run over a polyglot
  repo silently measures the part it understands. Say so in the Sampling Notice.
  TS/JS support was removed deliberately: it required hand-lexing JavaScript,
  which produced every parsing defect this script ever had, while `ast` makes
  the Python side exact for nothing.

---

# Counting rules

Every rule below is fixed by a named test (where the table says otherwise, it says so explicitly) in `../scripts/test_main_sequence.py`.
Change a rule, change its test — a counting rule with no test is a claim about
arithmetic nobody has checked.

```bash
python3 -m pytest <AI_DEV_SHOP_ROOT>/skills/codebase-analysis/scripts/ -q
```

These run in the `hard` and `precommit` profiles of
`<AI_DEV_SHOP_ROOT>/harness-engineering/validators/run-all.sh`. The negative
controls — an external import that must not count toward `Ce`, a component's
own files that must not count toward `Ce`, a local module that must not absorb a
third-party import — are load-bearing: over-counting is how this script fails
silently.

## What a component is

The directory a file sits in, relative to the source root. `--depth N` collapses
to the first N path segments. Rows are directories, so the table is only as
meaningful as the tree — a repo that scatters one layer across six directories
reports six components.

| Rule | Test |
|---|---|
| `--depth 0` gives the containing directory; `--depth 2` collapses to two segments | `test_depth_collapses_components` |
| Vendor and build directories are skipped (`node_modules`, `dist`, `build`, `.venv`, `__pycache__`, …) | `test_each_excluded_directory_is_actually_skipped` |
| Test files are excluded by default and included under `--include-tests` | `test_tests_are_excluded_by_default_and_included_on_request` |

Tests are excluded by default because they import production code, which raises
`Ca` on everything they cover and makes a well-tested component read as more
stable than it is.

## Ca and Ce

Both are **component counts, not edge counts**. Ten imports of one component is
`Ce = 1`.

| Rule | Test |
|---|---|
| `Ca` = distinct components containing a file that imports into this one | `test_ca_counts_distinct_dependent_components` |
| `Ce` = distinct components this one imports from | `test_ce_counts_components_not_import_statements` |
| An import inside the same component is not coupling | `test_intra_component_imports_are_not_coupling` |
| Stdlib and third-party imports resolve to nothing and are dropped | `test_external_packages_are_not_counted_in_ce` |
| A mutual dependency gives both sides `Ca=1, Ce=1, I=0.5` | `test_mutual_dependency_gives_both_instability_one_half` |

Dropping external imports matches JDepend: `I` measures instability against the
analysed set. A component wrapping five vendor SDKs and nothing else scores
`Ce = 0`.

## Import resolution

**Python** — parsed with `ast`, so commented and string-embedded imports cannot
register.

| Rule | Test |
|---|---|
| Relative imports (`from ..domain.model import X`) resolve against the file's package, and `from .x` is the file's own package, not its parent | `test_relative_imports_resolve_across_components`, `test_single_dot_relative_import_resolves_within_the_package` |
| A module is indexed under each suffix of its dotted path **whose implied import root is not itself a package**, so `pkg.mod` resolves whether the import root is the repo root or `src/` | `test_import_root_below_repo_root_still_resolves` |
| A local file cannot absorb an unrelated third-party import: `src/pkg/requests.py` is not registered as bare `requests` while `src/pkg` is a package | `test_local_module_shadowing_a_third_party_name_is_not_internal_coupling` |
| A specifier whose first segment is a stdlib module is always external, whatever the tree contains | `test_local_module_named_like_stdlib_does_not_absorb_the_stdlib_import` |
| A suffix matching more than one file is **ambiguous and dropped**, counted in the run summary — never guessed | `test_ambiguous_suffix_is_dropped_and_counted_not_guessed` |
| A file that fails to parse contributes nothing and does not abort the run | `test_syntax_error_does_not_abort_the_run` |

`from pkg.sub import name` registers both `pkg.sub.name` (a submodule, if one
exists) and `pkg.sub` (the package). Importing a submodule does depend on its
package, and at directory granularity both resolve to the same component.

## A — abstractness

`abstract types / total types`, counted per component.

**Python** (`ast`):

| Counted as abstract | Counted as concrete | Not counted at all |
|---|---|---|
| a class inheriting `ABC` / `abc.ABC` | any other class | anything that is not a `ClassDef` |
| a class with `metaclass=ABCMeta` | | |
| a class inheriting `typing.Protocol` | | |
| a class with any `@abstractmethod`-family decorator | | |

`Generic[T]` alone is **not** abstraction — it is parameterisation, and a
generic container is as concrete as any other class
(`test_python_generic_alone_is_not_abstract`). The four abstract forms are fixed
by `test_python_abstractness_counts_abc_protocol_and_abstractmethod`.

## The two 0/0 conventions

Both are assigned, not measured, and both are flagged in the output.

| Case | Value | Why | Test |
|---|---|---|---|
| `Ca + Ce = 0` | `I = 0`, zone `isolated` | Nothing forces it to change, which is the limit from the `Ce → 0` side. But nothing depends on it either, so it is **not** the Zone of Pain, and it sorts to the bottom and is left out of the mean. | `test_isolated_component_is_not_classified_as_pain`, `test_isolated_components_sort_last_and_leave_mean_distance_alone` |
| `total types = 0` | `A = 0`, note `no types` | A component of plain functions offers no type-level abstraction. Honest, but not derived from a type population — hence the note. | `test_component_with_no_classes_reports_abstractness_zero_and_zero_types` |

The isolated rule was added after the first real run, where disconnected fixture
directories sat at `A=0, I=0, D=1.0` and filled the top of the table with
"pain" rows nobody could act on. The arithmetic was right and the ranking was
useless; the corner only means pain when `Ca` is non-zero.

## Zones and bands

Martin names the two **corners**. Turning a corner into a region needs a cut
line, and the cut lines here are the script's convention with nothing behind
them but readability:

| Classification | Rule |
|---|---|
| `pain` | `A ≤ 0.3` and `I ≤ 0.3`, and not isolated |
| `uselessness` | `A ≥ 0.7` and `I ≥ 0.7` |
| `near` | `D ≤ 0.2` |
| `drift` | `D ≤ 0.5` |
| `far` | otherwise |

All four cut lines are **inclusive**, and each is pinned at its exact stated
value by `test_zone_cut_lines_are_inclusive_at_the_stated_edges` — the
corner-only cases in `test_zone_of_pain_is_concrete_and_depended_upon`,
`test_zone_of_uselessness_is_abstract_and_unused` and
`test_distance_is_zero_on_the_main_sequence` cannot see a band edge move by 0.1,
which is the whole risk with a convention nobody calibrated.

They order rows. They are not thresholds, nothing is scored against them, and
the script exits 0 whatever they say
(`test_cli_exits_zero_when_a_component_is_in_pain`).
