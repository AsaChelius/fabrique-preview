# FABRIQUE — Claude rules

This repo is shared by two developers working in **separate lanes**. Before
doing anything, figure out which developer you're helping and apply the
matching lane rules.

---

## 1. Identify your user (read first, every session)

Run:

```bash
git config user.email
```

| Email | User | Lane |
| --- | --- | --- |
| `edouardghabitationcanadienne@gmail.com` | **Edouard Gendron** | frontend / UI |
| *(Asa — fill in your email here after clone)* | **Asa Chelius** | backend / API |
| anything else / empty | unknown | ask before acting |

If identity is unclear, **ask the user who they are** before any tool call that
touches lane-boundary code.

A `PreToolUse` hook (`.claude/hooks/guard-write.js`) also enforces the boundary
by reading `git config user.email`. If a Write/Edit is blocked with a
`BACKEND BOUNDARY` or `FRONTEND BOUNDARY` message, you're in the wrong lane —
don't argue with the hook, respect it.

Read **both lane sections below** for project context, but only *enforce* the
rules for your user's lane.

---

## 2. Project overview (applies to both lanes)

**Company:** FABRIQUE (French for *workshop / factory*). Joint studio
for Edouard (frontend) and Asa (backend).

**What this repo is:** the studio's own portfolio + showcase site. Not a
client project. Design bar is deliberately high — this is the calling card.

**Live target:** Vercel. `main` → production; every PR gets a preview URL.

### Aesthetic — cosmic / dark / physics-forward

Every route is a full-viewport R3F `<Canvas>` on a black starfield. The site
feels like a series of cinematic scenes you navigate between — not pages with
text. Bruno Simon playfulness meets JWST-poster seriousness. **No generic
portfolio grids anywhere.**

### Site structure — **discrete 3D routes** (not one long scroll)

Four routes, each with its own canvas and its own scene:

- **`/` — Studio (hero).** FABRIQUE letters as blue-outline / black-fill 3D
  glyphs with custom PD-spring physics (no Rapier on this route — pure
  manual physics). Six draggable iridescent orbs (varied shapes). Collisions
  between letters + orbs play synthed SFX. Behind it all: a "black hole" —
  `VortexTunnel` with tinted rings + pure-black event-horizon core. Camera
  parallax follows cursor. **Clicking the Work tab from here triggers a
  cinematic zoom into the singularity** (see Transitions below).
- **`/coal` — Work.** Deep-space scene. JWST Carina nebula billboard
  (custom shader with radial-fade so the square PNG edge is invisible).
  Five project "planets" (stripe/grid/crystal/volcano/plasma — shapes in
  `lib/projects.ts`). Twenty draggable debris shards (Rapier bodies with
  a depth-Z snapshot drag system to prevent teleport bugs). Orbital
  `FabriqueShip` with double-sided 3D "FABRIQUE" text on its hull —
  clicking it fires the warp transition. Scene elements fade in staggered
  via the `SceneFadeIn` wrapper so nothing pops.
- **`/about` — About (cockpit).** Two astronauts (Edouard + Asa as pilot
  callsigns) inside a detailed spaceship cockpit. Scripted multi-turn
  dialogue runs on a loop — speech bubbles anchored above each pilot via
  drei `<Html>`. 12 conversation scripts cycle with repeat-avoid logic.
- **`/contact` — Contact.** Client-side form UI that POSTs JSON to
  `/api/contact`. **Endpoint is Asa's** — see §4.

A sticky pill nav (`.route-nav`, top-center) switches between them.
Persistent `.site-backdrop` CSS starfield sits at `z-index: -1` so during
canvas swaps the user sees stars, never a black void.

### Transitions — cinematic, not instant

- **Any route → `/`** (default): `app/template.tsx` Framer-Motion fade +
  blur + scale.
- **`/` → `/coal` only**: intercepted by `components/ui/route-nav.tsx`.
  Fires a `vortex-zoom` CustomEvent that the hero scene listens for,
  lerping the camera into the black hole over ~1.3s. A `.vortex-fade-overlay`
  keyframe goes to full black. `router.push("/coal")` fires at 1350ms so
  `/coal` mounts unseen; its `SceneFadeIn` groups then reveal the new scene
  as the overlay fades out. Total ~2.4s.
- **Ship click on `/coal`**: `WarpOverlay` (streaks + flash + vignette),
  then route change.

Everything respects `prefers-reduced-motion`.

### Audio — synthed, no asset files

`lib/sound.ts` owns the whole audio system. **Unlocked on first
`pointerdown` / `keydown`** (see `RouteNav` useEffect). Then `startAmbient()`
starts a detuned-oscillator drone + filter LFO + pentatonic chimes. Per-event
SFX via `playSound(voice)` with voices:

```
clack | whoosh | ding | thud
orb-pop | orb-knock | orb-ping | orb-chime | orb-wobble | orb-thump
```

Letter-letter collisions use `clack`. Each orb shape has its own voice
(`orb-*`) so the scene sounds different when you drag different orbs.

