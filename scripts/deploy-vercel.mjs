import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectId = "prj_PJg7An8MF91H8fBQ3ADsCXRkyfOm";
const teamId = "team_h2CRAmMCMPNtb3aqnGBNuDVP";
const rootFiles = new Set(["package.json", "package-lock.json", "next.config.ts", "next.config.js", "next.config.mjs", "tsconfig.json", "next-env.d.ts", "postcss.config.js", "postcss.config.mjs", "vercel.json"]);
const requiredFiles = ["package.json", "package-lock.json", "tsconfig.json", "vercel.json", "src/app/page.tsx", "src/app/layout.tsx"];
const excluded = /(?:^|\/)(?:\.env[^/]*|\.local|\.git|\.vercel|\.next|\.workflow-data|node_modules|artifacts|logs|tests|scripts|db)(?:\/|$)/i;
const sourceFile = /^src\/[^\r\n\0]+\.(?:ts|tsx|js|jsx|mjs|cjs|css|json)$/i;
const assetFile = /^public\/[^\r\n\0]+\.(?:svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf)$/i;
const binaryFile = /\.(?:png|jpe?g|gif|webp|avif|ico|woff2?|ttf)$/i;

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
function allowed(path) {
  return !isAbsolute(path) && !path.split("/").some(part => !part || part === "." || part === ".." || part.startsWith(".")) &&
    !excluded.test(path) && (rootFiles.has(path) || sourceFile.test(path) || assetFile.test(path));
}

async function buildManifest() {
  if (process.argv.length !== 2) throw new Error("This command only prepares a source manifest; it accepts no deployment arguments.");
  let tracked;
  try {
    const gitRoot = resolve(git(["rev-parse", "--show-toplevel"]).trim());
    if (gitRoot !== root) throw new Error("The project must have its own Git repository.");
    tracked = git(["ls-files", "-z"]).split("\0").filter(Boolean);
  } catch {
    throw new Error("Initialize this project's Git repository and stage the reviewed source files before preparing deployment.");
  }
  const paths = tracked.filter(allowed).sort();
  const missing = requiredFiles.filter(path => !paths.includes(path));
  if (missing.length) throw new Error(`Required source files are not Git tracked: ${missing.join(", ")}`);
  const secretValues = [];
  try {
    const envText = await readFile(join(root, ".env.local"), "utf8");
    for (const line of envText.split(/\r?\n/)) {
      const match = /^(SUPABASE_SERVICE_ROLE_KEY|ACCOUNT_ENCRYPTION_KEY)=(.*)$/.exec(line);
      if (match && match[2].length >= 12) secretValues.push(match[2].replace(/^(["'])(.*)\1$/, "$2"));
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error("Unable to read local configuration for the secret exclusion check.");
  }
  const files = [];
  let totalBytes = 0;
  const fingerprint = createHash("sha256");
  for (const file of paths) {
    const path = join(root, ...file.split("/"));
    const stat = await lstat(path);
    const resolved = await realpath(path);
    const relativePath = relative(root, resolved);
    if (!stat.isFile() || stat.isSymbolicLink() || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) throw new Error(`Unsafe source path: ${file}`);
    const bytes = await readFile(path);
    if (bytes.length > 5_000_000) throw new Error(`Source file is too large: ${file}`);
    const content = bytes.toString("utf8");
    if (secretValues.some(secret => content.includes(secret)) || /sb_secret_[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/.test(content)) {
      throw new Error(`Possible private credential in source file: ${file}`);
    }
    files.push({ file, data: binaryFile.test(file) ? bytes.toString("base64") : content, encoding: binaryFile.test(file) ? "base64" : "utf-8" });
    totalBytes += bytes.length;
    fingerprint.update(file).update("\0").update(bytes).update("\0");
  }
  let commit = null;
  try { commit = git(["rev-parse", "--verify", "HEAD"]).trim(); } catch { /* An initial staged repository may not yet have a commit. */ }
  const dirty = Boolean(git(["status", "--porcelain", "--untracked-files=no"]).trim());
  const output = join(root, ".local", "artifacts", "vercel-source-manifest.json");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ schemaVersion: 1, teamId, projectId, target: "production", commit, dirty, sourceSha256: fingerprint.digest("hex"), files }), { encoding: "utf8", mode: 0o600 });
  console.log(JSON.stringify({ prepared: true, deployed: false, teamId, projectId, commit, dirty, files: files.length, bytes: totalBytes, manifest: ".local/artifacts/vercel-source-manifest.json" }));
}

try { await buildManifest(); }
catch (error) { console.error(JSON.stringify({ prepared: false, error: error instanceof Error ? error.message : "Manifest preparation failed." })); process.exitCode = 1; }
