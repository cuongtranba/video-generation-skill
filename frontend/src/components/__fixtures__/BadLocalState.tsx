import { useState } from 'react'

// FIXTURE — intentionally violates the src/components/** local-state ban.
// This file is globally ignored by `bun run lint` (see the `ignores` entry
// in eslint.config.js) so it never breaks the normal suite. It exists solely
// to be targeted directly by `bun run lint:prove-ban` (scripts/prove-lint-ban.sh),
// which asserts ESLint still rejects it — i.e. that the ban actually bites.
export function BadLocalState() {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(count + 1)}>{count}</button>
}
