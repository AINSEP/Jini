#!/usr/bin/env python3
"""Count the public API surface of each module, and its growth.

Every public name is a promise. A module exporting 8 names can be reshaped; the
same module exporting 80 cannot, because any of the 80 might have a caller. Size
is not a defect on its own -- a serialization library legitimately exports a lot
-- but surface that grows without anyone deciding to grow it is how a module
stops being changeable.

    public      public top-level names, summed over the module's files
    declared    what the package's __init__.py puts on the front door
    reexports   public names bound by an import rather than defined here
    delta       change against a --baseline run

A name is public when it does not start with `_`, except that an explicit
`__all__` overrides the convention -- that is what `__all__` is for, and a file
declaring one has stated its surface rather than leaked it.

`--baseline` takes an earlier `--json` run and reports growth per module. That
is the reading the harness lacks: a diff adding fourteen exports to a domain
package is visible in the delta and invisible in any single run.

This is a DIAGNOSTIC. It prints numbers and exits 0. It is not a gate, it has no
thresholds anyone has calibrated, and nothing in the harness consumes its
output. `harness-engineering/sensors/code-structure-quality.md` records that
public-API growth is covered by no *sensor*; this script does not change that.

Python only, for the reason given in ../references/cohesion-and-api-surface.md.

Phase 2 of ../SKILL.md is the caller. Every counting rule is documented in that
reference and tested in test_api_surface.py.
"""

from __future__ import annotations

import argparse
import ast
import json
import sys
import tokenize
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from main_sequence import component_for, discover_files  # noqa: E402

INIT_NAME = "__init__.py"

# Bumped whenever `--json` changes in a way that makes an older file unsafe to
# read as a `--baseline`. `load_baseline` requires an exact match: a document of
# some other shape that happens to carry a `modules` list is not a baseline, and
# reading one wrongly manufactures growth out of modules it cannot see.
SCHEMA_VERSION = 1


@dataclass
class FileSurface:
    relative: str
    names: set[str] = field(default_factory=set)
    reexports: set[str] = field(default_factory=set)
    declared_all: bool = False
    dynamic_all: bool = False
    wildcard_import: bool = False
    parse_error: bool = False

    @property
    def is_init(self) -> bool:
        return Path(self.relative).name == INIT_NAME


@dataclass
class ModuleSurface:
    name: str
    files: list[FileSurface] = field(default_factory=list)

    @property
    def public(self) -> int:
        return sum(len(f.names) for f in self.files)

    @property
    def reexports(self) -> int:
        return sum(len(f.reexports) for f in self.files)

    @property
    def front_doors(self) -> list[FileSurface]:
        """Every `__init__.py` in this module.

        Usually zero or one. `--depth` can collapse several packages into one
        component, and then there are several — `declared` must not silently
        report the first one's surface as though it were the module's.
        """
        return [surface for surface in self.files if surface.is_init]

    @property
    def declared(self) -> int | None:
        """The package front door.

        None when there is no `__init__.py`, and None when there is more than
        one, because "the front door" is not a well-defined quantity for a
        collapsed component. `front_doors` carries the count either way.
        """
        doors = self.front_doors
        return len(doors[0].names) if len(doors) == 1 else None

    @property
    def interior(self) -> int:
        """Public names outside the front door(s)."""
        return sum(len(f.names) for f in self.files if not f.is_init)

    @property
    def parse_errors(self) -> int:
        return sum(1 for f in self.files if f.parse_error)

    @property
    def notes(self) -> str:
        flags = []
        if len(self.front_doors) > 1:
            flags.append(f"{len(self.front_doors)} front doors")
        if self.parse_errors:
            flags.append(f"{self.parse_errors} unparsed")
        if not self.front_doors and len(self.files) > 1:
            # Nothing marks any of it as the intended entry point, so every
            # public name in every file is reachable surface by default.
            flags.append("no front door")
        if any(f.wildcard_import for f in self.files):
            # `from x import *` rebinds an unknown set of names into this
            # module's namespace. The count below is a lower bound.
            flags.append("wildcard import")
        if any(f.dynamic_all for f in self.files):
            flags.append("computed __all__")
        if self.reexports and self.reexports == self.public:
            flags.append("all re-exports")
        return ", ".join(flags)


