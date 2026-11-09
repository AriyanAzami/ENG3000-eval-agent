#!/usr/bin/env bash
# Runs every acceptance test sequentially (never in parallel) against the deployed agent.
# Usage: bash tests/run-suite.sh <outDir> [tests...]
OUT=${1:-tests/runs/latest}; shift
TESTS=${@:-T3a T3bc T3e T1 T2 T3d}
for t in $TESTS; do
  node tests/run-test.mjs "$t" "tests/inputs/$t.json" "$OUT" || echo "$t FAILED TO RUN"
  sleep 10
done