### Stack (locked — don't swap libraries without asking)

- **Next.js 16** (App Router) + **TypeScript strict** + **React 19**
- **Tailwind CSS v4** — CSS-first `@theme` config in `app/globals.css`
  (there is no `tailwind.config.ts`). All route chrome is also in
  `globals.css` — `.scene-root`, `.scene-overlay`, `.route-nav`,
  `.hero-cta`, `.project-modal`, `.pilot-label`, `.pilot-chat-bubble`,
  `.ship-label`, `.site-backdrop`, `.vortex-fade-overlay`, `.warp-overlay`.
- **Three.js** via **`@react-three/fiber`** — 3D scene graph
- **`@react-three/drei`** — `<Text3D>`, `<Html>`, `<Billboard>`, etc.
- **`@react-three/rapier`** — used on `/coal` debris + ship; **NOT** on
  hero (hero uses pure manual PD-spring physics for tight control).
- **`@react-three/postprocessing`** — available but currently unused
  (removed due to flashing issues; reintroduce with care).
- **Lenis** — smooth scroll (`components/ui/smooth-scroll.tsx` mounted in
  `layout.tsx`).
- **GSAP** — installed; currently unused.
- **Framer Motion** — route transition shell at `app/template.tsx`.
- **Web Audio synth** — `lib/sound.ts`. No asset files.
- **Resend** — contact form email (backend lane).

No UI component libraries (shadcn, MUI, Chakra, etc.). Custom design is the
point.

### File map

Quick lookup so both Claudes can navigate:

```
app/
  layout.tsx             Root — mounts SmoothScroll, brand, RouteNav,
                         WarpOverlay, VortexFadeOverlay, site-backdrop.
  template.tsx           Framer-motion route transition wrapper.
  globals.css            All custom CSS (theme + route chrome + overlays).
  page.tsx               / — renders <HeroScene /> + hero copy.
  coal/page.tsx          /coal — renders <CoalRoute />.
  about/page.tsx         /about — renders <AboutRoute />.
  contact/page.tsx       /contact — renders <ContactForm /> + copy.
  api/contact/route.ts   POST endpoint — STUB (Asa owns).

components/
  three/
    hero-scene.tsx       / — letters, orbs, vortex. Tuning constants up top.
    coal-scene.tsx       /coal — nebula, planets, debris, ship, SceneFadeIn.
    cockpit-scene.tsx    /about — cockpit + 2 pilots + dialogue anchors.
  about/about-route.tsx  Wraps cockpit, owns dialogue state, about-panel.
  coal/coal-route.tsx    Wraps coal scene, active project state + modal.
  ui/
    route-nav.tsx        Sticky nav. Intercepts / → /coal for vortex zoom.
    smooth-scroll.tsx    Lenis mount.
    warp-overlay.tsx     Ship-click streak/flash transition.
    vortex-fade-overlay.tsx  Studio→Work fade-to-black shell.
    contact-cta.tsx      Pill CTA used across hero copy.
    contact-form.tsx     Client form — POSTs ContactFormData to /api/contact.
    project-modal.tsx    Shown on /coal when a planet is clicked.

lib/
  sound.ts               Web Audio: unlockAudio, startAmbient, playSound(voice).
  projects.ts            5 project entries (id, title, desc, tags, glowColor,
                         planet shape, link).
  server/                Asa's territory.

public/
  fonts/helvetiker_bold.typeface.json  For drei <Text3D>.
  nebulas/carina.jpg     JWST Carina Nebula.

types/
  contact.ts             Shared — ContactFormData + ContactFormResponse.
```

---

## 3. Frontend lane — Edouard

### You may edit
- `app/**` EXCEPT `app/api/**`
- `components/**`
- `lib/**` EXCEPT `lib/server/**`
- `public/**`
- `types/**` (shared — coordinate with Asa on type changes)
- root configs (`next.config.ts`, `tsconfig.json`, `eslint.config.mjs`,
  `postcss.config.mjs`)

### You must NOT edit
- `app/api/**`, `pages/api/**`, `src/app/api/**`
- `middleware.ts`
- `lib/server/**`
- `prisma/**`, `db/**` (if introduced)
- `.env` / `.env.*` (both lanes — hand-managed, never committed)

For the contact form: the UI is done (`components/ui/contact-form.tsx`) and
POSTs JSON matching `ContactFormData` (from `types/contact.ts`) to
`/api/contact`. **Don't touch the endpoint — Asa owns it.**

### Edouard's priorities
1. **Physics feel matters more than physics correctness.** Hero uses
   hand-rolled PD springs — all tunables are `TUNING` constants at the top
   of `components/three/hero-scene.tsx`. Tune there, reload, repeat. Don't
   re-introduce Rapier on the hero without a reason.
2. **Seamless transitions.** Any new route must participate in the same
   transition grammar (template fade minimum; custom only if it earns it).
   Staggered `SceneFadeIn`-style reveal is the standard for 3D-heavy routes.
3. **Protect the quality bar downstream.** No filler sections. No generic
   portfolio grids. No lorem ipsum committed to `main`.