# ------------------------------------------------------------------ parsing


def literal_all(node: ast.AST) -> list[str] | None:
    """The string literals in an `__all__` value, or None when it is computed.

    A computed `__all__` (`__all__ = _build()`, `__all__ = A + B`) cannot be read
    statically. Guessing its contents would be worse than admitting it.
    """
    if not isinstance(node, (ast.List, ast.Tuple)):
        return None
    names: list[str] = []
    for element in node.elts:
        if isinstance(element, ast.Constant) and isinstance(element.value, str):
            names.append(element.value)
        else:
            return None
    return names


def target_names(target: ast.expr) -> list[str]:
    """Names an assignment target binds.

    Only binding forms count. `registry[key] = value` and `obj.attr = value`
    bind nothing new at module level -- walking every `ast.Name` inside the
    target counted `registry`, `key` and `obj` as fresh public exports.
    """
    if isinstance(target, ast.Name):
        return [target.id]
    if isinstance(target, (ast.Tuple, ast.List)):
        return [name for element in target.elts for name in target_names(element)]
    if isinstance(target, ast.Starred):
        return target_names(target.value)
    return []


def bound_names(node: ast.stmt) -> list[str]:
    """Top-level names a statement binds."""
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        return [node.name]
    if isinstance(node, ast.Assign):
        return [name for target in node.targets for name in target_names(target)]
    if isinstance(node, ast.AnnAssign):
        if node.value is None:
            # `x: int` with no value declares a type, binds nothing at runtime.
            return []
        return target_names(node.target)
    if isinstance(node, (ast.For, ast.AsyncFor)):
        # `for LOOP_VAR in ...:` at module scope leaves LOOP_VAR bound as a
        # module attribute after the loop. Found by the interpreter oracle.
        return target_names(node.target)
    if isinstance(node, (ast.With, ast.AsyncWith)):
        return [
            name
            for item in node.items
            if item.optional_vars is not None
            for name in target_names(item.optional_vars)
        ]
    if type(node).__name__ == "TypeAlias":
        # PEP 695 `type Alias = int`. A real module attribute; parsed only on
        # Python 3.12+, so it is matched by name rather than by isinstance.
        name = getattr(node, "name", None)
        return [name.id] if isinstance(name, ast.Name) else []
    return []


NESTED_CONTAINERS = (ast.stmt, ast.excepthandler, ast.match_case)


def walrus_in_expression(node: ast.AST, names: list[str]) -> None:
    """Collect `:=` targets that bind in the *enclosing* scope.

    A lambda's body has its own scope, so `lambda: (LEAK := 1)` binds nothing
    outside it — but a lambda's **defaults** are evaluated where the lambda is
    written, so a walrus there does bind. Comprehensions are deliberately walked:
    PEP 572 specifies that a walrus inside one binds in the enclosing scope.
    """
    if isinstance(node, ast.Lambda):
        for default in list(node.args.defaults) + [d for d in node.args.kw_defaults if d]:
            walrus_in_expression(default, names)
        return
    if isinstance(node, ast.NamedExpr) and isinstance(node.target, ast.Name):
        names.append(node.target.id)
    for child in ast.iter_child_nodes(node):
        if isinstance(child, NESTED_CONTAINERS):
            # Statement bodies are visited by the module walker in their own
            # right; entering them here reached into nested scopes.
            continue
        walrus_in_expression(child, names)


def walrus_names(node: ast.stmt) -> list[str]:
    """Names bound by `:=` in a statement's own expressions.

    An `except` clause and a `match` case are pruned as nested containers, but
    only their *bodies* are nested: `except (E := ValueError):` and
    `case x if (G := f(x)):` evaluate in the enclosing scope, so a walrus there
    binds a module attribute. Only this function reaches those two node types --
    they hang off statements, never off an expression, so `walrus_in_expression`
    can never encounter one.
    """
    names: list[str] = []
    for child in ast.iter_child_nodes(node):
        if isinstance(child, NESTED_CONTAINERS):
            if isinstance(child, ast.excepthandler) and child.type is not None:
                walrus_in_expression(child.type, names)
            elif isinstance(child, ast.match_case) and child.guard is not None:
                walrus_in_expression(child.guard, names)
            continue
        walrus_in_expression(child, names)
    return names


