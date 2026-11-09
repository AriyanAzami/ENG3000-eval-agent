#!/usr/bin/env bash
# Runs all acceptance tests at once against the deployed agent (6 concurrent requests,
# far below the providers' per-minute limits), then grades the pass.
OUT=$1; mkdir -p "$OUT"
for t in T1 T2 T3d T3bc T3a T3e; do
  node tests/run-test.mjs "$t" "tests/inputs/$t.json" "$OUT" > "$OUT/$t.log" 2>&1 &
  sleep 3
done
wait
cat "$OUT"/*.log
echo "=== GRADE $OUT"; node tests/grade.mjs "$OUT"
