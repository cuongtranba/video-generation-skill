#!/usr/bin/env bash
# Proves the local-state ESLint ban actually fires, without adding the
# violating fixture to the normal `bun run lint` run (eslint.config.js
# globally ignores src/components/__fixtures__/**).
#
# `--no-ignore` forces ESLint to lint the fixture despite the ignore entry.
# If ESLint accepts it (exit 0), that's a REGRESSION — this script fails.
# If ESLint rejects it (non-zero, expected), this script prints OK and exits 0.
set -euo pipefail
cd "$(dirname "$0")/.."

if bunx eslint --no-ignore src/components/__fixtures__/BadLocalState.tsx; then
  echo "REGRESSION: eslint did not reject src/components/__fixtures__/BadLocalState.tsx" >&2
  echo "The local-state ban (no-restricted-syntax on useState) is no longer enforced." >&2
  exit 1
fi

echo "OK: local-state ban correctly rejected the useState fixture"