4. **Respect `prefers-reduced-motion`** — all overlays (`.warp-overlay`,
   `.vortex-fade-overlay`, `.hero-cta::before`, `.site-backdrop`) already
   have reduced-motion escape hatches; new motion must too.
5. **Performance:** each route owns its own canvas (acceptable while scenes
   are small). Lazy-load anything >50kb. TTI < 2s on 4G.

### Conventions (frontend)
- **File naming:** kebab-case (`hero-scene.tsx`, `coal-route.tsx`).
- **Exports:** named, not default.
- **Client boundary:** every component that imports R3F, hooks, or browser
  APIs starts with `"use client"`. Route `page.tsx` files are thin
  server-components that just render a client component.
- **Colors:** palette in `app/globals.css` `@theme`. Per-material accent
  colors (letter blue, orb iridescence, planet glow) are fine inline — they
  belong to the scene, not the design tokens.
- **Custom CSS:** Tailwind first for UI chrome; raw CSS in `globals.css`
  for shader-adjacent, overlay, and 3D-anchored HTML styling.
- **Deterministic randomness** in scenes: use
  `Math.sin(seed * 12.9898) * 43758.5453 % 1` seeded by an id, not
  `Math.random()` — so things don't reshuffle every render.

### Agents (frontend)
- `physics-doctor` — diagnose hero feel issues.
- `ui-reviewer` — run after shipping any non-trivial component, before commit.

### Skills (frontend)
- `/hero-iterate` — tight loop for tuning the physics hero.
- `/ship-section` — canonical workflow for adding a new site section.

---

## 4. Backend lane — Asa

### You may edit
- `app/api/**`, `pages/api/**`, `src/app/api/**`
- `middleware.ts`
- `lib/server/**`
- `prisma/**`, `db/**` (if introduced)
- `types/**` (shared — coordinate with Edouard)

### You must NOT edit
- `app/page.tsx`, `app/layout.tsx`, `app/template.tsx`, `app/globals.css`
- `app/about/**`, `app/coal/**`, `app/contact/page.tsx` — frontend routes
- `components/**`
- `public/**`
- `.env` / `.env.*`

### Stack for your work
- **Route Handlers** (`route.ts` exports) — Next.js 16 App Router.
- **Resend** for email (`RESEND_API_KEY` env var — share credentials
  out-of-band, never commit).
- **TypeScript strict** — match shared shapes in `types/`.

### First task for Asa
Implement `app/api/contact/route.ts` (currently a 501 stub).

The frontend UI (`components/ui/contact-form.tsx`) already POSTs JSON
matching `ContactFormData`:

```ts
// types/contact.ts
export type ContactFormData = {
  name: string;
  email: string;
  message: string;
  website?: string;  // honeypot — must be empty from the real form
};

export type ContactFormResponse =
  | { ok: true }
  | { ok: false; error: string; field?: keyof ContactFormData };
```

Requirements:
- Server-side validation of `ContactFormData`.
- Honeypot: `body.website` must be empty — reject if filled (silent 200 is
  acceptable so bots can't detect).
- Rate-limit by IP (in-memory, Upstash, whatever you prefer).
- Send via Resend to Edouard's inbox.
- Return 200 on success, 4xx on validation errors, 5xx on send failure.
- Return JSON matching `ContactFormResponse`.

Anything server-only (validators, rate-limit state, resend client) goes in
`lib/server/`.

### Optional — customize your local setup
`.claude/settings.local.json` is gitignored, so it's safe to add personal
hooks there (auto-format, logging, etc.) without affecting Edouard.

---

## 5. Shared rules (both lanes)

### Git
- `main` is protected; Vercel deploys from it.
- Edouard: `frontend/<topic>` branches (e.g. `frontend/hero-physics`).
- Asa: `backend/<topic>` branches (e.g. `backend/contact-endpoint`).
- Merge via PR — Vercel posts a preview URL on every PR.
- **Conventional commits** (`feat:`, `fix:`, `refactor:`, `chore:`).
- One logical change per commit — don't batch unrelated edits.
- **Never** `git push --force` or `git reset --hard` without the user
  explicitly asking (the bash hook will also flag it).

### How to work
1. **Plan non-trivial changes first.** For anything beyond a small tweak,
   describe the approach before writing code.
2. **Read before editing.** Never propose changes to code you haven't opened.
3. **Use subagents for parallel research.** Don't duplicate a subagent's
   searches yourself.
4. **Ask instead of guessing** on ambiguous creative direction. This is a
   design-driven project, not CRUD.
5. **Short responses.** Progress over prose.

### Secret hygiene
`.env*` is gitignored and blocked by the Write/Edit hook. Never write
credentials into any file Claude edits. Values live in Vercel project
settings or shared out-of-band.

---

## 6. Next.js 16 note

This is **Next.js 16**. Some APIs differ from older training data. Consult
`AGENTS.md` at the repo root and `node_modules/next/dist/docs/` before
writing routing, RSC / server-component patterns, caching directives, or
middleware.

@AGENTS.md
