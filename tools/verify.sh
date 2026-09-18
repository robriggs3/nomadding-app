#!/usr/bin/env bash
# One command that says whether this repo is fit to open a PR from.
#
# Four stages, one PASS or FAIL line each, non-zero exit on any failure. It is
# meant to be boring and to be run without thinking about it, because every
# stage here exists for a regression that actually reached Rob:
#
#   tests     the unit suite. 593 of them.
#   build     assemble.js and embed.js run clean.
#   drift     the CHECKED-IN generated files match what the sources produce.
#             The repo ships built HTML, so a source edit without a rebuild is
#             a change that passes every test and reaches nobody.
#   headless  a real browser draws a real map. The unit suite cannot see
#             Leaflet, tiles or layout, and on 2026-09-18 the map drew nothing
#             for two days with zero console errors and a green test run.
#
# Usage, on the droplet:
#   ~/bin/build-lock.sh tools/verify.sh
#   VERIFY_SKIP_HEADLESS=1 ~/bin/build-lock.sh tools/verify.sh
#
# ALWAYS through build-lock.sh there. Several repos share that machine and each
# verify script launches a browser or a bundler; measured 2026-09-18, three at
# once took free memory to 480MB and chromium stopped launching. build-lock.sh
# takes a shared flock and waits up to 20 minutes, so the heavy stages queue
# instead of colliding. Verified: it propagates the command's exit code, and
# two three-second jobs take six seconds.
#
# This script does NOT take that lock itself, on purpose. Wrapping it AND
# self-locking would block on the same file for the full 20 minutes.
#
# In CI, where the runner is the only thing on the machine, run it directly:
#   tools/verify.sh
#
# NETWORK: three of the four stages need none. `headless` is the exception and
# it is deliberate: the page loads Leaflet from cdnjs and tiles from
# openstreetmap.org, which is the thing being checked. Nominatim is blocked in
# the test itself so no run ever spends anybody's geocoding rate limit. With no
# network, set VERIFY_SKIP_HEADLESS=1: the stage then prints a loud SKIP and
# the run still exits 0, so a skip is always visible and never silent.

set -u
cd "$(dirname "$0")/.."
ROOT=$(pwd)

failed=0
log_pass() { printf 'PASS  %-9s %s\n' "$1" "${2:-}"; }
log_fail() { printf 'FAIL  %-9s %s\n' "$1" "${2:-}"; failed=$((failed + 1)); }
log_skip() { printf 'SKIP  %-9s %s\n' "$1" "${2:-}"; }

OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

# Everything the build writes. Kept here rather than derived, so adding an
# output without adding it to this list is a visible omission in a diff.
GENERATED="index.html template.html trip/index.html share/index.html sw.js example.html"

# ---- 1. tests -------------------------------------------------------------
if node tests/run.js > "$OUT/tests.log" 2>&1; then
  log_pass tests "$(grep -a -o '[0-9]* passed, [0-9]* failed' "$OUT/tests.log" | tail -1)"
else
  log_fail tests "$(grep -a '^FAIL' "$OUT/tests.log" | head -3 | tr '\n' ';')"
fi

# ---- 2. build -------------------------------------------------------------
# The generated files are saved FIRST so the drift stage can compare against
# what is checked in rather than against git, which would report a false
# failure for anybody who has legitimately rebuilt before running this.
for f in $GENERATED; do
  [ -f "$f" ] && { mkdir -p "$OUT/before/$(dirname "$f")"; cp "$f" "$OUT/before/$f"; }
done

build_ok=1
node tools/assemble.js > "$OUT/build.log" 2>&1 || build_ok=0
node tools/embed.js cities/example.json example.html >> "$OUT/build.log" 2>&1 || build_ok=0
if [ "$build_ok" = "1" ]; then
  log_pass build "assemble + embed"
else
  log_fail build "$(tail -3 "$OUT/build.log" | tr '\n' ';')"
fi

# ---- 3. drift -------------------------------------------------------------
drifted=""
for f in $GENERATED; do
  if [ -f "$f" ] && [ -f "$OUT/before/$f" ]; then
    cmp -s "$f" "$OUT/before/$f" || drifted="$drifted $f"
  fi
done
if [ -z "$drifted" ]; then
  log_pass drift "generated files match their sources"
else
  log_fail drift "rebuilt and changed:$drifted (commit the rebuild)"
fi

# ---- 4. headless ----------------------------------------------------------
if [ "${VERIFY_SKIP_HEADLESS:-}" = "1" ]; then
  log_skip headless "VERIFY_SKIP_HEADLESS=1, so no browser ran"
else
  [ -d node_modules/playwright ] || npm install --no-audit --no-fund > "$OUT/npm.log" 2>&1
  # ONE RETRY, and only for a CRASH.
  #
  # This droplet runs several repos' verify scripts at once, each launching its
  # own browser or bundler. Measured 2026-09-18 with ~2GB of 8GB free: a run
  # that passes standalone died on browser launch with no output at all. That
  # is the machine being busy, not the product being broken, and failing the
  # stage for it would teach everyone to ignore a red line.
  #
  # A stage that produced real FAIL lines is NOT retried. A genuine failure is
  # reported the first time, every time: retrying a real failure until it
  # passes is how a flaky suite gets built.
  headless_run() { node tests/headless.js > "$OUT/headless.log" 2>&1; }
  if headless_run; then
    log_pass headless "$(grep -a -c '^PASS' "$OUT/headless.log") checks"
  elif ! grep -aq '^FAIL' "$OUT/headless.log" && sleep 5 && headless_run; then
    log_pass headless "$(grep -a -c '^PASS' "$OUT/headless.log") checks, after one retry (the first launch crashed)"
  else
    why=$(grep -a '^FAIL' "$OUT/headless.log" | head -2 | tr '\n' ';')
    # A crash (a timeout, a missing browser) prints no FAIL line at all, so
    # fall back to the tail rather than reporting a failure with no reason.
    # A crash prints no FAIL line, so show the real error instead of a blank
    # reason. Blank lines and the node version banner are dropped, because
    # "crashed: ;Node.js v22.22.1;" is what the first version of this said and
    # it told nobody anything.
    [ -n "$why" ] || why="crashed: $(grep -av '^[[:space:]]*$' "$OUT/headless.log" \
      | grep -av '^Node.js v' | tail -4 | tr '\n' ';')"
    [ -n "$why" ] || why="crashed with no output at all; full log: $OUT/headless.log"
    log_fail headless "$why"
  fi
fi

# ---- the one line to paste into a PR --------------------------------------
if [ "$failed" = "0" ]; then
  echo "VERIFY PASS  $(date -u +%Y-%m-%dT%H:%MZ)  $(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
  exit 0
fi
echo "VERIFY FAIL  $failed stage(s)  $(date -u +%Y-%m-%dT%H:%MZ)  $(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
exit 1
