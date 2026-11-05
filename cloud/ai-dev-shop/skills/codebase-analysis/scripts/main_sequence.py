#!/usr/bin/env python3
"""Compute Robert C. Martin's package-design metrics for a source tree.

Source: Martin, *Agile Software Development: Principles, Patterns, and
Practices* (2002), ch. 20; restated in *Clean Architecture* (2017), ch. 14.
Popularised by JDepend, whose notation this follows.

    Ca  afferent coupling  — components outside that depend on this one
    Ce  efferent coupling  — components this one depends on
    I   instability        = Ce / (Ca + Ce)          0 = nothing forces it to change
    A   abstractness       = abstract types / types  1 = nothing but contracts
    D   distance           = |A + I - 1|             0 = on the main sequence

The main sequence is the line A + I = 1: a component should be either abstract
and depended upon, or concrete and depending. The two corners have names —
(A=0, I=0) is the Zone of Pain, (A=1, I=1) the Zone of Uselessness.

This is a DIAGNOSTIC. It prints numbers and exits 0. It is not a gate, it has
no thresholds anyone has calibrated, and nothing in the harness consumes its
output.

Phase 2 of ../SKILL.md is the caller. Counting rules, conventions, ambiguities
and known blind spots are documented in
../references/component-coupling-metrics.md; every rule there has a test in
test_main_sequence.py.
"""

from __future__ import annotations

import argparse
import ast
import json
import re
import sys
import tokenize
from dataclasses import dataclass, field
from pathlib import Path

PY_EXTENSIONS = frozenset({".py"})
SOURCE_EXTENSIONS = PY_EXTENSIONS

DEFAULT_EXCLUDED_DIRS = frozenset(
    {
        ".git",
        ".hg",
        ".svn",
        ".venv",
        "venv",
        "env",
        "node_modules",
        "__pycache__",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        "build",
        "dist",
        "vendor",
        "site-packages",
    }
)

# Tests import production code, which inflates Ca on everything they cover and
# makes a heavily-tested component look artificially stable. Excluded by
# default; --include-tests turns them back on.
TEST_DIR_NAMES = frozenset({"test", "tests", "__tests__", "spec", "e2e", "testing"})
TEST_FILE_RE = re.compile(r"(^test_.*|.*_test)\.py$")

STDLIB_MODULE_NAMES = frozenset(getattr(sys, "stdlib_module_names", ()))

# A bare one-segment name (`requests`) is the only shape that can collide with
# an installed distribution, so it is registered only from a directory that
# plausibly sits on sys.path: the repo root, a conventional source directory, or
# one carrying a project marker. Dotted names are unaffected.
SOURCE_ROOT_NAMES = frozenset({"src", "lib", "app", "source", "python", "server", "backend"})
SOURCE_ROOT_MARKERS = ("pyproject.toml", "setup.py", "setup.cfg")

ABSTRACT_BASE_NAMES = frozenset({"ABC", "ABCMeta", "Protocol", "Generic"})
ABSTRACT_DECORATOR_NAMES = frozenset(
    {"abstractmethod", "abstractproperty", "abstractclassmethod", "abstractstaticmethod"}
)

# Named zones from the book. The corners are Martin's; the 0.3 / 0.7 cut lines
# that turn a corner into a region are this script's convention and are not
# calibrated against anything. Same for the distance bands.
ZONE_EDGE = 0.3
DISTANCE_BANDS = ((0.2, "near"), (0.5, "drift"))


@dataclass
class SourceFile:
    path: Path
    relative: str
    component: str
    imports: set[str] = field(default_factory=set)
    exact_imports: set[str] = field(default_factory=set)
    resolved: set[Path] = field(default_factory=set)
    total_types: int = 0
    abstract_types: int = 0


