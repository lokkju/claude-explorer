"""Static import-closure analyzer for the MCPB bundle.

Given an entry module (typically ``mcp_server.server``) and the set of
project-internal package names, walks ``ast.Import`` / ``ast.ImportFrom``
recursively and returns:

* ``internal_modules`` — every project-internal module reached, with
  fully-dotted names (e.g. ``backend.parsing``).
* ``external_packages`` — every external top-level package reached
  (e.g. ``fastmcp``, ``pydantic``, ``orjson``).

Used by:

* ``mcp_server/tests/test_mcpb_closure.py`` (commit 2 canary) to fail the
  build if FastAPI / weasyprint / mitmproxy ever sneak into the MCP path.
* ``scripts/build-mcpb.py`` (commit 3) to drive the selective
  ``backend/`` copy into the bundle.

Design choices:

* AST-only — does NOT import modules, does NOT execute code. Safe to run
  on any code path including ones whose runtime imports would fail.
* Ignores ``from __future__ imports`` and relative imports below
  ``ast.ImportFrom.level == 0`` are still resolved against the source
  module's package.
* Ignores stdlib by checking ``sys.stdlib_module_names`` (Python 3.10+).
* Misses dynamic imports (``importlib.import_module(name)``). For this
  project the MCP server has zero dynamic imports on its hot path; if
  that changes, the analyzer will under-report and the bundle will
  silently drop modules. Add a TODO comment at the call site and
  cross-check.
"""

from __future__ import annotations

import ast
import pathlib
import sys


def _module_path(module: str, project_root: pathlib.Path) -> pathlib.Path | None:
    """Resolve a fully-dotted module name to a ``.py`` file under ``project_root``.

    Returns ``None`` if the module is not a Python file in the source
    tree (e.g. it's a stdlib module or a third-party package). Handles
    both ``foo/bar.py`` and ``foo/bar/__init__.py``.
    """

    parts = module.split(".")
    candidate_file = project_root.joinpath(*parts).with_suffix(".py")
    candidate_pkg = project_root.joinpath(*parts, "__init__.py")
    if candidate_file.exists():
        return candidate_file
    if candidate_pkg.exists():
        return candidate_pkg
    return None


def _resolve_relative(
    module: str | None,
    level: int,
    source_module: str,
) -> str | None:
    """Resolve a relative ``from ... import`` to an absolute dotted name.

    ``source_module`` is the dotted name of the file containing the
    import. ``level`` is ``node.level`` from ``ast.ImportFrom``.
    """

    if level == 0:
        return module
    pkg_parts = source_module.split(".")
    # `level` counts dots in `from ..foo import bar`: level=2 means "two
    # packages up". For a module `a.b.c`, level=1 strips `c` (stays in
    # `a.b`), level=2 strips `b.c`, etc.
    if level > len(pkg_parts):
        return None
    base = pkg_parts[: len(pkg_parts) - level]
    if module:
        base.append(module)
    return ".".join(base) if base else None


def _module_name_from_path(path: pathlib.Path, project_root: pathlib.Path) -> str:
    """Convert ``project_root/backend/foo.py`` to ``backend.foo``."""

    rel = path.relative_to(project_root).with_suffix("")
    parts = list(rel.parts)
    if parts and parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts)


