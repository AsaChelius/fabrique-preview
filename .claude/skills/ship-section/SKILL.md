---
name: ship-section
description: End-to-end workflow for adding a new section to the asaandedsites portfolio. Use when Edouard says "let's build the [X] section" or similar. Ensures design-first thinking, subagent review, and clean commit — not just dropping code on main.
---

# Ship a new section

The steps below are NOT optional — following them is what separates this site from every generic portfolio. Run them in order.

## 1. Design brief (before any code)

Ask Edouard, in one short message:
- **Purpose:** what should the visitor feel/do in this section?
- **Content pillars:** what are the 2–4 key ideas? (not full copy yet)
- **Motion intent:** reveal-on-scroll? parallax? tied to `--energy`? static?
- **Layout intuition:** full-bleed, split, stacked, grid?

Don't skip to code. If Edouard is impatient ("just build it"), write down your assumptions for each of the four above and confirm in one sentence before coding.

## 2. Plan the component tree

Decide and state:
- Route (`app/page.tsx` inline, or separate route under `app/<slug>/page.tsx`?)
- Components to create (kebab-case files, named exports)
- What state/refs are needed (useRef for GSAP targets, useState for interactive toggles)
- Any new Tailwind tokens needed → add to `tailwind.config.ts`

## 3. Build

Rules:
- Named exports only, no defaults
- Tailwind first; CSS modules only for physics/shader-adjacent effects
- Use `--energy` for glow/intensity (driven by hero, falling through global state)
- Lazy-load anything heavy (`next/dynamic` for Matter.js/GSAP-heavy pieces)
- Placeholder copy is allowed during the build but flag it clearly with `{/* TODO copy */}` — ui-reviewer will block on it if it reaches commit

## 4. Review (mandatory)

Dispatch the **`ui-reviewer`** subagent with the list of files you created/modified. Address every "blocker" item. Address "should fix" items unless there's a reason not to — document the reason.

If the section involves the hero physics, also dispatch **`physics-doctor`**.

## 5. Commit

Branch: `frontend/<section-slug>` (create if not on it)

Commit style:
```
feat(<section>): <one-line summary>

<optional body — why this choice, what was considered and rejected>
```

One section = one PR. Do NOT batch multiple sections. Vercel will post a preview URL on the PR — share that with Asa.

## 6. Handoff

Tell Edouard:
- Preview URL (once pushed)
- Anything Asa needs to wire (endpoints, env vars) — with the exact contract (request/response shape)
- What's NOT yet done (real copy, real images, real links) so he has a punch list

## What this skill refuses to do

- Ship a section without design brief → generic output
- Ship without ui-reviewer pass → shipped bugs
- Commit placeholder copy to main → embarrassing
- Touch backend files → lane violation (hook would block anyway, but don't even try)