def import_names(node: ast.stmt) -> list[str]:
    """Names an import binds into this module's namespace."""
    if isinstance(node, ast.Import):
        # `import a.b` binds `a`, not `a.b`.
        return [alias.asname or alias.name.split(".")[0] for alias in node.names]
    if isinstance(node, ast.ImportFrom):
        return [alias.asname or alias.name for alias in node.names if alias.name != "*"]
    return []


def match_pattern_names(pattern: ast.AST) -> list[str]:
    """Names a `match` case pattern captures.

    `case {'x': CAPTURE}` binds CAPTURE at module scope. Capture patterns are
    not statements and carry their names on the pattern nodes, so a statement
    walk alone never saw them.
    """
    names: list[str] = []
    for node in ast.walk(pattern):
        name = getattr(node, "name", None)
        if isinstance(name, str) and type(node).__name__ in {
            "MatchAs",
            "MatchStar",
        }:
            names.append(name)
        rest = getattr(node, "rest", None)
        if isinstance(rest, str):
            names.append(rest)
    return names


@dataclass
class AllState:
    """Statement-ordered state of a module's `__all__`."""

    value: list[str] | None = None
    dynamic: bool = False
    # The names known to be in `__all__` once its value stopped being readable.
    # Seeded from the literal in force at that instant and grown by every later
    # addition that is itself a literal. Never shrunk: this set is deliberately
    # an over-report, and a `.remove()` this walker cannot evaluate must not be
    # allowed to delete a name that some other path still exports.
    frozen: list[str] | None = None

    def set_literal(self, names: list[str]) -> None:
        # A whole new list discards the old one, and with it the epoch that was
        # accumulating against it.
        self.value, self.dynamic, self.frozen = list(names), False, None

    def extend(self, names: list[str]) -> None:
        if self.dynamic:
            # A literal addition to a list whose contents are no longer known.
            # The list is unreadable; these names are not, and they provably
            # join it. Dropping them was an UNDER-report in the one direction
            # this fallback promises never to fail in.
            self.frozen = (self.frozen or []) + list(names)
        else:
            self.value = (self.value or []) + list(names)

    def mark_dynamic(self, added: list[str] | None = None) -> None:
        if not self.dynamic:
            # Taken only on the transition, and REPLACED rather than unioned on
            # a later one: accumulating every literal in the file reported names
            # a subsequent `__all__ = [...]` had already thrown away.
            self.frozen = None if self.value is None else list(self.value)
        self.dynamic = True
        if added:
            # `__all__[0] = 'NEW'` makes the list unreadable AND names an entry
            # in the same breath. Recording the mutation but discarding its
            # value served the stale name it had just replaced.
            self.frozen = (self.frozen or []) + list(added)

    def clear(self) -> None:
        # `del __all__` removes the attribute, so the underscore convention
        # applies again -- it does not freeze the last literal value.
        self.value, self.dynamic, self.frozen = None, False, None


def subscripts_all(target: ast.expr) -> bool:
    """Whether a target edits `__all__` in place, as `__all__[0]` does."""
    return (
        isinstance(target, ast.Subscript)
        and isinstance(target.value, ast.Name)
        and target.value.id == "__all__"
    )


