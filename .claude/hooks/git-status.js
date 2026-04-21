#!/usr/bin/env node
// UserPromptSubmit: inject current branch + clean/dirty state into Claude's context.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
if (!fs.existsSync(path.join(projectRoot, ".git"))) process.exit(0);

const run = (args) => {
  const r = spawnSync("git", args, { cwd: projectRoot, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
};

const branch = run(["rev-parse", "--abbrev-ref", "HEAD"]) || "detached";
const porcelain = run(["status", "--porcelain"]);
const dirty = porcelain ? `dirty (${porcelain.split("\n").length} changed)` : "clean";
const ahead = run(["rev-list", "--count", "@{u}..HEAD"]) || "0";
const behind = run(["rev-list", "--count", "HEAD..@{u}"]) || "0";
const sync =
  ahead === "0" && behind === "0" ? "synced" : `ahead ${ahead} / behind ${behind}`;

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: `[git] branch=${branch} · ${dirty} · ${sync}`,
  },
}));