@dataclass
class Component:
    name: str
    files: int = 0
    total_types: int = 0
    abstract_types: int = 0
    depends_on: set[str] = field(default_factory=set)
    depended_on_by: set[str] = field(default_factory=set)

    @property
    def ce(self) -> int:
        return len(self.depends_on)

    @property
    def ca(self) -> int:
        return len(self.depended_on_by)

    @property
    def instability(self) -> float:
        total = self.ca + self.ce
        if total == 0:
            # Isolated: nothing depends on it and it depends on nothing. The
            # formula is 0/0 here. Reported as I=0 (nothing can force it to
            # change) and flagged `isolated` so the reader knows the value was
            # assigned by convention, not measured.
            return 0.0
        return self.ce / total

    @property
    def abstractness(self) -> float:
        if self.total_types == 0:
            # A component of plain functions offers no type-level abstraction,
            # so A=0 is the honest reading — but it was not measured from a
            # type population, and the `types` column shows 0 so a reader can
            # tell the difference.
            return 0.0
        return self.abstract_types / self.total_types

    @property
    def distance(self) -> float:
        return abs(self.abstractness + self.instability - 1.0)

    @property
    def zone(self) -> str:
        # An isolated component is not in pain — nothing depends on it, so
        # nothing is made expensive by its concreteness. Its I was assigned by
        # convention, so classifying it against the main sequence would rank a
        # disconnected fixture directory alongside a real load-bearing core.
        if self.isolated:
            return "isolated"
        a, i = self.abstractness, self.instability
        if a <= ZONE_EDGE and i <= ZONE_EDGE:
            return "pain"
        if a >= 1.0 - ZONE_EDGE and i >= 1.0 - ZONE_EDGE:
            return "uselessness"
        for edge, name in DISTANCE_BANDS:
            if self.distance <= edge:
                return name
        return "far"

    @property
    def isolated(self) -> bool:
        return self.ca + self.ce == 0

    @property
    def notes(self) -> str:
        flags = []
        if self.isolated:
            flags.append("isolated")
        if self.total_types == 0:
            flags.append("no types")
        elif self.abstract_types == self.total_types:
            # A=1.0 from a population with no implementations. A ports package
            # legitimately looks like this — so does a directory of function
            # components whose only declared types are `Props` interfaces.
            flags.append("no concrete types")
        return ", ".join(flags)


@dataclass
class Analysis:
    components: dict[str, Component]
    files: list[SourceFile]
    ambiguous_specifiers: set[tuple[str, str]] = field(default_factory=set)
    external_imports: int = 0

    @property
    def ambiguous_imports(self) -> int:
        # Counted per distinct specifier: `from pkg.mod import X` registers both
        # `pkg.mod.X` and `pkg.mod`, so incrementing per lookup double-counted
        # one statement.
        return len(self.ambiguous_specifiers)


# ---------------------------------------------------------------- discovery


def is_test_path(path: Path, root: Path) -> bool:
    relative_parts = path.relative_to(root).parts
    if any(part.lower() in TEST_DIR_NAMES for part in relative_parts[:-1]):
        return True
    return bool(TEST_FILE_RE.match(path.name))


def discover_files(root: Path, include_tests: bool, extra_excludes: frozenset[str]) -> list[Path]:
    excluded = DEFAULT_EXCLUDED_DIRS | extra_excludes
    found: list[Path] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix not in SOURCE_EXTENSIONS:
            continue
        relative_parts = path.relative_to(root).parts
        if any(part in excluded for part in relative_parts[:-1]):
            continue
        if not include_tests and is_test_path(path, root):
            continue
        found.append(path)
    return found


def component_for(relative: str, depth: int) -> str:
    parts = Path(relative).parts[:-1]
    if not parts:
        return "."
    if depth > 0:
        parts = parts[:depth]
    return "/".join(parts)


# ------------------------------------------------------------------ python


