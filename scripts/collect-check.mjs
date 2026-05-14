import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const reportDir = "reports";
const reportPath = resolve(reportDir, "compact-check-node.txt");

mkdirSync(reportDir, { recursive: true });

const lines = [];

function line(text = "") {
  lines.push(String(text));
}

function section(title) {
  line("");
  line(`===== ${title} =====`);
  line("");
}

function run(title, command) {
  section(title);

  try {
    const output = execSync(command, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: true
    });

    line(output.trimEnd());
  } catch (error) {
    line(`[COMMAND FAILED] ${command}`);

    if (error.stdout) {
      line(String(error.stdout).trimEnd());
    }

    if (error.stderr) {
      line(String(error.stderr).trimEnd());
    }

    if (!error.stdout && !error.stderr) {
      line(String(error));
    }
  }
}

function commandLines(command) {
  try {
    const output = execSync(command, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: true
    });

    return output
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function includeFile(path) {
  const p = path.replaceAll("\\", "/");

  if (p.startsWith("node_modules/")) return false;
  if (p.startsWith("dist/")) return false;
  if (p.startsWith("reports/")) return false;
  if (p === "package-lock.json") return false;

  if (/^src\/.*\.ts$/.test(p)) return true;
  if (/^tests\/.*\.ts$/.test(p)) return true;
  if (/^docs\/.*\.md$/.test(p)) return true;
  if (/^examples\/.*\.ts$/.test(p)) return true;
  if (/^scripts\/.*\.(ps1|mjs)$/.test(p)) return true;

  return [
    "README.md",
    "package.json",
    "tsconfig.json",
    "tsconfig.build.json",
    "vitest.config.ts",
    ".gitignore",
    ".gitattributes",
    "AGENTS.md"
  ].includes(p);
}

function fileText(title, path) {
  section(title);

  if (!existsSync(path)) {
    line(`[missing] ${path}`);
    return;
  }

  let text = readFileSync(path, "utf8");

  if (text.length > 30000) {
    text = `${text.slice(0, 30000)}\n[TRUNCATED]`;
  }

  line(text.trimEnd());
}

line("ActionFlow Compact Check");
line(`GeneratedAt: ${new Date().toISOString()}`);
line(`Location: ${process.cwd()}`);

run("git log", "git log --oneline -8");
run("git status", "git status --short");
run("git diff stat", "git diff --stat");
run("typecheck", "npm run typecheck");
run("test", "npm test");
run("build", "npm run build");

let hasExample = false;
try {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  hasExample = Boolean(pkg.scripts?.["example:basic"]);
} catch {
  hasExample = false;
}

if (hasExample) {
  run("example basic", "npm run example:basic");
} else {
  section("example basic");
  line("Skipped: package.json has no example:basic script.");
}

const changed = commandLines("git diff --name-only");
const untracked = commandLines("git ls-files --others --exclude-standard");
const files = Array.from(new Set([...changed, ...untracked])).sort();

section("changed and untracked files");

if (files.length === 0) {
  line("(none)");
} else {
  for (const file of files) {
    line(file);
  }
}

for (const file of files) {
  if (!includeFile(file)) continue;
  fileText(file, file);
}

writeFileSync(reportPath, `${lines.join("\n")}\n`, {
  encoding: "utf8"
});

console.log(`Report written to ${reportPath}`);