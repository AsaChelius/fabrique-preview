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

### The hero (both lanes should understand this — it's the identity)

Dark background. White **ball outline** falls under gravity, bounces on an
invisible floor. The letters of `fabrique` are lying flat at the bottom. Each
bounce launches the letters upward with real physics; they fall back before
the next bounce.

- Bounce 1: letters fly, then settle.
- Bounce 2: letters fly higher, partial return.
- Bounce 3: letters **assemble mid-air** into the word "fabrique", hover as if
  the ball is an engine.
- The ball then **transforms into a glowing energy orb** that "powers" the
  rest of the site.

A CSS custom property `--energy` (0 → 1) is the through-line — driven by
scroll, it controls glow / border pulse / hover intensity across every
section. Defined in `app/globals.css`. Don't duplicate it with separate
scroll-progress vars.

### Stack (locked — don't swap libraries without asking)

- **Next.js 16** (App Router) + **TypeScript strict**
- **Tailwind CSS v4** — CSS-first `@theme` config in `app/globals.css`
  (there is no `tailwind.config.ts`)
- **Matter.js** — 2D physics (hero ball + letters)
- **GSAP + ScrollTrigger** — orb assembly + scroll choreography
- **Framer Motion** — component-level transitions
- **Resend** — contact form email (backend lane)

No UI component libraries (shadcn, MUI, Chakra, etc.). Custom design is the
point.

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

For the contact form: build the **UI + client-side validation only**, POST to
`/api/contact`, and leave the endpoint untouched — Asa owns it. The shared
payload shape lives in `types/contact.ts`.

### Edouard's priorities
1. **Ship the hero with real feel** — gravity, restitution, friction values
   matter more than they sound. Run the physics; don't tune by vibes.
2. **Protect the hero's quality bar on every downstream section.** No filler.
   No generic portfolio grids. No lorem ipsum committed to `main`.
3. **Respect `prefers-reduced-motion`** for any motion-heavy section — fall
   back to a static reveal.
4. **Performance:** lazy-load Matter.js and the hero canvas. TTI < 2s on 4G.

### Conventions (frontend)
- **File naming:** kebab-case (`hero-canvas.tsx`, `energy-orb.tsx`)
- **Exports:** named, not default
- **Colors:** stay on the palette defined in `app/globals.css` `@theme` — no
  hardcoded hex values in components
- **Custom CSS:** Tailwind first; raw CSS only for physics-adjacent or
  shader-like effects. Use `@layer` properly.

### Agents (frontend)
- `physics-doctor` — diagnose hero feel issues
- `ui-reviewer` — run after shipping any non-trivial component, before commit

### Skills (frontend)
- `/hero-iterate` — tight loop for tuning the physics hero
- `/ship-section` — canonical workflow for adding a new site section

---

## 4. Backend lane — Asa

### You may edit
- `app/api/**`, `pages/api/**`, `src/app/api/**`
- `middleware.ts`
- `lib/server/**`
- `prisma/**`, `db/**` (if introduced)
- `types/**` (shared — coordinate with Edouard)

### You must NOT edit
- `app/page.tsx`, `app/layout.tsx`, `app/globals.css`
- `app/(sections|marketing|hero|...)/**` — any frontend page/route code
- `components/**`
- `public/**`
- `.env` / `.env.*`

### Stack for your work
- **Route Handlers** (`route.ts` exports) — Next.js 16 App Router
- **Resend** for email (`RESEND_API_KEY` env var — share credentials
  out-of-band, never commit)
- **TypeScript strict** — match shared shapes in `types/`

### First task for Asa
Implement `app/api/contact/route.ts` (currently a 501 stub). Requirements:
- Server-side validation of `ContactFormData` (shape in `types/contact.ts`)
- Honeypot field (`website`) must be empty — reject if filled
- Rate-limit by IP (pick your approach — in-memory, Upstash, etc.)
- Send via Resend to Edouard's inbox
- Return 200 on success, 4xx on validation errors, 5xx on send failure
- Return JSON matching `ContactFormResponse` (also in `types/contact.ts`)

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
