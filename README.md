# Garage Tracker — PWA

A pixel-DOS-garage-styled PWA for tracking cars, parts, and
maintenance. No backend: the data lives in a **private git repo** that the
browser syncs (isomorphic-git), and `garage.md` is rendered from an
append-only event log.

```
app/            ← you are here (public, GitHub Pages)
  src/core/     ← framework-agnostic engine (fold, claims, reminders, validator)
  src/sync/     ← browser git (isomorphic-git + IndexedDB filesystem)
  src/views/    ← PWA screens
../garage/      ← private data repo (events/, claims/, garage.md, validator)
```

## Develop

```sh
npm install --ignore-scripts   # (Windows/OneDrive: plain npm install can EPERM)
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run
node node_modules/vite/bin/vite.js          # dev server
node node_modules/vite/bin/vite.js build    # → dist/
```

> This box's quirk: `npx`/`npm run` shims spawn cmd.exe children that lose
> `node` from PATH. Invoke the tools via `node node_modules/<pkg>/…` directly.

## Deploy

`.github/workflows/deploy.yml` builds on push and publishes to GitHub Pages
(base path `/garage-pwa/`). One-time setup from the project root:

```sh
node scripts/push-to-github.mjs     # creates both repos, pushes, enables Pages
```

## Data model (30-second version)

- **Events** (`events/<id>.json`, append-only) are the source of truth.
- **State** = deterministic fold over events (`src/core/state.ts`).
- **garage.md** = render of state (`src/core/render.ts`). Only the renderer
  and the validator's `--write` mode may write it.
- **Claims** (LLM/paste output) go to `claims/pending/`, get reviewed in the
  PWA, and become events on approval (`src/core/claims.ts`).
- **Validator** (`tools/validate.mjs`, bundled from `src/core/validate.ts`)
  must pass on every commit: event schemas, id/date consistency, strict fold,
  garage.md freshness.

## Tests

48 tests across fold, conflicts, claims, render, reminders, and validator.