def python_module_names(
    relative: str, root: Path, declared_roots: frozenset[Path] = frozenset()
) -> list[str]:
    """Every dotted name this file could plausibly be imported as.

    A repository root is not necessarily an import root: `src/pkg/mod.py` is
    imported as `pkg.mod` when `src` is on sys.path, and as `src.pkg.mod` when
    the repo root is. Both are registered, so neither layout has to be declared.

    What is *not* registered is a name whose implied import root is itself a
    package. If `src/pkg/__init__.py` exists, the conventional layout imports
    that tree as `pkg.…`, so registering `src/pkg/requests.py` as plain
    `requests` made an unrelated `import requests` resolve to a local file and
    fabricate coupling. Nothing forbids putting a package directory on sys.path
    directly; this rule trades that unusual layout for not inventing edges in
    the common one. A namespace-package tree with no `__init__.py` anywhere is
    still exposed — recorded in the reference doc's Honest limits.

    Suffixes that resolve to more than one file are treated as ambiguous at
    lookup time rather than guessed at.
    """
    parts = list(Path(relative).with_suffix("").parts)
    if parts and parts[-1] == "__init__":
        parts.pop()
    if not parts:
        return []

    names: list[str] = []
    for index in range(len(parts)):
        # parts[:index] is the directory that would have to be the import root.
        implied_root = root.joinpath(*parts[:index]) if index else root
        declared = bool(index) and implied_root.resolve() in declared_roots
        if index and not declared and (implied_root / "__init__.py").exists():
            # A package directory is not normally an import root. `--source-root`
            # is an explicit statement that this one is, so it wins here too —
            # otherwise declaring a root that happens to carry `__init__.py`
            # silently did nothing.
            continue
        if (
            index
            and len(parts) - index == 1
            and not is_plausible_source_root(implied_root, declared_roots)
        ):
            # A bare module name from an arbitrary directory. Registering it let
            # `import requests` bind to a local `requests.py` sitting somewhere
            # unrelated; the package check above misses this when the tree uses
            # namespace packages and has no `__init__.py` at all.
            continue
        names.append(".".join(parts[index:]))
    return names


def is_plausible_source_root(directory: Path, declared_roots: frozenset[Path]) -> bool:
    """Could this directory be on sys.path?

    Declared roots win outright — `--source-root` exists so a layout this cannot
    guess (a monorepo `services/worker` on PYTHONPATH) is stated rather than
    inferred. The name and marker checks below are only the fallback.
    """
    if directory.resolve() in declared_roots:
        return True
    if directory.name in SOURCE_ROOT_NAMES:
        return True
    return any((directory / marker).exists() for marker in SOURCE_ROOT_MARKERS)


def parse_python(source_file: SourceFile, text: str, root: Path) -> None:
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                # `import a.b.c` requires every segment to be a real module, so
                # this one is registered whole. Only `from a.b import c` may
                # fall back to a prefix, because `c` can be an attribute.
                source_file.exact_imports.add(alias.name)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                resolve_relative_import(source_file, node, root)
                continue
            base = node.module or ""
            for alias in node.names:
                source_file.imports.add(f"{base}.{alias.name}" if base else alias.name)
                source_file.imports.add(base)

    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef):
            continue
        source_file.total_types += 1
        if is_abstract_class(node):
            source_file.abstract_types += 1


def resolve_relative_import(source_file: SourceFile, node: ast.ImportFrom, root: Path) -> None:
    """Resolve `from ..pkg import name` by path, the way Python does.

    Relative imports are lexical: level 1 is the containing package, each extra
    dot climbs one directory. Routing them through the dotted-name index instead
    made resolution depend on where the *analysed tree* was rooted, so the same
    file resolved differently under `--depth`, under a package whose
    `__init__.py` sat at the tree root, and under a declared source root. Paths
    have none of that ambiguity.
    """
    base = source_file.path.parent
    for _ in range(node.level - 1):
        if base == root:
            # Climbing past the analysed tree is `ImportError: attempted
            # relative import beyond top-level package`, not a reference to
            # something outside.
            return
        base = base.parent
    if node.module:
        base = base.joinpath(*node.module.split("."))

    for candidate in (base, *(base / alias.name for alias in node.names)):
        for suffix in (".py", "/__init__.py"):
            target = Path(str(candidate) + suffix)
            if target.is_file():
                source_file.resolved.add(target.resolve())


def is_abstract_class(node: ast.ClassDef) -> bool:
    for base in node.bases:
        name = attribute_tail(base)
        if name in ABSTRACT_BASE_NAMES - {"Generic"}:
            return True
    for keyword in node.keywords:
        if keyword.arg == "metaclass" and attribute_tail(keyword.value) == "ABCMeta":
            return True
    for child in node.body:
        if not isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in child.decorator_list:
            if attribute_tail(decorator) in ABSTRACT_DECORATOR_NAMES:
                return True
    return False