def subscript_pairs(
    target: ast.expr, value: ast.expr | None
) -> Iterator[tuple[ast.Subscript, ast.expr | None]]:
    """Every `__all__[...]` in a target, paired with the value it receives.

    A subscript can hide inside a destructuring target: `__all__[0], AUX =
    ('NEW', 1)` writes `NEW` into the list, so the pair must be matched
    positionally. Only an equal-length literal sequence can be split that way;
    anything else yields the subscript with no readable value.
    """
    if isinstance(target, (ast.Tuple, ast.List)):
        elements = target.elts
        supplied = value.elts if isinstance(value, (ast.Tuple, ast.List)) else None
        star = next(
            (i for i, element in enumerate(elements) if isinstance(element, ast.Starred)), None
        )
        if star is None:
            matched = supplied if supplied is not None and len(supplied) == len(elements) else None
            for index, element in enumerate(elements):
                yield from subscript_pairs(element, matched[index] if matched else None)
            return
        # A star shifts every position after it, so a plain index-for-index walk
        # paired the wrong value -- or, when the lengths differ because the star
        # absorbs several, paired nothing at all and lost the name entirely.
        head: list[ast.expr] | None = None
        absorbed: list[ast.expr] | None = None
        tail: list[ast.expr] | None = None
        trailing = len(elements) - star - 1
        if supplied is not None and len(supplied) >= len(elements) - 1:
            head = supplied[:star]
            absorbed = supplied[star : len(supplied) - trailing]
            tail = supplied[len(supplied) - trailing :] if trailing else []
        for index, element in enumerate(elements[:star]):
            yield from subscript_pairs(element, head[index] if head else None)
        # A starred target is bound to a LIST of everything it absorbed, which is
        # exactly what a slice assignment receives.
        starred = elements[star].value
        yield from subscript_pairs(
            starred,
            ast.List(elts=list(absorbed), ctx=ast.Store()) if absorbed is not None else None,
        )
        for index, element in enumerate(elements[star + 1 :]):
            yield from subscript_pairs(element, tail[index] if tail else None)
        return
    if subscripts_all(target):
        yield target, value


def subscript_addition(target: ast.Subscript, value: ast.expr | None) -> list[str] | None:
    """Names one in-place `__all__` subscript assignment provably adds.

    The slice form is NOT the index form with a different bracket. `__all__[0] =
    'NEW'` stores one string, but `__all__[:] = 'NEW'` splices an ITERABLE, and
    iterating a string yields its characters -- so that statement exports 'N',
    'E' and 'W'. Reading both as "adds NEW" reported a set the module does not
    have while missing the three names it does.
    """
    if value is None:
        return None
    if isinstance(target.slice, ast.Slice):
        if isinstance(value, ast.Constant) and isinstance(value.value, str):
            return list(value.value)
        return literal_all(value)
    if isinstance(value, ast.Constant) and isinstance(value.value, str):
        return [value.value]
    return None


def all_mutation(node: ast.stmt) -> tuple[str, list[str] | None] | None:
    """Classify a statement's effect on `__all__`.

    Returns (kind, literal) where kind is `set`, `extend` or `dynamic`, or None
    when the statement does not touch `__all__`. Order matters: a later
    assignment REPLACES an earlier one, so accumulating every literal into a
    union reported `{'a','b'}` for a module whose actual surface was `{'b'}`.
    """
    if isinstance(node, (ast.Assign, ast.AnnAssign, ast.Delete)):
        # Checked BEFORE the Name-target test below, which returns early and
        # therefore never saw a subscript target. `del __all__[0]` edits the
        # list in place exactly as `__all__[0] = x` does; matching neither
        # function, it used to be skipped outright and the stale literal served.
        # `AnnAssign` belongs here too: `__all__[0]: str = 'NEW'` is an ordinary
        # in-place write that the annotation does not change.
        if isinstance(node, ast.AnnAssign):
            targets: list[ast.expr] = [node.target]
        else:
            targets = list(node.targets)
        value = None if isinstance(node, ast.Delete) else node.value
        added: list[str] = []
        touched = False
        for target in targets:
            for subscript, element in subscript_pairs(target, value):
                # The list becomes unreadable either way, but an assignment also
                # states what went IN. A `del` names nothing.
                touched = True
                added.extend(subscript_addition(subscript, element) or [])
        if touched:
            return ("dynamic", added or None)
    if isinstance(node, (ast.Assign, ast.AnnAssign)):
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        if not any(isinstance(t, ast.Name) and t.id == "__all__" for t in targets):
            return None
        if node.value is None:
            return None
        literal = literal_all(node.value)
        return ("set", literal) if literal is not None else ("dynamic", None)
    if isinstance(node, ast.AugAssign) and getattr(node.target, "id", "") == "__all__":
        literal = literal_all(node.value)
        return ("extend", literal) if literal is not None else ("dynamic", None)
    if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
        call = node.value
        function = call.func
        if (
            isinstance(function, ast.Attribute)
            and isinstance(function.value, ast.Name)
            and function.value.id == "__all__"
        ):
            if function.attr == "extend" and len(call.args) == 1:
                literal = literal_all(call.args[0])
                return ("extend", literal) if literal is not None else ("dynamic", None)
            if function.attr == "append" and len(call.args) == 1:
                argument = call.args[0]
                if isinstance(argument, ast.Constant) and isinstance(argument.value, str):
                    return ("extend", [argument.value])
            return ("dynamic", None)
    return None


