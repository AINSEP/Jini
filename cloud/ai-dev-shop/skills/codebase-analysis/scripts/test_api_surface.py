#!/usr/bin/env python3
"""Executable proof for every counting rule in api_surface.py.

A metric script that has never been run against a known answer is a number
generator, not a measurement. Each test below fixes one rule from the API
surface section of ../references/cohesion-and-api-surface.md.

The negative controls are load-bearing. The cheap way to inflate this metric is
to count things that bind no new name: a subscript target, an annotation with no
value, a private helper, a dunder.

Run:  python3 -m pytest skills/codebase-analysis/scripts/ -q
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from api_surface import (  # noqa: E402
    SCHEMA_VERSION,
    analyse,
    delta_for,
    load_baseline,
    main,
    net_change,
    parse_surface,
    removed_modules,
)

SCRIPT = Path(__file__).parent / "api_surface.py"


# ------------------------------------------------------------------- oracle


def runtime_public_names(source: str, tmp_path: Path, name: str) -> set[str]:
    """What Python ACTUALLY binds, obtained by importing the module.

    This is the independent authority the first version of this file lacked.
    Asserting the parser against hand-written expectations only re-encodes the
    parser author's assumptions; every defect found in the audit of this script
    was a case where those assumptions were wrong and no test could see it.
    """
    module_path = tmp_path / f"{name}.py"
    module_path.write_text(source, encoding="utf-8")
    spec = importlib.util.spec_from_file_location(name, module_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
        declared = getattr(module, "__all__", None)
        if declared is not None:
            return set(declared)
        return {n for n in vars(module) if not n.startswith("_")}
    finally:
        sys.modules.pop(name, None)


# Every fixture obeys two rules, because breaking either is how the FIRST
# version of this oracle passed while the parser was wrong:
#
# 1. **Unique sentinel per branch.** A name must be bound by exactly one code
#    path, so deleting that path's traversal changes the answer. The original
#    `try/except` case bound `impl` in BOTH branches, so removing either
#    traversal still passed. Same for `.extend`/`.append`, whose dynamic
#    fallback coincidentally produced the same set the correct code produces.
# 2. **The branch must execute.** The oracle is the interpreter, so a name in a
#    branch that never runs is not bound at runtime and cannot be compared. The
#    static-only behaviour is asserted separately, below.
ORACLE_CASES = {
    "plain": "def RUN(): pass\nclass THING: pass\nVALUE = 1\n",
    "private": "def _hidden(): pass\n_CACHE = {}\nPUBLIC = 1\n",
    # --- module-scope control flow, one executing branch each -----------------
    "if_body": "if True:\n    def IF_DEF(): pass\n    IF_VALUE = 1\n",
    "if_orelse": "if False:\n    pass\nelse:\n    ELSE_ONLY = 1\n",
    # The handler binds nothing: a name in a branch that does not run is real
    # static surface but not a runtime attribute, so it belongs in the
    # static-traversal test below, not here.
    "try_body": "try:\n    TRY_ONLY = 1\nexcept ValueError:\n    pass\n",
    "try_handler": (
        "try:\n    raise ValueError()\nexcept ValueError:\n    HANDLER_ONLY = 1\n"
    ),
    "try_orelse": "try:\n    pass\nexcept ValueError:\n    pass\nelse:\n    ORELSE_ONLY = 1\n",
    "try_finally": "try:\n    pass\nfinally:\n    FINALLY_ONLY = 1\n",
    "with_body": "import contextlib\nwith contextlib.suppress(Exception):\n    WITH_ONLY = 1\n",
    "with_as": "import contextlib\nwith contextlib.suppress(Exception) as WITH_AS_ONLY:\n    pass\n",
    "for_body": "for _ in [1]:\n    FOR_BODY_ONLY = 1\n",
    "for_target": "for FOR_TARGET_ONLY in [1]:\n    pass\n",
    "for_tuple_target": "for FOR_LEFT, FOR_RIGHT in [(1, 2)]:\n    pass\n",
    "while_body": "_n = [1]\nwhile _n:\n    WHILE_BODY_ONLY = _n.pop()\n",
    "match_capture": (
        "SUBJECT = {'k': 1}\nmatch SUBJECT:\n    case {'k': MATCH_CAPTURE_ONLY}:\n        pass\n"
    ),
    "match_as": "SUBJECT = 1\nmatch SUBJECT:\n    case int() as MATCH_AS_ONLY:\n        pass\n",
    "match_star": (
        "SUBJECT = [1, 2]\nmatch SUBJECT:\n    case [_, *MATCH_STAR_ONLY]:\n        pass\n"
    ),
    "match_body": "SUBJECT = 1\nmatch SUBJECT:\n    case 1:\n        MATCH_BODY_ONLY = 1\n",
    # A `case` guard and an `except` type are the two expressions that evaluate
    # in the ENCLOSING scope while hanging off a container the scope pruning
    # skips wholesale. Both were dropped.
    "match_guard_walrus": (
        "GUARD_SUBJECT = 1\nmatch GUARD_SUBJECT:\n"
        "    case 1 if (GUARD_WALRUS_ONLY := True):\n        pass\n"
    ),
    "except_type_walrus": (
        "try:\n    raise ValueError()\n"
        "except (EXC_TYPE_WALRUS_ONLY := ValueError):\n    pass\n"
    ),
    # Negative control for the two above: the same guard inside a callable is a
    # nested scope and must stay pruned. A visitor that simply descended into
    # every `match_case` would leak it.
    "nested_match_guard_scope": (
        "def MATCH_GUARD_HOLDER():\n    match 1:\n"
        "        case 1 if (NESTED_GUARD_LEAK := True):\n            pass\n"
    ),
    # --- scope boundaries: the name must NOT escape ---------------------------
    "nested_function_scope": "def OUTER():\n    NESTED_LEAK = 1\n    return NESTED_LEAK\n",
    "class_body_scope": "class HOLDER:\n    CLASS_LEAK = 1\n",
    "except_target_cleared": (
        "try:\n    raise ValueError()\nexcept ValueError as EXC_LEAK:\n    EXC_LEAK = 1\n"
    ),
    # The handler's implicit `del` removes the HANDLER's binding, not one that
    # already existed. Cleanup used to pop the name unconditionally, deleting a
    # binding made before the `try` from a scan that is a union over branches.
    "except_target_keeps_a_prior_binding": (
        "EXC_PRIOR_KEPT = 'before'\ntry:\n    EXC_TRY_SIBLING = 1\n"
        "except ValueError as EXC_PRIOR_KEPT:\n    pass\n"
    ),
    "except_star_target_keeps_a_prior_binding": (
        "EXC_STAR_PRIOR_KEPT = 'before'\ntry:\n    EXC_STAR_SIBLING = 1\n"
        "except* ValueError as EXC_STAR_PRIOR_KEPT:\n    pass\n"
    ),
    "lambda_walrus_scope": "LAMBDA_HOLDER = lambda: (LAMBDA_LEAK := 1)\n",
    "comprehension_walrus_escapes": "COMP = [(COMP_WALRUS := i) for i in range(2)]\n",
    "lambda_default_walrus": "LAMBDA_DEF = lambda x=(DEFAULT_WALRUS := 1): x\n",
    "attribute_target": (
        "import types\nNS = types.SimpleNamespace()\nNS.ATTR_LEAK = 1\n"
    ),
    "subscript_target": "REGISTRY = {}\nSUB_KEY = 'k'\nREGISTRY[SUB_KEY] = 1\n",
    # --- __all__ state machine; each defines a name the fallback would leak ---
    "all_reassigned": (
        "__all__ = ['ALL_OLD']\n__all__ = ['ALL_NEW']\n"
        "ALL_OLD = 1\nALL_NEW = 2\nALL_FALLBACK_LEAK = 3\n"
    ),
    "all_augmented": (
        "__all__ = ['AUG_A']\n__all__ += ['AUG_B']\n"
        "AUG_A = 1\nAUG_B = 2\nAUG_FALLBACK_LEAK = 3\n"
    ),
    "all_extended": (
        "__all__ = ['EXT_A']\n__all__.extend(['EXT_B'])\n"
        "EXT_A = 1\nEXT_B = 2\nEXT_FALLBACK_LEAK = 3\n"
    ),
    "all_appended": (
        "__all__ = ['APP_A']\n__all__.append('APP_B')\n"
        "APP_A = 1\nAPP_B = 2\nAPP_FALLBACK_LEAK = 3\n"
    ),
    "all_underscore": "__all__ = ['_UNDERSCORE_EXPORT']\ndef _UNDERSCORE_EXPORT(): pass\n",
    "all_deleted_restores_convention": (
        "__all__ = ['DEL_ONLY']\ndel __all__\nDEL_ONLY = 1\nDEL_RESTORED = 2\n"
    ),
    # An `__all__` subscript edit chained with an ordinary target. Recognising
    # the mutation used to skip the rest of the statement, losing the alias.
    # `del __all__` afterwards puts the module back under the convention, so the
    # interpreter can witness the alias.
    "all_subscript_chained_target": (
        "__all__ = ['SUBCHAIN_X']\n__all__[0] = SUBCHAIN_ALIAS = 'v'\ndel __all__\n"
    ),
    "all_subscript_walrus_value": (
        "__all__ = ['SUBWAL_X']\n__all__[0] = (SUBWAL_ALIAS := 'v')\ndel __all__\n"
    ),
    # --- ordinary binding forms ----------------------------------------------
    "tuple_unpack": "TUP_LEFT, TUP_RIGHT = 1, 2\n",
    "starred_unpack": "STAR_HEAD, *STAR_TAIL = [1, 2, 3]\n",
    "walrus_in_if": "if (WALRUS_TARGET := 1):\n    WALRUS_USED = 1\n",
    "bare_annotation": "ANNOT_ONLY: int\nANNOT_REAL = 1\n",
    "deleted": "DEL_KEPT = 1\nDEL_GONE = 2\ndel DEL_GONE\n",
    "dotted_import": "import os.path\n",
    "type_alias": "type TYPE_ALIAS_ONLY = int\n",
}

# Mutations made while `__all__` is already unreadable. The contract here is a
# SUPERSET, not equality: a subscript assignment names its replacement without
# retracting what it displaced, and a `.remove()` this walker cannot evaluate is
# deliberately not honoured. Equality would therefore be the wrong assertion, so
# each case also names the entry that only the in-epoch tracking can supply --
# without it a parser that reports the seed alone would satisfy "superset" and
# prove nothing. Every sentinel is underscore-prefixed on purpose: the
# underscore-convention fallback cannot return it, so `frozen` is the only path
# that can, and a regression cannot be masked by provenance.
ORACLE_SUPERSET_CASES = {
    "inepoch_augmented": (
        "__all__ = ['_INEPOCH_AUG_SEED']\n__all__[0] = __all__[0]\n"
        "__all__ += ['_INEPOCH_AUG_ADDED']\n",
        "_INEPOCH_AUG_ADDED",
    ),
    "inepoch_extended": (
        "__all__ = ['_INEPOCH_EXT_SEED']\n__all__[0] = __all__[0]\n"
        "__all__.extend(['_INEPOCH_EXT_ADDED'])\n",
        "_INEPOCH_EXT_ADDED",
    ),
    "inepoch_appended_after_delete": (
        "__all__ = ['_INEPOCH_APP_SEED']\ndel __all__[0]\n"
        "__all__.append('_INEPOCH_APP_ADDED')\n",
        "_INEPOCH_APP_ADDED",
    ),
    "inepoch_subscript_replacement": (
        "__all__ = ['_INEPOCH_SUB_SEED']\n__all__[0] = '_INEPOCH_SUB_ADDED'\n",
        "_INEPOCH_SUB_ADDED",
    ),
    "inepoch_slice_replacement": (
        "__all__ = ['_INEPOCH_SLICE_SEED']\n__all__[:] = ['_INEPOCH_SLICE_ADDED']\n",
        "_INEPOCH_SLICE_ADDED",
    ),
    # A slice splices an ITERABLE, and iterating a string yields its characters:
    # this statement exports 'Q', 'R' and 'S', not '_QRS'. Reading the slice
    # form as though it were the index form reported a name the module does not
    # have while missing all three it does.
    "inepoch_slice_of_a_string": (
        "__all__ = ['_INEPOCH_STRSLICE_SEED']\n__all__[:] = 'QRS'\n",
        "Q",
    ),
    # An annotation does not stop it being an ordinary in-place write, but
    # `AnnAssign` carries `target`, not `targets`, so the whole statement used
    # to miss both subscript tests and be skipped outright.
    "inepoch_annotated_subscript": (
        "__all__ = ['_INEPOCH_ANNOT_SEED']\n__all__[0]: str = '_INEPOCH_ANNOT_ADDED'\n",
        "_INEPOCH_ANNOT_ADDED",
    ),
    # The subscript hides inside a destructuring target, so it has to be matched
    # to its value positionally rather than by looking at the target alone.
    "inepoch_destructured_subscript": (
        "__all__ = ['_INEPOCH_DESTRUCT_SEED']\n"
        "__all__[0], _INEPOCH_DESTRUCT_AUX = ('_INEPOCH_DESTRUCT_ADDED', 1)\n",
        "_INEPOCH_DESTRUCT_ADDED",
    ),
    # A starred target absorbs several values and is bound to a LIST of them,
    # so it behaves as a slice assignment. Walking the target index-for-index
    # never reached the subscript inside the `Starred` wrapper at all.
    "inepoch_starred_subscript": (
        "__all__ = ['_INEPOCH_STAR_SEED']\n"
        "*__all__[:], _INEPOCH_STAR_AUX = ('_INEPOCH_STAR_ADDED', '_INEPOCH_STAR_TOO', 1)\n",
        "_INEPOCH_STAR_ADDED",
    ),
    # The star also shifts every position AFTER it, and it absorbs enough that
    # the target and value lengths differ -- which used to abandon positional
    # matching entirely and lose the name.
    "inepoch_subscript_after_a_star": (
        "__all__ = ['_INEPOCH_POSTSTAR_SEED']\n"
        "_INEPOCH_POSTSTAR_HEAD, *_INEPOCH_POSTSTAR_REST, __all__[0] = "
        "(1, 2, 3, '_INEPOCH_POSTSTAR_ADDED')\n",
        "_INEPOCH_POSTSTAR_ADDED",
    ),
}

# Provenance and flags have no runtime oracle, so they are declared. Only cases
# where the value is load-bearing appear here.
REEXPORT_EXPECTATIONS = {
    "plain": set(),
    "dotted_import": {"os"},
    "attribute_target": {"types"},
    "all_extended": set(),
}

FLAG_EXPECTATIONS = {
    "plain": {"declared_all": False, "dynamic_all": False, "wildcard_import": False},
    "all_reassigned": {"declared_all": True, "dynamic_all": False},
    "all_extended": {"declared_all": True, "dynamic_all": False},
    "all_deleted_restores_convention": {"declared_all": False, "dynamic_all": False},
}


@pytest.mark.parametrize("case", sorted(ORACLE_CASES))
def test_parser_agrees_with_the_python_interpreter(case: str, tmp_path: Path) -> None:
    source = ORACLE_CASES[case]
    expected = runtime_public_names(source, tmp_path, f"oracle_{case}")
    assert parse_surface(source, "m.py").names == expected


@pytest.mark.parametrize("case", sorted(ORACLE_SUPERSET_CASES))
def test_in_epoch_mutations_keep_the_surface_a_superset(case: str, tmp_path: Path) -> None:
    # REGRESSION. `AllState.extend` began `if not self.dynamic`, so once the list
    # was unreadable every later literal append/extend/`+=` was discarded, and a
    # subscript assignment recorded the mutation while throwing away the name it
    # had just written. Both under-reported in the one direction this fallback
    # promises never to fail in.
    source, added = ORACLE_SUPERSET_CASES[case]
    surface = parse_surface(source, "m.py")
    runtime = runtime_public_names(source, tmp_path, f"superset_{case}")
    assert runtime <= surface.names, f"{sorted(runtime - surface.names)} missing"
    assert added in surface.names
    assert surface.dynamic_all is True


@pytest.mark.parametrize("case", sorted(REEXPORT_EXPECTATIONS))
def test_reexport_provenance(case: str) -> None:
    # `names` alone cannot see provenance: a re-export and a local definition
    # produce the same name. Without this, dropping final-binding tracking broke
    # nothing any test could observe.
    assert parse_surface(ORACLE_CASES[case], "m.py").reexports == REEXPORT_EXPECTATIONS[case]


@pytest.mark.parametrize("case", sorted(FLAG_EXPECTATIONS))
def test_surface_flags(case: str) -> None:
    surface = parse_surface(ORACLE_CASES[case], "m.py")
    for flag, expected in FLAG_EXPECTATIONS[case].items():
        assert getattr(surface, flag) is expected, flag


def test_final_binding_provenance_is_local_not_reexport() -> None:
    surface = parse_surface("from json import dumps as SHADOWED\nclass SHADOWED: pass\n", "m.py")
    assert surface.names == {"SHADOWED"}
    assert surface.reexports == set()


def test_static_traversal_covers_branches_that_do_not_execute() -> None:
    # The interpreter oracle can only witness executed branches, so this is the
    # one rule it structurally cannot check: the scan is static, and a name bound
    # in a branch that never runs still counts as surface.
    source = "if False:\n    UNEXECUTED = 1\nelse:\n    TAKEN = 2\n"
    assert parse_surface(source, "m.py").names == {"UNEXECUTED", "TAKEN"}


def build_tree(root: Path, files: dict[str, str]) -> None:
    for relative, content in files.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")


def names(source: str) -> set[str]:
    return parse_surface(source, "m.py").names


def modules_by_name(root: Path, **kwargs):
    result = analyse(
        root=root,
        depth=kwargs.get("depth", 0),
        include_tests=kwargs.get("include_tests", False),
        extra_excludes=frozenset(kwargs.get("extra_excludes", ())),
    )
    return {module.name: module for module in result}


def versioned(modules: object) -> dict:
    """A hand-built baseline document carrying the current schema version.

    `load_baseline` requires the version, so a fixture omitting it is rejected
    before reaching the row rule it means to exercise.
    """
    return {"schema_version": SCHEMA_VERSION, "modules": modules}


# ------------------------------------------------------------ what is public


def test_functions_and_classes_are_public() -> None:
    assert names("def run(): pass\nclass Thing: pass\n") == {"run", "Thing"}


def test_module_constants_are_public() -> None:
    assert names("VERSION = '1'\nDEBUG: bool = False\n") == {"VERSION", "DEBUG"}


def test_tuple_unpacking_binds_every_name() -> None:
    assert names("LEFT, RIGHT = 1, 2\n") == {"LEFT", "RIGHT"}


def test_starred_unpacking_binds_the_target() -> None:
    assert names("HEAD, *TAIL = [1, 2, 3]\n") == {"HEAD", "TAIL"}


def test_reexports_count_and_are_labelled() -> None:
    surface = parse_surface("from .core import Thing\nimport os\n", "m.py")
    assert surface.names == {"Thing", "os"}
    assert surface.reexports == {"Thing", "os"}


def test_dotted_import_binds_only_the_root() -> None:
    # `import a.b.c` makes `a` an attribute of this module, not `a.b.c`.
    assert names("import a.b.c\n") == {"a"}


def test_aliased_import_binds_the_alias() -> None:
    assert names("import numpy as np\nfrom x import y as z\n") == {"np", "z"}


# --------------------------------------------------------- negative controls


def test_underscore_names_are_private() -> None:
    assert names("def _helper(): pass\n_CACHE = {}\nclass _Impl: pass\n") == set()


def test_dunders_are_private() -> None:
    assert names("__version__ = '1'\n") == set()


def test_subscript_assignment_binds_nothing() -> None:
    # `REGISTRY[key] = value` used to count REGISTRY, key and value as three
    # fresh exports because every ast.Name in the target was collected.
    surface = parse_surface("REGISTRY = {}\nREGISTRY[key] = value\n", "m.py")
    assert surface.names == {"REGISTRY"}


def test_attribute_assignment_binds_nothing() -> None:
    assert names("import cfg\ncfg.setting = 1\n") == {"cfg"}


def test_bare_annotation_binds_nothing() -> None:
    assert names("counter: int\n") == set()


def test_nested_definitions_are_not_module_surface() -> None:
    # Only the top level is the module's namespace.
    assert names("def outer():\n    def inner(): pass\n    class Nested: pass\n") == {"outer"}


def test_class_methods_are_not_module_surface() -> None:
    assert names("class Thing:\n    def method(self): pass\n") == {"Thing"}


def test_conditional_import_inside_a_function_is_not_surface() -> None:
    assert names("def load():\n    import json\n    return json\n") == {"load"}


def test_syntax_error_yields_an_empty_surface() -> None:
    surface = parse_surface("def broken(:\n", "m.py")
    assert surface.names == set()


# ----------------------------------------------------------------- __all__


def test_explicit_all_is_the_surface() -> None:
    source = "__all__ = ['run']\ndef run(): pass\ndef also_public(): pass\n"
    assert names(source) == {"run"}


def test_explicit_all_overrides_the_underscore_convention() -> None:
    # A module exporting `_internal` in __all__ has decided it is public.
    assert names("__all__ = ['_internal']\ndef _internal(): pass\n") == {"_internal"}


def test_all_accepts_a_tuple() -> None:
    assert names("__all__ = ('a', 'b')\n") == {"a", "b"}


def test_augmented_all_is_accumulated() -> None:
    source = "__all__ = ['a']\n__all__ += ['b']\n"
    assert names(source) == {"a", "b"}


def test_computed_all_falls_back_and_is_flagged() -> None:
    # `__all__ = _build()` cannot be read statically. Guessing is worse than
    # admitting it, so the convention applies and the file is flagged.
    surface = parse_surface("__all__ = _build()\ndef run(): pass\n", "m.py")
    assert surface.dynamic_all is True
    assert surface.declared_all is False
    assert surface.names == {"run"}


def test_deleting_an_all_element_stops_serving_the_stale_literal(tmp_path: Path) -> None:
    # REGRESSION. `del __all__[0]` matched neither `deleted_names` (whose targets
    # must be plain Names) nor `all_mutation`, so the statement was skipped
    # outright and the untouched literal was served as though it were fact.
    source = "__all__ = ['SUBDEL_A', 'SUBDEL_B']\ndel __all__[0]\n"
    surface = parse_surface(source, "m.py")
    assert surface.dynamic_all is True
    assert surface.declared_all is False
    runtime = runtime_public_names(source, tmp_path, "subdel")
    assert runtime == {"SUBDEL_B"}
    # A strict superset: over-reporting is visible, the stale literal was not.
    assert runtime < surface.names


def test_an_underscored_all_entry_survives_the_computed_fallback(tmp_path: Path) -> None:
    # REGRESSION. Once the state went dynamic the surface was rebuilt from module
    # bindings filtered by underscore. `__all__` entries are string contents, not
    # bindings, so an underscored one could not return through provenance at all
    # and the fallback reported {} -- an under-report where it promises a
    # superset. `_FROZEN_HELPER` is the control: a private BINDING stays private.
    source = (
        "__all__ = ['_FROZEN_UNDER']\n__all__[0] = '_REPLACEMENT'\n_FROZEN_HELPER = 1\n"
    )
    surface = parse_surface(source, "m.py")
    assert surface.dynamic_all is True
    # Both the replaced name and its replacement: the subscript assignment
    # names what goes IN, and reporting only what it displaced was the whole
    # defect. The interpreter, not this expectation, decides which is live.
    assert surface.names == {"_FROZEN_UNDER", "_REPLACEMENT"}
    runtime = runtime_public_names(source, tmp_path, "frozenunder")
    assert runtime == {"_REPLACEMENT"}
    assert runtime < surface.names
    assert "_FROZEN_HELPER" not in surface.names


def test_a_frozen_all_entry_keeps_its_reexport_provenance() -> None:
    # A frozen entry is treated exactly as a declared one: if the name was bound
    # by an import it is a re-export, underscore or not. Without this, `reexports`
    # stopped being a subset of `names` in the dynamic branch.
    surface = parse_surface(
        "from json import dumps as _FROZEN_REEXPORT\n"
        "__all__ = ['_FROZEN_REEXPORT']\n"
        "__all__[0] = 'OTHER'\n",
        "m.py",
    )
    assert surface.names == {"_FROZEN_REEXPORT", "OTHER"}
    # `OTHER` is a string the subscript put in the list, bound to nothing, so it
    # is surface without being a re-export. The invariant under test is that
    # `reexports` stays a subset of `names` across the dynamic branch.
    assert surface.reexports == {"_FROZEN_REEXPORT"}
    assert surface.reexports < surface.names


def test_the_frozen_all_snapshot_is_not_a_running_union() -> None:
    # The snapshot is REPLACED on each transition into dynamic, never appended
    # to. Two transitions are needed to see the difference: a whole `__all__ =
    # [...]` between them discards the first list, and accumulating both was the
    # original defect -- reporting names the module had already thrown away.
    surface = parse_surface(
        "__all__ = ['UNION_DISCARDED']\n__all__[0] = 'UNION_DEAD_EDIT'\n"
        "__all__ = ['UNION_KEPT']\n__all__[0] = 'UNION_LIVE_EDIT'\n",
        "m.py",
    )
    assert surface.dynamic_all is True
    # The second epoch's list AND the edit made against it; nothing from the
    # first epoch, which `__all__ = ['UNION_KEPT']` threw away wholesale.
    assert surface.names == {"UNION_KEPT", "UNION_LIVE_EDIT"}
    assert "UNION_DISCARDED" not in surface.names
    assert "UNION_DEAD_EDIT" not in surface.names


def test_a_delete_beside_an_all_subscript_still_removes_its_own_names() -> None:
    # REGRESSION. Recognising the `__all__` mutation used to `continue` past the
    # rest of the statement, so the sibling target of `del __all__[0], NAME` was
    # never removed from the surface.
    surface = parse_surface(
        "__all__ = ['SIBDEL_X']\nSIBDEL_GONE = 1\nSIBDEL_KEPT = 2\n"
        "del __all__[0], SIBDEL_GONE\n",
        "m.py",
    )
    assert surface.dynamic_all is True
    assert "SIBDEL_GONE" not in surface.names
    assert "SIBDEL_KEPT" in surface.names


def test_concatenated_all_is_treated_as_computed() -> None:
    surface = parse_surface("__all__ = ['a'] + OTHER\ndef run(): pass\n", "m.py")
    assert surface.dynamic_all is True


def test_wildcard_import_is_flagged() -> None:
    surface = parse_surface("from x import *\n", "m.py")
    assert surface.wildcard_import is True


# ----------------------------------------------------------------- modules


def test_module_sums_its_files(tmp_path: Path) -> None:
    build_tree(
        tmp_path,
        {
            "pkg/a.py": "def one(): pass\ndef two(): pass\n",
            "pkg/b.py": "def three(): pass\n",
        },
    )
    assert modules_by_name(tmp_path)["pkg"].public == 3


def test_front_door_is_the_init_file(tmp_path: Path) -> None:
    build_tree(
        tmp_path,
        {
            "pkg/__init__.py": "__all__ = ['one']\nfrom pkg.a import one\n",
            "pkg/a.py": "def one(): pass\ndef two(): pass\n",
        },
    )
    module = modules_by_name(tmp_path)["pkg"]
    assert module.declared == 1
    assert module.interior == 2
    assert module.public == 3


def test_multi_file_module_without_init_is_flagged(tmp_path: Path) -> None:
    build_tree(tmp_path, {"pkg/a.py": "def one(): pass\n", "pkg/b.py": "def two(): pass\n"})
    module = modules_by_name(tmp_path)["pkg"]
    assert module.declared is None
    assert "no front door" in module.notes


def test_single_file_module_without_init_is_not_flagged(tmp_path: Path) -> None:
    build_tree(tmp_path, {"pkg/a.py": "def one(): pass\n"})
    assert "no front door" not in modules_by_name(tmp_path)["pkg"].notes


def test_depth_collapses_modules(tmp_path: Path) -> None:
    build_tree(
        tmp_path,
        {"src/core/a.py": "def one(): pass\n", "src/web/b.py": "def two(): pass\n"},
    )
    assert modules_by_name(tmp_path, depth=1)["src"].public == 2


def test_tests_are_excluded_by_default(tmp_path: Path) -> None:
    build_tree(
        tmp_path,
        {"pkg/a.py": "def one(): pass\n", "pkg/test_a.py": "def helper(): pass\n"},
    )
    assert modules_by_name(tmp_path)["pkg"].public == 1
    assert modules_by_name(tmp_path, include_tests=True)["pkg"].public == 2


def test_excluded_directories_are_skipped(tmp_path: Path) -> None:
    build_tree(
        tmp_path,
        {"pkg/a.py": "def one(): pass\n", "node_modules/z/b.py": "def vendor(): pass\n"},
    )
    assert set(modules_by_name(tmp_path)) == {"pkg"}


def test_all_reexports_module_is_flagged(tmp_path: Path) -> None:
    build_tree(tmp_path, {"pkg/__init__.py": "from pkg.a import one\n", "pkg/a.py": ""})
    assert "all re-exports" in modules_by_name(tmp_path)["pkg"].notes


# ----------------------------------------------------------------- baseline


def test_delta_reports_growth(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    build_tree(tmp_path, {"pkg/a.py": "def one(): pass\n"})
    assert main([str(tmp_path), "--json"]) == 0
    baseline_path = tmp_path / "baseline.json"
    baseline_path.write_text(capsys.readouterr().out, encoding="utf-8")

    build_tree(tmp_path, {"pkg/a.py": "def one(): pass\ndef two(): pass\ndef three(): pass\n"})
    assert main([str(tmp_path), "--json", "--baseline", str(baseline_path)]) == 0
    payload = json.loads(capsys.readouterr().out)
    module = next(m for m in payload["modules"] if m["name"] == "pkg")
    assert module["public"] == 3
    assert module["delta"] == 2


def test_a_module_absent_from_the_baseline_is_all_growth(tmp_path: Path) -> None:
    baseline_path = tmp_path / "baseline.json"
    baseline_path.write_text(
        json.dumps(versioned([{"name": "old", "public": 2}])), encoding="utf-8"
    )
    build_tree(tmp_path, {"pkg/a.py": "def one(): pass\ndef two(): pass\n"})
    baseline = load_baseline(baseline_path)
    module = modules_by_name(tmp_path)["pkg"]
    from api_surface import delta_for

    assert delta_for(module, baseline) == 2


def test_shrinking_surface_is_a_negative_delta(tmp_path: Path) -> None:
    baseline_path = tmp_path / "baseline.json"
    baseline_path.write_text(
        json.dumps(versioned([{"name": "pkg", "public": 5}])), encoding="utf-8"
    )
    build_tree(tmp_path, {"pkg/a.py": "def one(): pass\n"})
    from api_surface import delta_for

    assert delta_for(modules_by_name(tmp_path)["pkg"], load_baseline(baseline_path)) == -4


def test_a_removed_module_contributes_its_negative_surface(tmp_path: Path) -> None:
    # REGRESSION. Deltas iterated only CURRENT modules, so a deleted package
    # vanished: baseline kept=1/removed=5 against current kept=1 reported a net
    # change of +0 when the real change was -5. The reference doc simultaneously
    # claimed a moved module shows up as one disappearing and one appearing.
    baseline_path = tmp_path / "b.json"
    baseline_path.write_text(
        json.dumps(versioned([{"name": "kept", "public": 1}, {"name": "gone", "public": 5}])),
        encoding="utf-8",
    )
    build_tree(tmp_path, {"kept/a.py": "def one(): pass\n"})
    baseline = load_baseline(baseline_path)
    modules = list(modules_by_name(tmp_path).values())

    assert removed_modules(modules, baseline) == [("gone", -5)]
    assert net_change(modules, baseline) == -5


def test_a_renamed_module_appears_as_a_removal_and_an_addition(tmp_path: Path) -> None:
    baseline_path = tmp_path / "b.json"
    baseline_path.write_text(
        json.dumps(versioned([{"name": "old", "public": 3}])), encoding="utf-8"
    )
    build_tree(tmp_path, {"new/a.py": "def a(): pass\ndef b(): pass\ndef c(): pass\n"})
    baseline = load_baseline(baseline_path)
    modules = list(modules_by_name(tmp_path).values())

    assert removed_modules(modules, baseline) == [("old", -3)]
    assert delta_for(modules_by_name(tmp_path)["new"], baseline) == 3
    assert net_change(modules, baseline) == 0


def test_truncated_json_is_marked_and_refused_as_a_baseline(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    build_tree(
        tmp_path,
        {"a/x.py": "def one(): pass\ndef two(): pass\n", "b/y.py": "def three(): pass\n"},
    )
    assert main([str(tmp_path), "--json", "--top", "1"]) == 0
    payload = capsys.readouterr().out
    parsed = json.loads(payload)
    assert parsed["run"]["truncated"] is True
    assert parsed["run"]["modules"] == 2 and parsed["run"]["modules_shown"] == 1

    truncated = tmp_path / "t.json"
    truncated.write_text(payload, encoding="utf-8")
    assert load_baseline(truncated) is None

    assert main([str(tmp_path), "--json"]) == 0
    full = tmp_path / "f.json"
    full.write_text(capsys.readouterr().out, encoding="utf-8")
    assert load_baseline(full) is not None


def test_collapsed_depth_with_two_front_doors_reports_no_single_front_door(
    tmp_path: Path,
) -> None:
    # REGRESSION. `init` returned the FIRST __init__.py while `interior`
    # excluded all of them, so a collapsed component reported declared=1,
    # interior=0 against public=3 -- arithmetic that describes nothing.
    build_tree(
        tmp_path,
        {
            "src/core/__init__.py": "__all__ = ['a']\na = 1\n",
            "src/web/__init__.py": "__all__ = ['b', 'c']\nb = 1\nc = 2\n",
        },
    )
    module = modules_by_name(tmp_path, depth=1)["src"]
    assert len(module.front_doors) == 2
    assert module.declared is None
    assert "2 front doors" in module.notes


def test_a_single_front_door_still_reports_declared(tmp_path: Path) -> None:
    build_tree(
        tmp_path,
        {"pkg/__init__.py": "__all__ = ['a']\na = 1\n", "pkg/z.py": "def other(): pass\n"},
    )
    module = modules_by_name(tmp_path)["pkg"]
    assert module.declared == 1
    assert module.interior == 1


def test_an_unparseable_file_is_disclosed_not_silently_zero(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    # REGRESSION. A syntax error produced an empty surface indistinguishable
    # from a valid file with no public names -- "report absence, never a zero"
    # applied everywhere in this toolkit except here.
    build_tree(tmp_path, {"pkg/good.py": "def one(): pass\n", "pkg/bad.py": "def broken(:\n"})
    module = modules_by_name(tmp_path)["pkg"]
    assert module.parse_errors == 1
    assert "1 unparsed" in module.notes

    assert main([str(tmp_path)]) == 0
    assert "could not be parsed" in capsys.readouterr().out


def test_a_baseline_row_of_the_wrong_type_rejects_the_whole_file(tmp_path: Path) -> None:
    # REGRESSION. A malformed row was silently SKIPPED, so its module looked
    # absent from the baseline and its entire current surface read as growth:
    # `{"public": "5"}` against three current names reported +3 when the real
    # change was -2. A baseline that cannot be read completely is unusable.
    path = tmp_path / "b.json"
    for bad in (
        versioned([{"name": "pkg", "public": "5"}]),
        versioned([{"name": "pkg", "public": None}]),
        versioned([{"name": 7, "public": 5}]),
        versioned([{"name": "pkg", "public": True}]),
        versioned(["not a dict"]),
    ):
        path.write_text(json.dumps(bad), encoding="utf-8")
        assert load_baseline(path) is None, bad

    path.write_text(json.dumps(versioned([{"name": "pkg", "public": 5}])), encoding="utf-8")
    assert load_baseline(path) == {"pkg": 5}


def test_multi_front_door_module_is_not_also_called_doorless(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    # REGRESSION. The summary's no-front-door list was built from
    # `declared is None`, which is ALSO true for a module with several front
    # doors -- so the same module was described as having no __init__.py and two
    # of them, in adjacent lines.
    build_tree(
        tmp_path,
        {
            "src/core/__init__.py": "__all__ = ['a']\na = 1\n",
            "src/web/__init__.py": "__all__ = ['b']\nb = 1\n",
        },
    )
    assert main([str(tmp_path), "--depth", "1"]) == 0
    out = capsys.readouterr().out
    assert "front doors" in out
    assert "no __init__.py" not in out


def test_a_baseline_of_the_wrong_top_level_shape_is_rejected_not_crashed(
    tmp_path: Path,
) -> None:
    # REGRESSION. `payload.get("modules")` raised AttributeError on a bare JSON
    # list. Crashing breaks this function's "reject anything malformed, never
    # guess" contract harder than any shape it already refused.
    path = tmp_path / "b.json"
    for bad in ([], [{"name": "pkg", "public": 1}], "pkg", 7, None):
        path.write_text(json.dumps(bad), encoding="utf-8")
        assert load_baseline(path) is None, bad


def test_a_baseline_of_another_schema_version_is_rejected(tmp_path: Path) -> None:
    # REGRESSION. Nothing in the output carried a version, so a legacy or foreign
    # document that merely had a `modules` list was accepted as compatible. Every
    # module it does not contain then reads as brand-new surface, which fabricates
    # growth -- the same failure the truncated-baseline rule exists to prevent.
    path = tmp_path / "b.json"
    rows = [{"name": "pkg", "public": 5}]
    for bad in (
        {"modules": rows},  # written before the field existed
        {"modules": rows, "schema_version": SCHEMA_VERSION + 1},
        {"modules": rows, "schema_version": str(SCHEMA_VERSION)},
        {"modules": rows, "schema_version": True},  # True == 1 in Python
        {"modules": rows, "schema_version": None},
    ):
        path.write_text(json.dumps(bad), encoding="utf-8")
        assert load_baseline(path) is None, bad

    path.write_text(json.dumps(versioned(rows)), encoding="utf-8")
    assert load_baseline(path) == {"pkg": 5}


def test_a_duplicated_module_row_rejects_the_whole_baseline(tmp_path: Path) -> None:
    # REGRESSION. Two rows for one module resolved last-wins, silently discarding
    # the first. Against a current `pkg` of 3 the surviving row reported +2 where
    # the other would have given -2: a sign flip in the trend this feeds. Which
    # row was meant is exactly what this reader cannot know.
    path = tmp_path / "b.json"
    rows = [{"name": "DUPE_PKG", "public": 5}, {"name": "DUPE_PKG", "public": 1}]
    path.write_text(json.dumps(versioned(rows)), encoding="utf-8")
    assert load_baseline(path) is None

    # The control: the same two counts under DIFFERENT names are not a conflict.
    distinct = [{"name": "DUPE_PKG", "public": 5}, {"name": "DUPE_OTHER", "public": 1}]
    path.write_text(json.dumps(versioned(distinct)), encoding="utf-8")
    assert load_baseline(path) == {"DUPE_PKG": 5, "DUPE_OTHER": 1}


def test_an_unreadable_run_block_rejects_the_baseline(tmp_path: Path) -> None:
    # REGRESSION. The truncation guard only looked inside `run` when it was a
    # dict, so a `run` of any other type skipped the check entirely -- letting a
    # `--top` capture pass itself off as a whole baseline, which is the exact
    # growth-fabrication the truncated-baseline rule exists to stop.
    path = tmp_path / "b.json"
    rows = [{"name": "RUNBLOCK_PKG", "public": 5}]
    # `None` belongs in this list: an explicit `"run": null` is a PRESENT key
    # this reader cannot read, and testing `is not None` instead of presence
    # would wave it through into exactly the bypass described above.
    for bad in ("not-a-run-block", 7, [], True, None):
        payload = versioned(rows)
        payload["run"] = bad
        path.write_text(json.dumps(payload), encoding="utf-8")
        assert load_baseline(path) is None, bad

    # Absent is still fine: only a PRESENT but unreadable block is a defect.
    payload = versioned(rows)
    payload.pop("run", None)
    path.write_text(json.dumps(payload), encoding="utf-8")
    assert load_baseline(path) == {"RUNBLOCK_PKG": 5}


def test_unexpected_keys_on_a_baseline_row_stay_acceptable(tmp_path: Path) -> None:
    # The tool's own rows carry fields beyond `name`/`public`, so rejecting extra
    # keys would make its output unreadable by its own reader. This is the
    # boundary of the two rejection rules above, not an oversight.
    path = tmp_path / "b.json"
    rows = [{"name": "EXTRAKEY_PKG", "public": 5, "reexports": 2, "unknown_future": "x"}]
    path.write_text(json.dumps(versioned(rows)), encoding="utf-8")
    assert load_baseline(path) == {"EXTRAKEY_PKG": 5}


def test_the_json_output_declares_a_version_its_own_reader_accepts(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    # The version has to round-trip: every run's output is the next run's
    # baseline, so a writer and reader that disagree end the trend silently.
    build_tree(tmp_path, {"pkg/a.py": "def one(): pass\n"})
    assert main([str(tmp_path), "--json"]) == 0
    payload = capsys.readouterr().out
    assert json.loads(payload)["schema_version"] == SCHEMA_VERSION
    path = tmp_path / "b.json"
    path.write_text(payload, encoding="utf-8")
    assert load_baseline(path) == {"pkg": 1}


def test_malformed_baseline_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / "b.json"
    path.write_text("not json", encoding="utf-8")
    assert load_baseline(path) is None
    path.write_text(json.dumps(versioned("wrong")), encoding="utf-8")
    assert load_baseline(path) is None


def test_cli_rejects_an_unreadable_baseline(tmp_path: Path) -> None:
    build_tree(tmp_path, {"pkg/a.py": "def one(): pass\n"})
    with pytest.raises(SystemExit):
        main([str(tmp_path), "--baseline", str(tmp_path / "missing.json")])


# --------------------------------------------------------------------- cli


def test_cli_says_a_level_is_not_a_trend(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    build_tree(tmp_path, {"pkg/a.py": "def one(): pass\n"})
    assert main([str(tmp_path)]) == 0
    assert "not a trend" in capsys.readouterr().out


def test_cli_top_truncates_rows_but_the_summary_covers_the_run(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    build_tree(
        tmp_path,
        {"a/x.py": "def one(): pass\n", "b/y.py": "def two(): pass\n"},
    )
    assert main([str(tmp_path), "--top", "1"]) == 0
    assert "2 module(s), 2 public name(s)" in capsys.readouterr().out


def test_cli_rejects_a_non_directory(tmp_path: Path) -> None:
    with pytest.raises(SystemExit):
        main([str(tmp_path / "nope")])


def test_cli_always_exits_zero(tmp_path: Path) -> None:
    build_tree(tmp_path, {"pkg/a.py": "def one(): pass\n"})
    completed = subprocess.run(
        [sys.executable, str(SCRIPT), str(tmp_path)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert completed.returncode == 0