def attribute_tail(node: ast.expr) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    if isinstance(node, ast.Subscript):
        return attribute_tail(node.value)
    if isinstance(node, ast.Call):
        return attribute_tail(node.func)
    return ""


# ----------------------------------------------------------------- analysis


def analyse(
    root: Path,
    depth: int,
    include_tests: bool,
    extra_excludes: frozenset[str],
    source_roots: frozenset[Path] = frozenset(),
) -> Analysis:
    root = root.resolve()
    paths = discover_files(root, include_tests, extra_excludes)

    files: list[SourceFile] = []
    for path in paths:
        relative = path.relative_to(root).as_posix()
        files.append(
            SourceFile(
                path=path.resolve(),
                relative=relative,
                component=component_for(relative, depth),
            )
        )

    python_index: dict[str, set[Path]] = {}
    for source_file in files:
        for name in python_module_names(source_file.relative, root, source_roots):
            python_index.setdefault(name, set()).add(source_file.path)

    for source_file in files:
        try:
            # `tokenize.open` honours a PEP 263 `# coding:` declaration. Forcing
            # UTF-8 with replacement corrupted latin-1 sources into a
            # SyntaxError, so a valid module silently contributed nothing.
            with tokenize.open(source_file.path) as handle:
                text = handle.read()
        except (OSError, SyntaxError, UnicodeDecodeError):
            continue
        parse_python(source_file, text, root)

    analysis = Analysis(components={}, files=files)

    for source_file in files:
        component = analysis.components.setdefault(
            source_file.component, Component(name=source_file.component)
        )
        component.files += 1
        component.total_types += source_file.total_types
        component.abstract_types += source_file.abstract_types

    for source_file in files:
        for specifier, exact in [(s, True) for s in sorted(source_file.exact_imports)] + [
            (s, False) for s in sorted(source_file.imports)
        ]:
            if not specifier:
                continue
            target = resolve_python_specifier(
                specifier, python_index, analysis, source_file.relative, exact=exact
            )
            if target is None or target == source_file.path:
                continue
            source_file.resolved.add(target)

    by_path = {source_file.path: source_file for source_file in files}
    for source_file in files:
        for target in source_file.resolved:
            target_file = by_path.get(target)
            if target_file is None or target_file.component == source_file.component:
                continue
            analysis.components[source_file.component].depends_on.add(target_file.component)
            analysis.components[target_file.component].depended_on_by.add(source_file.component)

    return analysis


def resolve_python_specifier(
    specifier: str,
    index: dict[str, set[Path]],
    analysis: Analysis,
    importer: str,
    *,
    exact: bool,
) -> Path | None:
    """Resolve a dotted specifier to a file, or to nothing.

    `exact` distinguishes the two import forms. `import a.b.c` requires every
    segment to be a real module, so a prefix match is not a resolution — falling
    back to `a.b` turned a `ModuleNotFoundError` into a dependency. `from a.b
    import c` may legitimately name an attribute as its last segment, so it
    walks the prefixes.
    """
    parts = specifier.split(".")
    if parts[0] in STDLIB_MODULE_NAMES:
        # A local `json.py` must never absorb `import json`.
        analysis.external_imports += 1
        return None
    cuts = [len(parts)] if exact else range(len(parts), 0, -1)
    for cut in cuts:
        candidate = ".".join(parts[:cut])
        matches = index.get(candidate)
        if not matches:
            continue
        if len(matches) == 1:
            return next(iter(matches))
        # Keyed on (importing file, ambiguous module). One statement can
        # produce two specifiers that both land here, so keying on the specifier
        # double-counted it; keying on the module alone collapsed two files.
        analysis.ambiguous_specifiers.add((importer, candidate))
        return None
    analysis.external_imports += 1
    return None


# ----------------------------------------------------------------- output


def sort_components(analysis: Analysis, order: str) -> list[Component]:
    components = list(analysis.components.values())
    if order == "name":
        return sorted(components, key=lambda component: component.name)
    if order == "ca":
        return sorted(
            components, key=lambda component: (component.isolated, -component.ca, component.name)
        )
    # Isolated components sink: their D is computed from an assigned I, so
    # ranking them by it would put disconnected directories at the top.
    return sorted(
        components,
        key=lambda component: (
            component.isolated,
            -component.distance,
            -component.ca,
            component.name,
        ),
    )