def _iter_import_eager(nodes: list[ast.stmt]):
    """Yield ``Import`` / ``ImportFrom`` nodes that execute at module-load time.

    This is the critical correctness call for the canary: an import
    inside a function body does NOT pull the dep at module-load time, so
    a lazy ``from weasyprint import HTML`` inside ``create_pdf`` must
    NOT count as a hard dep of the MCP bundle. We therefore descend into
    compound statements (``If``, ``Try``, ``With``, ``For``, ``While``)
    and into ``ClassDef`` bodies (class bodies execute at module load),
    but we do NOT descend into function / async-function bodies.

    See ``backend/exporters/pdf.py:587`` for the canonical lazy-import
    pattern this is designed to honor.
    """

    for node in nodes:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            yield node
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            # Skip function bodies — imports there are deferred to call time.
            continue
        elif isinstance(node, ast.ClassDef):
            yield from _iter_import_eager(node.body)
        elif isinstance(node, ast.If):
            yield from _iter_import_eager(node.body)
            yield from _iter_import_eager(node.orelse)
        elif isinstance(node, ast.Try):
            yield from _iter_import_eager(node.body)
            for handler in node.handlers:
                yield from _iter_import_eager(handler.body)
            yield from _iter_import_eager(node.orelse)
            yield from _iter_import_eager(node.finalbody)
        elif isinstance(node, (ast.With, ast.AsyncWith)):
            yield from _iter_import_eager(node.body)
        elif isinstance(node, (ast.For, ast.AsyncFor)):
            yield from _iter_import_eager(node.body)
            yield from _iter_import_eager(node.orelse)
        elif isinstance(node, ast.While):
            yield from _iter_import_eager(node.body)
        # Other statement types (Assign, Expr, Return, etc.) cannot
        # contain top-level imports — they're expressions or single
        # statements without nested suites.


def compute_closure(
    entry_module: str,
    project_root: pathlib.Path,
    project_packages: set[str],
) -> tuple[set[str], set[str]]:
    """Walk imports from ``entry_module`` and return
    ``(internal_modules, external_packages)``.

    ``project_packages`` is the set of top-level project package names
    (e.g. ``{"mcp_server", "backend"}``). Anything imported whose root
    is in this set is followed recursively; anything else is recorded as
    an external package (top-level name only) and not followed.

    Only counts imports that execute at module-load time — lazy imports
    inside function bodies are deliberately ignored, because they are
    the supported escape hatch for keeping heavyweight deps (weasyprint,
    fastapi) out of the MCP closure. See ``_iter_import_eager``.
    """

    internal: set[str] = set()
    external: set[str] = set()
    stdlib = sys.stdlib_module_names

    queue: list[str] = [entry_module]
    seen: set[str] = set()

    while queue:
        module = queue.pop()
        if module in seen:
            continue
        seen.add(module)

        path = _module_path(module, project_root)
        if path is None:
            # Not a project file — record as external if it's not stdlib.
            root = module.split(".")[0]
            if root not in stdlib and root not in project_packages:
                external.add(root)
            continue

        internal.add(module)

        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except (OSError, SyntaxError):
            continue

        for node in _iter_import_eager(tree.body):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    target = alias.name
                    if target.split(".")[0] in project_packages:
                        queue.append(target)
                    elif target.split(".")[0] not in stdlib:
                        external.add(target.split(".")[0])
            elif isinstance(node, ast.ImportFrom):
                target = _resolve_relative(node.module, node.level, module)
                if target is None:
                    continue
                root = target.split(".")[0]
                if root in project_packages:
                    queue.append(target)
                    # Also queue the symbols imported — they may be
                    # submodules of `target` rather than attributes.
                    for alias in node.names:
                        if alias.name == "*":
                            continue
                        queue.append(f"{target}.{alias.name}")
                elif root not in stdlib:
                    external.add(root)

    return internal, external


def _cli() -> int:
    """Tiny CLI for poking at the analyzer manually."""

    import argparse
    import json

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--entry", default="mcp_server.server")
    parser.add_argument(
        "--packages",
        default="mcp_server,backend,cli,fetcher",
        help="Comma-separated project package roots",
    )
    parser.add_argument(
        "--root",
        default=str(pathlib.Path(__file__).resolve().parents[1]),
    )
    args = parser.parse_args()

    internal, external = compute_closure(
        entry_module=args.entry,
        project_root=pathlib.Path(args.root),
        project_packages=set(args.packages.split(",")),
    )
    print(
        json.dumps(
            {
                "entry": args.entry,
                "internal_count": len(internal),
                "external_count": len(external),
                "external": sorted(external),
                "internal": sorted(internal),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(_cli())
