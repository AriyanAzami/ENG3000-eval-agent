#!/usr/bin/env bash
# Runs the full acceptance suite against the deployed agent in two sequential streams
# (at most 2 requests in flight; far below the providers' per-minute limits).
OUT=$1
bash tests/run-suite.sh "$OUT" T1 T3a T3e T3bc > "$OUT.A.log" 2>&1 &
PID=$!
sleep 15
bash tests/run-suite.sh "$OUT" T2 T3d > "$OUT.B.log" 2>&1
wait $PID
cat "$OUT.A.log" "$OUT.B.log"
