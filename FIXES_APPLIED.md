# Fixes applied

## 1. Buy-card overflow / cut-off text on mobile

**Root cause:** `src/pages/index.tsx` wraps `SwapCard` (and the launch-pool
and docs pages) in `<section className="grid items-start gap-5 lg:grid-cols-[...]">`
with no base column definition below the `lg:` breakpoint. On a plain
`grid` with no explicit `grid-template-columns`, Chrome sizes the implicit
column to the *preferred* width of its content. Since `SwapCard` carries
`max-w-[440px]`, the column locked in at 440px even on a 360–412px phone
screen — clipping everything past the right edge (the `ETH` pill, the
`$PONSPOOL` pill, the rate line). Confirmed by running the app headless at
your device's viewport width and inspecting the computed
`grid-template-columns` before/after the fix (440px → correctly shrinks to
match the viewport).

A smaller, secondary issue: the decorative background glow blobs in
`Ambient()` (`src/App.tsx`) extended past the right edge of the viewport
and weren't clipped, adding ~44px of phantom horizontal scroll room on
mobile.

**Fix:**
- `src/pages/index.tsx` — added `grid-cols-1` as the base class on all
  three affected `<section>`/`<div>` grids (buy page, launch-pool page,
  info-page sidebar layout), so the column can shrink below `lg:`.
- `src/App.tsx` — added `overflow-hidden` to the decorative `Ambient` layer.
- `src/index.css` — added `overflow-x: hidden` to `html` and `body` as a
  safety net against any future decorative/absolute element doing the same
  thing.

## 2. Shared transaction feed inconsistent across browsers

**Root cause:** `server.mjs` stored the shared activity feed
(`activityPosts`) in a plain in-memory `Map`. Your Render service
(`render.yaml`) is on the **free plan**, which spins down after ~15 minutes
idle and restarts on the next request — wiping that Map back to just one
hardcoded seed transaction. Whoever loads the site right after a cold start
sees an empty/near-empty feed; transactions published before that restart
are gone for everyone else. That produces exactly the symptom in your
screenshots: some browsers show pooled tokens, others are missing them.

**Fix:** durable storage via **Turso (libSQL)**. `server.mjs` now:
- Connects via `@libsql/client` when `TURSO_DATABASE_URL` is set.
- Creates the `activity_posts` table automatically on startup (it's SQLite
  under the hood, so no separate migration step or dashboard SQL needed).
- Seeds the one real historical transaction into that table on first run.
- Falls back to the old in-memory Map (with a startup warning) if the env
  var isn't set, so nothing breaks if you deploy before wiring this up —
  but the underlying bug is still present until you do.

**Verified locally** (not just written): ran the actual `server.mjs`
against a local SQLite file standing in for Turso — confirmed the table
auto-creates, the seed row is present, a new row inserted through the same
SQL path used by publish shows up correctly ordered on the next fetch, and
critically, **killed the node process entirely and restarted it — the data
was still there**, which is the exact failure mode being fixed. Also
verified the no-`TURSO_DATABASE_URL` fallback still starts cleanly and
serves the seed row.

### Action required on your end (this is infrastructure, not just code)

1. Create a Turso database:
   ```
   turso db create ponspool
   turso db show ponspool --url
   turso db tokens create ponspool
   ```
   (or via the Turso web dashboard at turso.tech if you don't have the CLI)
2. On your Render service's Environment tab, add:
   - `TURSO_DATABASE_URL` — the `libsql://...` URL from `turso db show`
   - `TURSO_AUTH_TOKEN` — the token from `turso db tokens create`
3. Redeploy. The `activity_posts` table creates itself on first boot —
   nothing else to run.

Until those two env vars are set, the server logs a warning on startup and
keeps using the in-memory fallback, so the underlying bug (feed resets on
every cold start) will still be present — this is expected until step 2 is
done.

## Files changed
- `src/index.css`
- `src/App.tsx`
- `src/pages/index.tsx`
- `server.mjs`
- `package.json` (swapped `@supabase/supabase-js` → `@libsql/client`)
- `package-lock.json`
- `.env.example` (documents the two new required env vars)
