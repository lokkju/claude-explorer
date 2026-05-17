# Claude Explorer — developer-convenience Makefile.
#
# Targets here are for developer-loop tasks. They are NOT a CI gate;
# `make bench` in particular is intentionally NOT enforced in CI
# (PLANS/PERFORMANCE_PHASE_2.md §Workstream D: hard gating would
# require per-machine baseline storage and is out of scope for V1).
# The PR-template checklist mentions running it before perf-touching
# merges.

.PHONY: bench bench-quick bench-json cold-search-instructions

# Default target — show usage so `make` alone is informative.
.DEFAULT_GOAL := help

help:
	@echo "Claude Explorer developer Makefile"
	@echo ""
	@echo "Targets:"
	@echo "  make bench                 Run the warm benchmark suite against http://localhost:8765"
	@echo "  make bench-quick           Same, with fewer runs per measurement (fast iteration)"
	@echo "  make bench-json            Emit JSON for paste into PR bodies"
	@echo "  make cold-search-instructions  Print steps for cold-search measurement"
	@echo ""
	@echo "Backend dev server must be running on :8765 (or pass BASE=http://host:port)."

# Default base URL; override with: make bench BASE=http://localhost:8766
BASE ?= http://localhost:8765

bench:
	uv run python benchmarks/run_all.py --base $(BASE)

bench-quick:
	uv run python benchmarks/run_all.py --base $(BASE) --quick

bench-json:
	uv run python benchmarks/run_all.py --base $(BASE) --json

cold-search-instructions:
	uv run python benchmarks/run_all.py --cold-search