def deleted_names(node: ast.stmt) -> list[str]:
    if isinstance(node, ast.Delete):
        return [t.id for t in node.targets if isinstance(t, ast.Name)]
    return []


def parse_surface(text: str, relative: str) -> FileSurface:
    surface = FileSurface(relative=relative)
    try:
        tree = ast.parse(text)
    except (SyntaxError, ValueError, RecursionError):
        # Recorded, not silently swallowed: "this file has no public names" and
        # "this file could not be read" must not look identical downstream.
        surface.parse_error = True
        return surface

    # Ordered map name -> provenance, so the FINAL binding wins. `from x import
    # Thing` followed by `class Thing:` is a local definition, not a re-export.
    provenance: dict[str, str] = {}
    state = AllState()

    def walk(body: list[ast.stmt]) -> None:
        """Execute module-scope statements in order.

        Recursive rather than a flat generator because two rules need structure:
        a later `__all__` assignment must replace an earlier one, and an
        `except … as err` target must be removed when its handler ends.
        """
        for node in body:
            if isinstance(node, ast.ImportFrom) and any(a.name == "*" for a in node.names):
                surface.wildcard_import = True

            mutation = all_mutation(node)
            if mutation is not None:
                kind, literal = mutation
                if kind == "dynamic":
                    state.mark_dynamic(literal)
                elif kind == "set":
                    state.set_literal(list(literal or []))
                elif kind == "extend":
                    state.extend(list(literal or []))
                # Deliberately no `continue`: `__all__[0] = ALIAS = 'x'` also
                # binds ALIAS, and skipping the rest of the statement dropped it.
                # `__all__` itself is filtered out by name a few lines below.

            for name in deleted_names(node):
                if name == "__all__":
                    state.clear()
                else:
                    provenance.pop(name, None)

            for name in import_names(node):
                provenance[name] = "reexport"
            for name in list(bound_names(node)) + walrus_names(node):
                if name == "__all__":
                    continue
                provenance[name] = "defined"

            if isinstance(node, (ast.If, ast.For, ast.AsyncFor, ast.While)):
                walk(node.body)
                walk(node.orelse)
            elif isinstance(node, ast.Try) or type(node).__name__ == "TryStar":
                walk(node.body)
                for handler in node.handlers:
                    caught = handler.name
                    had_prior, prior = caught in provenance, provenance.get(caught)
                    walk(handler.body)
                    if caught:
                        # Python compiles `except E as err:` with an implicit
                        # `del err` at the end of the handler, so the name is
                        # NOT a module attribute afterwards -- even if the body
                        # reassigned it.
                        provenance.pop(caught, None)
                        if had_prior:
                            # That implicit `del` removes only the HANDLER's own
                            # binding. A binding made before the `try` survives
                            # on the path where nothing was raised, and this
                            # walker models module scope as the union of every
                            # reachable binding.
                            provenance[caught] = prior
                walk(node.orelse)
                walk(node.finalbody)
            elif isinstance(node, (ast.With, ast.AsyncWith)):
                walk(node.body)
            elif isinstance(node, ast.Match):
                for case in node.cases:
                    for name in match_pattern_names(case.pattern):
                        provenance[name] = "defined"
                    walk(case.body)

    walk(tree.body)

    if state.value is not None and not state.dynamic:
        # An explicit `__all__` IS the surface, underscores included: a module
        # exporting `_internal` in `__all__` has decided that is public.
        surface.declared_all = True
        surface.names = set(state.value)
        surface.reexports = {n for n in state.value if provenance.get(n) == "reexport"}
        return surface

    surface.dynamic_all = state.dynamic
    # A dynamic `__all__` is usually an in-place edit of a literal that was
    # readable one statement earlier. Those entries are surface even under a
    # leading underscore -- an `__all__` entry is public by definition, the same
    # rule the branch above applies -- and they are string contents rather than
    # module bindings, so no amount of `provenance` filtering can recover them.
    # Dropping them made this fallback UNDER-report where it promises a superset.
    frozen = set(state.frozen or []) if state.dynamic else set()
    surface.names = {name for name in provenance if not name.startswith("_")} | frozen
    surface.reexports = {n for n in surface.names if provenance.get(n) == "reexport"}
    return surface