def render_table(components: list[Component], limit: int | None) -> str:
    shown = components if limit is None else components[:limit]
    if not shown:
        return "No components to show."
    name_width = max([len(component.name) for component in shown] + [9])
    header = (
        f"{'component'.ljust(name_width)}  files  types   abs    Ca    Ce      I      A      D  "
        f"{'zone'.ljust(11)}  notes"
    )
    lines = [header, "-" * len(header)]
    for component in shown:
        lines.append(
            f"{component.name.ljust(name_width)}  "
            f"{component.files:5d}  "
            f"{component.total_types:5d}  "
            f"{component.abstract_types:4d}  "
            f"{component.ca:4d}  "
            f"{component.ce:4d}  "
            f"{component.instability:5.2f}  "
            f"{component.abstractness:5.2f}  "
            f"{component.distance:5.2f}  "
            f"{component.zone.ljust(11)}  "
            f"{component.notes}".rstrip()
        )
    if any(component.isolated for component in shown):
        lines.append("")
        lines.append(
            "isolated (Ca+Ce=0): I is 0 by convention, not measured — D is not meaningful."
        )
    if any(component.total_types == 0 for component in shown):
        lines.append(
            "no types: A=0 is the honest reading for function-only code, but it was "
            "not measured from a type population."
        )
    if any(
        component.total_types and component.abstract_types == component.total_types
        for component in shown
    ):
        lines.append(
            "no concrete types: A=1 with no implementations in the component — a ports "
            "package, or a directory whose only types are `Props` interfaces."
        )
    return "\n".join(lines)


def render_summary(analysis: Analysis, components: list[Component]) -> str:
    if not components:
        return "No source files found."
    connected = [component for component in components if not component.isolated]
    isolated = len(components) - len(connected)
    pain = [component for component in components if component.zone == "pain"]
    useless = [component for component in components if component.zone == "uselessness"]
    mean_distance = (
        sum(component.distance for component in connected) / len(connected) if connected else 0.0
    )
    lines = [
        f"{len(components)} components, {len(analysis.files)} files, "
        f"mean D = {mean_distance:.2f} over {len(connected)} connected components",
        f"zone of pain: {len(pain)}   zone of uselessness: {len(useless)}   "
        f"isolated: {isolated}",
    ]
    if analysis.ambiguous_imports:
        lines.append(
            f"{analysis.ambiguous_imports} module reference(s) could not be resolved "
            "unambiguously and were dropped; Ce is a lower bound for the components "
            "involved."
        )
    worst = [component for component in components if component.zone in {"pain", "uselessness"}]
    for component in sorted(worst, key=lambda item: -item.ca)[:3]:
        dependents = f"{component.ca} component" + ("" if component.ca == 1 else "s")
        if component.zone == "pain":
            lines.append(
                f"  {component.name}: concrete (A={component.abstractness:.2f}) and depended on by "
                f"{dependents} — changes here are expensive."
            )
        elif component.ca == 0:
            lines.append(
                f"  {component.name}: abstract (A={component.abstractness:.2f}) and nothing "
                "depends on it — dead abstraction."
            )
        else:
            lines.append(
                f"  {component.name}: abstract (A={component.abstractness:.2f}) but depends on "
                f"{component.ce} components while only {dependents} depend on it — an abstraction "
                "pointing the wrong way."
            )
    return "\n".join(lines)


def render_plot(components: list[Component], width: int = 40, height: int = 15) -> str:
    grid = [[" " for _ in range(width)] for _ in range(height)]
    for row in range(height):
        for column in range(width):
            a = 1.0 - row / (height - 1)
            i = column / (width - 1)
            if abs(a + i - 1.0) < 0.55 / height:
                grid[row][column] = "."
    plotted = [component for component in components if not component.isolated]
    for component in plotted:
        row = int(round((1.0 - component.abstractness) * (height - 1)))
        column = int(round(component.instability * (width - 1)))
        cell = grid[row][column]
        grid[row][column] = "#" if cell in {" ", "."} else "@"

    lines = ["  A"]
    for index, row in enumerate(grid):
        label = "1.0" if index == 0 else ("0.0" if index == height - 1 else "   ")
        lines.append(f"{label} |{''.join(row)}")
    lines.append("     " + "-" * width)
    lines.append("     0.0" + " " * (width - 9) + "1.0  I")
    lines.append("     . = main sequence (A + I = 1)   # = component   @ = overlap")
    lines.append("     top-right = uselessness    bottom-left = pain")
    lines.append(f"     plotted: {len(plotted)} connected of {len(components)} components")
    return "\n".join(lines)


