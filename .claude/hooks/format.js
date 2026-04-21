#!/usr/bin/env node
// PostToolUse: format edited file with the project's prettier. Silent skip if not installed.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let input;
  try { input = JSON.parse(raw); } catch { process.exit(0); }

  const fp =
    (input.tool_response && (input.tool_response.filePath || input.tool_response.file_path)) ||
    (input.tool_input && (input.tool_input.file_path || input.tool_input.path)) ||
    "";
  if (!fp) process.exit(0);
  if (!/\.(ts|tsx|js|jsx|mjs|cjs|css|scss|json|md|html)$/i.test(fp)) process.exit(0);

  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const prettierBin = path.join(
    projectRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "prettier.cmd" : "prettier"
  );
  if (!fs.existsSync(prettierBin)) process.exit(0);

  const resolvedFp = path.resolve(fp);
  const resolvedRoot = path.resolve(projectRoot);
  if (!resolvedFp.toLowerCase().startsWith(resolvedRoot.toLowerCase())) process.exit(0);

  spawnSync(prettierBin, ["--write", "--log-level", "silent", fp], {
    stdio: "ignore",
    shell: false,
  });
  process.exit(0);
});