# ----------------------------------------------------------------- analysis


def analyse(
    root: Path,
    depth: int,
    include_tests: bool,
    extra_excludes: frozenset[str],
) -> list[ModuleSurface]:
    root = root.resolve()
    modules: dict[str, ModuleSurface] = {}
    for path in discover_files(root, include_tests, extra_excludes):
        relative = path.relative_to(root).as_posix()
        component = component_for(relative, depth)
        module = modules.setdefault(component, ModuleSurface(name=component))
        try:
            with tokenize.open(path) as handle:
                text = handle.read()
        except (OSError, SyntaxError, UnicodeDecodeError):
            # An unreadable file is recorded, not skipped. Skipping made a file
            # with a bad encoding indistinguishable from one with no public
            # names, which is the "report absence, never a zero" rule this
            # toolkit applies to every other measurement.
            module.files.append(FileSurface(relative=relative, parse_error=True))
            continue
        module.files.append(parse_surface(text, relative))
    for module in modules.values():
        module.files.sort(key=lambda surface: surface.relative)
    return sorted(modules.values(), key=lambda module: (-module.public, module.name))


def load_baseline(path: Path) -> dict[str, int] | None:
    """Module -> public count from an earlier --json run, or None if unusable.

    A truncated baseline is REJECTED. `--top` limits the rows in every output
    format, so a baseline captured with it is missing modules — and a missing
    module reads as a brand-new one whose entire surface is growth. Silently
    manufacturing growth is worse than refusing to compute it.
    """
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(payload, dict):
        # A bare list or scalar is not this output's shape at all. Reaching
        # `.get` on it raised AttributeError, and crashing breaks the "reject
        # anything malformed, never guess" contract harder than any shape below.
        return None
    version = payload.get("schema_version")
    if isinstance(version, bool) or version != SCHEMA_VERSION:
        # Absent means written before this field existed, or by something else
        # entirely; unequal means a shape this reader was not written against.
        # Neither can be shown to mean what the rows below are read as, and the
        # cost of guessing is a fabricated trend rather than a visible error.
        return None
    modules = payload.get("modules")
    if not isinstance(modules, list):
        return None
    run = payload.get("run")
    if isinstance(run, dict):
        total, shown = run.get("modules"), run.get("modules_shown")
        if isinstance(total, int) and isinstance(shown, int) and shown < total:
            return None
    elif "run" in payload:
        # Present but not a block: the truncation check above silently did not
        # run, so a `--top` capture could pass itself off as a whole baseline.
        # An unreadable `run` is an unreadable file, not an absent one.
        # Presence, not `is not None`: an explicit `"run": null` is a key this
        # reader cannot read, and only the ABSENT case is legitimately fine.
        return None
    baseline: dict[str, int] = {}
    for module in modules:
        # A row of the wrong shape is REJECTED, not skipped. Skipping made the
        # module look absent from the baseline, so its whole current surface
        # read as growth: `{"public": "5"}` against three current names reported
        # +3 when the real change was -2. A baseline that cannot be read
        # completely cannot be used at all.
        if not isinstance(module, dict):
            return None
        name, public = module.get("name"), module.get("public")
        if not isinstance(name, str) or isinstance(public, bool) or not isinstance(public, int):
            return None
        if name in baseline:
            # Two rows for one module: last-wins silently discarded the first
            # and could invert the sign of the trend it feeds. Which row was
            # meant is exactly what this reader cannot know.
            return None
        baseline[name] = public
    return baseline


def delta_for(module: ModuleSurface, baseline: dict[str, int] | None) -> int | None:
    if baseline is None:
        return None
    # A module absent from the baseline is new; its whole surface is growth.
    return module.public - baseline.get(module.name, 0)


