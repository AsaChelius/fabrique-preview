# FABRIQUE — asaandedsites

Joint portfolio + creative-dev studio site for **Edouard Gendron** (frontend) and **Asa Chelius** (backend).
Brand word: **fabrique** (FR — *workshop*).

**Stack:** Next.js 16 · TypeScript · Tailwind v4 · Matter.js · GSAP · Framer Motion · Resend · Vercel.

---

## Quick start

```bash
git clone git@github.com:clipsofthefog/fabrique.git asaandedsites
cd asaandedsites
npm install
npm run dev
```

Open http://localhost:3000.

For the contact form to work locally, ask Edouard (or check Vercel) for a `RESEND_API_KEY` and put it in `.env.local` (gitignored).

---

## First-clone setup

Set your **repo-local** git identity so the Claude lane hook can identify you:

```bash
git config user.name  "<your name>"
git config user.email "<your email>"
```

If your email isn't in the `CLAUDE.md` §1 table yet, add it — the `guard-write.js` hook uses it to route lane enforcement.

---

## Who owns what

| Area | Owner | Paths |
| --- | --- | --- |
| UI, hero physics, scroll choreography, components, design tokens | **Edouard** | `app/**` (except `api/`), `components/**`, `lib/` (except `lib/server/`), `public/**` |
| API routes, email, server-only utilities | **Asa** | `app/api/**`, `middleware.ts`, `lib/server/**` |
| Shared types, root configs | both | `types/**`, `next.config.ts`, `tsconfig.json` |

Full rules: [CLAUDE.md](./CLAUDE.md). The `.claude/hooks/guard-write.js` hook enforces the boundary based on `git config user.email`.

### Hard rules
- **Nobody commits `.env*`** — `.gitignore` + the Claude hook both block it. Share credentials out-of-band.
- **Branch naming:** `frontend/<topic>` (Edouard) or `backend/<topic>` (Asa).
- **PRs only** into `main`. Vercel posts a preview URL on every PR.
- **No force pushes to `main`** without coordination.
- **Conventional commits** (`feat:`, `fix:`, `refactor:`, `chore:`) — one logical change per commit.

---

## Project layout

```
app/
  api/
    contact/route.ts      # Asa — contact endpoint (Resend)
  globals.css             # Edouard — design tokens, --energy CSS var
  layout.tsx              # Edouard — root layout
  page.tsx                # Edouard — hero + sections
components/               # Edouard — React components
lib/
  server/                 # Asa — server-only utilities
  (root lib)              # Edouard — client-side utilities
types/                    # both — shared TS types (e.g. contact.ts)
public/                   # Edouard — static assets
.claude/                  # shared Claude Code config (hooks, agents, skills)
```

---

## Claude Code setup

Both devs use Claude Code. The repo ships with:

- **Hooks** (`.claude/hooks/`):
  - `guard-write.js` — detects your lane via git email, blocks edits in the *other* lane, blocks `.env` writes.
  - `warn-bash.js` — flips destructive bash commands (`rm -rf`, `git reset --hard`, force push) to "ask".
  - `git-status.js` — injects branch + clean/dirty state into every prompt.
  - `format.js` — best-effort prettier format on write (silent skip if prettier not installed).
- **Agents** (`.claude/agents/`): `physics-doctor`, `ui-reviewer` (frontend-flavored — Asa, feel free to add backend agents).
- **Skills** (`.claude/skills/`): `hero-iterate`, `ship-section`.

Personal tweaks go in `.claude/settings.local.json` (gitignored).

---

## Scripts

```bash
npm run dev       # local dev server
npm run build     # production build
npm run start     # run production build
npm run lint      # eslint
```

---

## Deploying

Vercel — `main` → production, PRs → preview URLs. Env vars live in the Vercel project settings.