def to_json(analysis: Analysis, components: list[Component]) -> str:
    return json.dumps(
        {
            "convention": {
                "instability_when_isolated": 0.0,
                "abstractness_when_no_types": 0.0,
                "zone_edge": ZONE_EDGE,
                "distance_bands": {name: edge for edge, name in DISTANCE_BANDS},
            },
            "run": {
                "files": len(analysis.files),
                "components": len(analysis.components),
                "components_shown": len(components),
                "ambiguous_imports": analysis.ambiguous_imports,
                "external_imports": analysis.external_imports,
            },
            "components": [
                {
                    "name": component.name,
                    "files": component.files,
                    "types": component.total_types,
                    "abstract_types": component.abstract_types,
                    "ca": component.ca,
                    "ce": component.ce,
                    "instability": round(component.instability, 4),
                    "abstractness": round(component.abstractness, 4),
                    "distance": round(component.distance, 4),
                    "zone": component.zone,
                    "isolated": component.isolated,
                    "depends_on": sorted(component.depends_on),
                    "depended_on_by": sorted(component.depended_on_by),
                }
                for component in components
            ],
        },
        indent=2,
    )


def non_negative(raw: str) -> int:
    value = int(raw)
    if value < 0:
        raise argparse.ArgumentTypeError("must be 0 or greater")
    return value


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="main_sequence.py",
        description=(
            "Compute Ca, Ce, instability, abstractness and distance from the main "
            "sequence for each component of a source tree. Diagnostic only — "
            "always exits 0."
        ),
    )
    parser.add_argument("root", nargs="?", default=".", help="source root (default: .)")
    parser.add_argument(
        "--depth",
        type=int,
        default=0,
        help="collapse components to the first N path segments (0 = containing directory)",
    )
    parser.add_argument("--json", action="store_true", help="emit JSON instead of a table")
    parser.add_argument("--plot", action="store_true", help="also print an A/I scatter plot")
    parser.add_argument(
        "--top",
        type=non_negative,
        default=None,
        help="show only the first N rows (0 shows none)",
    )
    parser.add_argument(
        "--sort",
        choices=("distance", "ca", "name"),
        default="distance",
        help="row order (default: distance, worst first)",
    )
    parser.add_argument(
        "--include-tests",
        action="store_true",
        help="count test files (off by default: tests inflate Ca on the code they cover)",
    )
    parser.add_argument(
        "--exclude",
        action="append",
        default=[],
        metavar="DIR",
        help="additional directory name to skip (repeatable)",
    )
    parser.add_argument(
        "--source-root",
        action="append",
        default=[],
        metavar="DIR",
        help=(
            "directory that is on sys.path, relative to the source root "
            "(repeatable); declares what the layout heuristic cannot guess"
        ),
    )
    return parser



def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    root = Path(args.root)
    if not root.is_dir():
        raise SystemExit(f"not a directory: {root}")

    analysis = analyse(
        root=root,
        depth=args.depth,
        include_tests=args.include_tests,
        extra_excludes=frozenset(args.exclude),
        source_roots=frozenset((root / declared).resolve() for declared in args.source_root),
    )
    components = sort_components(analysis, args.sort)
    # `--top` limits the rows shown, in every output format — the JSON path used
    # to ignore it. The summary still describes the whole run, because a total
    # computed over the truncated list would silently describe something else.
    shown = components if args.top is None else components[: args.top]

    if args.json:
        print(to_json(analysis, shown))
        return 0

    print(render_table(shown, None))
    print()
    print(render_summary(analysis, components))
    if args.plot:
        print()
        print(render_plot(shown))
    return 0


if __name__ == "__main__":
    sys.exit(main())
