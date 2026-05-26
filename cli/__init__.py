"""Top-level ``cli`` package — ``claude-explorer`` entry point.

Promoted from ``fetcher/cli.py`` on 2026-05-21 per council A1-CLI-LAYER
(see ``PLANS/CODE-REVIEW-FETCHER.md``). The architectural goal: a
mathematically sound DAG where the CLI is a sibling of (not a child
of) ``fetcher`` and ``backend``, since it orchestrates both. Before
this move, ``fetcher/cli.py`` lived inside ``fetcher/`` but imported
``backend.*`` at runtime, making the layered diagram lie.

Modules:

* ``cli.main`` — the Click command group plus its subcommands
  (``capture``, ``fetch``, ``serve``, ``migrate``, ``mcp``,
  ``reindex-search``, ``rehydrate``, ``warm-cc-cache``,
  ``install-watcher``).
* ``cli.watcher`` — cross-platform install/uninstall helpers for the
  CC image-cache watcher (launchd/systemd/Task-Scheduler unit
  generators, ``_xml_escape``, per-platform installers).

The console-script entry in ``pyproject.toml`` points at
``cli.main:main``. The wheel build target must include ``"cli"`` in
``tool.hatch.build.targets.wheel.packages`` — verified by a build-time
check in CI/release. Forgetting it produces a wheel where
``claude-explorer`` fails with ``ModuleNotFoundError: No module named
'cli'`` at install time.
"""
