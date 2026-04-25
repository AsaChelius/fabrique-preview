---
name: hero-iterate
description: Tight iteration loop for tuning the physics hero. Use when Edouard wants to adjust timing, feel, bounce count, assembly, or orb behavior. Avoids the trap of re-architecting the hero when a single parameter tweak is the real answer.
---

# Hero iteration loop

The hero is the identity of this site. Changes to it are high-stakes and high-frequency during the build. This skill keeps iteration fast and safe.

## 1. Describe the delta precisely

Before touching code, restate what Edouard wants in one sentence:
> "The letters fly too high on bounce 2" / "The orb glow starts too early" / "Assembly feels abrupt"

If his message is vague ("feels off"), ask ONE clarifying question — don't guess across ten parameters.

## 2. Classify the change

- **Parameter tweak** (gravity, restitution, friction, timing) → go to step 3
- **Sequence change** (number of bounces, assembly trigger, what happens during assembly) → dispatch `physics-doctor` first
- **Visual change only** (orb color, glow intensity, not physics) → normal edit, skip physics-doctor

## 3. Make the smallest possible change

- Change ONE number / ONE property at a time when possible
- Show the diff explicitly in the response (before/after), not just "updated"
- If you need to change multiple values to achieve the effect, explain why in one sentence

## 4. Verify

Tell Edouard:
- Which file:line you changed
- What to watch for on reload ("ball should now settle by ~2s instead of 4s")
- If relevant, suggest reloading with DevTools open to confirm no console errors

Do NOT run a dev server yourself unless Edouard asks — he has it running.

## 5. If it didn't land

Don't keep tweaking blindly. Dispatch `physics-doctor` with:
- What you changed
- What Edouard says is still wrong
- The current values of all relevant params

The doctor will diagnose across the full parameter space rather than ping-pong guessing.

## Anti-patterns this skill prevents

- Rewriting the hero component when a single `restitution` change was the answer
- Changing 6 values at once, then not knowing which one helped
- Turning hero iteration into a 2-hour refactor session
- Using `top`/`left` for motion (always `transform`)