def removed_modules(
    modules: list[ModuleSurface], baseline: dict[str, int] | None
) -> list[tuple[str, int]]:
    """Baseline modules with no current counterpart, as (name, negative delta).

    Iterating only current modules made a deleted package contribute nothing:
    a baseline of `kept=1, removed=5` against a current `kept=1` reported a net
    change of +0 when the real change was -5.
    """
    if baseline is None:
        return []
    present = {module.name for module in modules}
    return sorted(
        ((name, -public) for name, public in baseline.items() if name not in present),
        key=lambda item: item[1],
    )


def net_change(modules: list[ModuleSurface], baseline: dict[str, int] | None) -> int:
    if baseline is None:
        return 0
    current = sum(delta_for(module, baseline) or 0 for module in modules)
    return current + sum(delta for _, delta in removed_modules(modules, baseline))


# ------------------------------------------------------------------- output


def render_table(
    modules: list[ModuleSurface], baseline: dict[str, int] | None, limit: int | None
) -> str:
    shown = modules if limit is None else modules[:limit]
    if not shown:
        return "No modules found."
    width = max(max(len(module.name) for module in shown), 6)
    delta_column = "  delta" if baseline is not None else ""
    header = (
        f"{'module'.ljust(width)}  files  public  reexp  front  interior{delta_column}  notes"
    )
    lines = [header, "-" * len(header)]
    for module in shown:
        declared = module.declared
        front = "  -  " if declared is None else f"{declared:5d}"
        delta = ""
        if baseline is not None:
            value = delta_for(module, baseline)
            delta = f"  {value:+5d}" if value else f"  {'0':>5}"
        lines.append(
            f"{module.name.ljust(width)}  {len(module.files):5d}  {module.public:6d}  "
            f"{module.reexports:5d}  {front}  {module.interior:8d}{delta}  "
            f"{module.notes}".rstrip()
        )
    return "\n".join(lines)


def render_summary(modules: list[ModuleSurface], baseline: dict[str, int] | None) -> str:
    if not modules:
        return "No source files found."
    total = sum(module.public for module in modules)
    lines = [
        f"{len(modules)} module(s), {total} public name(s), "
        f"{sum(module.reexports for module in modules)} re-export(s)"
    ]
    # `not m.front_doors`, never `m.declared is None` -- `declared` is also None
    # for a module with SEVERAL front doors, so the old test made the summary
    # claim a module had no `__init__.py` and two of them in adjacent lines.
    no_door = [m for m in modules if not m.front_doors and len(m.files) > 1]
    if no_door:
        lines.append(
            f"{len(no_door)} multi-file module(s) with no __init__.py: nothing marks the "
            "intended entry point, so every public name is reachable surface."
        )
    if any(m.notes and "wildcard" in m.notes for m in modules):
        lines.append(
            "A wildcard import rebinds an unknown set of names; those counts are lower bounds."
        )
    unparsed = sum(module.parse_errors for module in modules)
    if unparsed:
        lines.append(
            f"{unparsed} file(s) could not be parsed or read; their modules' counts "
            "are lower bounds, not measurements."
        )
    ambiguous = [m for m in modules if len(m.front_doors) > 1]
    if ambiguous:
        lines.append(
            f"{len(ambiguous)} module(s) collapse several packages under --depth, so "
            "`front` is not defined for them; see the front-doors count."
        )
    if baseline is not None:
        grown = [(m, delta_for(m, baseline) or 0) for m in modules]
        grown = sorted([g for g in grown if g[1] > 0], key=lambda item: -item[1])
        removed = removed_modules(modules, baseline)
        lines.append(
            f"net surface change against baseline: {net_change(modules, baseline):+d}"
        )
        for module, delta in grown[:3]:
            lines.append(f"  {module.name}: +{delta} public name(s)")
        for name, delta in removed[:3]:
            lines.append(f"  {name}: {delta} (module no longer present)")
        if not grown and not removed:
            lines.append("  no module grew or disappeared.")
    else:
        lines.append(
            "No --baseline: this is a level, not a trend. Growth is the reading that "
            "distinguishes a large surface someone chose from one that accumulated."
        )
    return "\n".join(lines)


