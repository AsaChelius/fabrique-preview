#!/usr/bin/env node
/**
 * PreToolUse guard for Write|Edit.
 *
 *   1. Always block .env files (secret hygiene — both lanes).
 *   2. Enforce the Edouard / Asa lane split via `git config user.email`:
 *        - Edouard may NOT modify app/api/**, middleware, lib/server/**, prisma/**, db/**.
 *          (Edouard CAN create a brand-new file in backend territory — scaffolding a
 *           stub for Asa is fine; modifying existing backend code is not.)
 *        - Asa may NOT modify the frontend surface: app/page, app/layout,
 *          app/globals.css, components/**, public/**.
 *
 * Unknown user (email doesn't match) → pass through. Set `git config user.email`
 * locally so the hook can identify your lane.
 */
const fs = require("fs");
const { spawnSync } = require("child_process");

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let input;
  try { input = JSON.parse(raw); } catch { process.exit(0); }
  const fp = (input.tool_input && (input.tool_input.file_path || input.tool_input.path)) || "";
  if (!fp) process.exit(0);
  const norm = fp.replace(/\\/g, "/");

  const deny = (reason) => {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }));
    process.exit(0);
  };

  // 1. Secret hygiene — applies to both lanes.
  if (/(^|\/)\.env(\.|$)/.test(norm)) {
    deny(
      "SECRETS GUARD: Refusing to write .env files. Share values out-of-band (Vercel env, " +
      "1Password, etc.) — do not put credentials in files Claude writes."
    );
  }

  // 2. Identify the user via repo-local git config.
  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const r = spawnSync("git", ["config", "user.email"], { cwd: projectRoot, encoding: "utf8" });
  const email = ((r.stdout || "") + "").trim().toLowerCase();
  const EDOUARD = email === "edouardghabitationcanadienne@gmail.com" || /edouard/.test(email);
  const ASA = /asa|chelius/.test(email);
  if (!EDOUARD && !ASA) process.exit(0); // unknown user: pass through

  // 3. Categorize the path.
  const isBackend =
    /(^|\/)(app|pages|src\/app|src\/pages)\/api\//.test(norm) ||
    /(^|\/)middleware\.(ts|js|tsx|jsx)$/.test(norm) ||
    /(^|\/)lib\/server\//.test(norm) ||
    /(^|\/)(prisma|db)\//.test(norm);

  const isFrontend =
    /(^|\/)components\//.test(norm) ||
    /(^|\/)public\//.test(norm) ||
    /(^|\/)app\/globals\.css$/.test(norm) ||
    /(^|\/)app\/(page|layout)\.(tsx|ts|jsx|js)$/.test(norm) ||
    /(^|\/)app\/(?!api\/)[^/]+\/.*(page|layout)\.(tsx|ts|jsx|js)$/.test(norm);

  const fileExists = (() => {
    try { return fs.statSync(fp).isFile(); } catch { return false; }
  })();

  // 4. Enforce.
  if (EDOUARD && isBackend && fileExists) {
    deny(
      "BACKEND BOUNDARY: " + norm + " is in Asa Chelius's lane (API / middleware / server lib). " +
      "You're helping Edouard — don't modify existing backend code. Leave a TODO or " +
      "coordinate with Asa directly. (New backend stubs are allowed; modifying existing files is not.)"
    );
  }

  if (ASA && isFrontend) {
    deny(
      "FRONTEND BOUNDARY: " + norm + " is in Edouard Gendron's lane (frontend surface, " +
      "components, design tokens). You're helping Asa — don't modify frontend code. " +
      "If the UI needs a change to support backend work, leave a TODO and ping Edouard."
    );
  }

  process.exit(0);
});
