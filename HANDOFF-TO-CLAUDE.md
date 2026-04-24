# Handoff to the second Claude

Edouard is signed in on another account and hit the 5-hour rate limit mid-session (resets 2026-04-24 18:00 America/Toronto). You are the replacement. Read this file top to bottom, do the work, then **delete this file before any commit lands on a non-handoff branch**. See "Rules for this file" below.

---

## Rules for this file (read first)

1. **Delete `HANDOFF-TO-CLAUDE.md` from the working tree before you commit anything other than the initial handoff commit.** It must not enter `frontend/asa-title-page`, `main`, or any PR. If you forget, Asa and future-Edouard will pull it down — that's the "don't fuck up asa" in the original ask.
2. This branch (`ed-handoff-asa-title`) is a transient carrier. Do real work here if you want, but treat it as disposable — when you're done, cherry-pick or rebase your commits onto `frontend/asa-title-page` **without** the commit that adds this file, then open the PR from `frontend/asa-title-page`.
3. Do not `git push --force` on `main` or on `frontend/asa-title-page`. Force-pushing this branch is fine if you need to.

---

## Who you are

- **User:** Edouard Gendron, frontend lane.
- Git identity is already set: `edouardot / edouardghabitationcanadienne@gmail.com`. Verify with `git config user.email`.
- Repo root: `C:\Users\Portatif_acer\Downloads\PROJECT\fabrique` (Windows, bash via Git for Windows).

## Must-read before touching code

- `CLAUDE.md` at repo root — the full lane rules (frontend vs backend), stack lock, transitions, audio, conventions. **Non-optional.**
- `AGENTS.md` at repo root — "this is NOT the Next.js you know." Next.js 16 has breaking changes from training data. When writing routing/RSC/caching/middleware, check `node_modules/next/dist/docs/` first.
- Edouard's lane forbids edits to `app/api/**`, `middleware.ts`, `lib/server/**`. Stay out.

## Where the work is

- **Branch:** `frontend/asa-title-page` (Edouard's real working branch). This handoff branch is `ed-handoff-asa-title`, forked from the same tip with all WIP committed.
- **"asa-title-page" is a section name, not Asa Chelius.** It's the title-page sculpture section. Don't panic about the branch name — this is frontend work.
- **Route in question:** the anamorphic FABRIQUE sculpture scene (see `components/three/sculpture/sculpture-scene.tsx`). Builds the shard-cloud wordmark that reads as "FABRIQUE" from a sweet-spot camera pose. Iterative — tune, reload, evaluate.

## What's in this WIP snapshot

Modified (7):
- `app/globals.css` — styling for the new sculpture route chrome.
- `components/three/sculpture/projects-button.tsx` — NOS PROJETS metal button (big rewrite, +279 lines).
- `components/three/sculpture/sculpture-route.tsx` — wraps the scene, owns the showcase-mode HTML overlay.
- `components/three/sculpture/sculpture-scene.tsx` — scene shell: canvas, env map, reveal camera, floor reflector, dust, button, cloud.
- `components/three/sculpture/shards.tsx` — instanced shard rendering.
- `components/three/sculpture/suspended-cloud.tsx` — physics + sampler for the shard cloud. Now subscribes to the showcase bus and morphs to per-card outlines.
- `components/three/sculpture/tuning.ts` — all tunables; heavily extended (palette lerp, overhead beam/cones/dust, reveal animation, showcase-related spring scaling).

New / untracked (4):
- `components/three/sculpture/overhead.tsx` — `CeilingBeam` + `DustMotes` for atmospheric fill above the sculpture.
- `components/three/sculpture/palette.ts` — light/dark palette hook (`useSculpturePalette`). MutationObserver on `body.sculpture-dark`.
- `components/three/sculpture/showcase-bus.ts` — module-level pub/sub to toggle showcase mode without threading React context through the Canvas.
- `components/three/sculpture/showcase-targets.ts` — computes the 5-card perimeter target positions the letter shards morph to when showcase is active.

## Known issue to verify first

`components/three/sculpture/overhead.tsx:30` reads `palette.ceilingBeam`, but `SculpturePalette` in `palette.ts` does **not** declare that field. At minimum this is a type error under `tsc --noEmit`; at runtime the color will be `undefined` and the ceiling beam will render as default white.

Fix: add `ceilingBeam: string;` to the `SculpturePalette` type, set sensible values on both `LIGHT` (~`"#c9c6bc"` matches `TUNING.ceilingBeamColor`) and `DARK` (darker warm grey — eyeball it). Run `npx tsc --noEmit` after to confirm clean.

## Working conventions (from CLAUDE.md, abridged)

- Conventional commits: `feat:`, `fix:`, `refactor:`, `chore:`. One logical change per commit.
- Branches: `frontend/<topic>`.
- File naming: kebab-case. Named exports only. `"use client"` at top of every R3F/hook/browser-API component.
- Deterministic randomness in scenes: the `Math.sin(seed * 12.9898) * 43758.5453 % 1` idiom, not `Math.random()` (or use `mulberry32` — `showcase-targets.ts` already does).
- Tailwind v4 is CSS-first — `@theme` lives in `app/globals.css`. There is no `tailwind.config.ts`.
- `prefers-reduced-motion` must be respected for any new motion.

## How to merge back when done

```bash
git checkout frontend/asa-title-page
git cherry-pick <your-commit-shas-from-ed-handoff-asa-title>   # skip the commit that added HANDOFF-TO-CLAUDE.md
# verify the handoff file is NOT present:
ls HANDOFF-TO-CLAUDE.md 2>/dev/null && echo "STOP — delete it first" || echo "clean"
git push origin frontend/asa-title-page
```

Or, simpler: do all work on `ed-handoff-asa-title`, then when finished `git rm HANDOFF-TO-CLAUDE.md && git commit -m "chore: remove handoff"` and open the PR directly from this branch targeting `main` (or merge it into `frontend/asa-title-page` locally, drop the HANDOFF-adding commit with interactive rebase, and push `frontend/asa-title-page`). Pick whichever feels safer — but the handoff file does **not** get shipped.

## One last thing

Edouard prefers progress over prose. Short responses. Don't re-summarize diffs he can read himself. Plan non-trivial changes out loud before coding; ask on ambiguous creative direction; don't invent UI he didn't ask for.

Good luck.