def to_json(
    modules: list[ModuleSurface],
    baseline: dict[str, int] | None,
    config: dict,
    totals: dict,
    removed: list[tuple[str, int]],
) -> str:
    return json.dumps(
        {
            "schema_version": SCHEMA_VERSION,
            "convention": {
                "public": "top-level name not starting with '_', unless __all__ is declared",
                "explicit_all_overrides_underscore": True,
                "reexports_counted": True,
                "module_scope_control_flow_descended": True,
            },
            "config": config,
            # `run` lets a consumer tell a complete export from a --top-truncated
            # one. `load_baseline` refuses a truncated file precisely because a
            # missing module reads as new surface.
            "run": totals,
            # Computed from the FULL module list by the caller, never from a
            # `--top` slice: a truncated slice would invent removals.
            "removed_modules": [{"name": name, "delta": delta} for name, delta in removed],
            "modules": [
                {
                    "name": module.name,
                    "files": len(module.files),
                    "public": module.public,
                    "reexports": module.reexports,
                    "declared": module.declared,
                    "front_doors": len(module.front_doors),
                    "interior": module.interior,
                    "parse_errors": module.parse_errors,
                    "delta": delta_for(module, baseline),
                    "notes": module.notes,
                    "names": sorted(
                        {f"{f.relative}:{name}" for f in module.files for name in f.names}
                    ),
                }
                for module in modules
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
        prog="api_surface.py",
        description=(
            "Count public exported names per module, and their growth against a "
            "baseline run. Diagnostic only -- always exits 0."
        ),
    )
    parser.add_argument("root", nargs="?", default=".", help="source root (default: .)")
    parser.add_argument(
        "--depth",
        type=int,
        default=0,
        help="collapse modules to the first N path segments (0 = containing directory)",
    )
    parser.add_argument(
        "--baseline",
        metavar="JSON",
        default=None,
        help=(
            f"an earlier --json run of schema_version {SCHEMA_VERSION}; adds a per-module "
            "delta and a net growth summary. A file of any other version, or one captured "
            "with --top, is refused rather than read as a partial baseline"
        ),
    )
    parser.add_argument(
        "--include-tests",
        action="store_true",
        help="count test files (off by default: test helpers are not product surface)",
    )
    parser.add_argument("--json", action="store_true", help="emit JSON instead of a table")
    parser.add_argument(
        "--top",
        type=non_negative,
        default=None,
        help="show only the first N rows (0 shows none)",
    )
    parser.add_argument(
        "--exclude",
        action="append",
        default=[],
        metavar="DIR",
        help="additional directory name to skip (repeatable)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    root = Path(args.root)
    if not root.is_dir():
        raise SystemExit(f"not a directory: {root}")

    baseline = None
    if args.baseline:
        baseline = load_baseline(Path(args.baseline))
        if baseline is None:
            # `load_baseline` collapses every malformed shape to None on
            # purpose, so the cause is enumerated here rather than threaded
            # back as a reason code. Without this the refusal was silent about
            # WHY, and the version pin in particular looked like a broken file.
            raise SystemExit(
                f"could not read a baseline from: {args.baseline}\n"
                f"it must be a --json run of schema_version {SCHEMA_VERSION}, whole "
                "(not captured with --top), with one row per module. A run from an "
                "older version predates the version field and is refused rather than "
                "guessed at -- regenerate the baseline with this version."
            )

    modules = analyse(
        root=root,
        depth=args.depth,
        include_tests=args.include_tests,
        extra_excludes=frozenset(args.exclude),
    )
    shown = modules if args.top is None else modules[: args.top]

    if args.json:
        print(
            to_json(
                shown,
                baseline,
                {
                    "root": str(root),
                    "depth": args.depth,
                    "include_tests": args.include_tests,
                    "exclude": sorted(args.exclude),
                    "baseline": args.baseline,
                },
                {
                    "modules": len(modules),
                    "modules_shown": len(shown),
                    "truncated": len(shown) < len(modules),
                    "public_total": sum(module.public for module in modules),
                    "parse_errors": sum(module.parse_errors for module in modules),
                    "net_change": net_change(modules, baseline) if baseline else None,
                },
                removed_modules(modules, baseline),
            )
        )
        return 0

    print(render_table(shown, baseline, None))
    print()
    # The summary describes the whole run, not the truncated table.
    print(render_summary(modules, baseline))
    return 0


if __name__ == "__main__":
    sys.exit(main())
