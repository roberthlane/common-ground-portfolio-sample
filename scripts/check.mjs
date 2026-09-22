import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await fs.readFile(path.join(root, "export-manifest.json"), "utf8"),
);
const allowed = new Set(manifest.files.map((f) => f.path));
if (allowed.size !== manifest.files.length)
  throw Error("Duplicate manifest entry.");
for (const entry of manifest.files) {
  if (entry.path.startsWith("/") || entry.path.split("/").includes(".."))
    throw Error("Unsafe manifest path.");
  const p = path.join(root, entry.path),
    stat = await fs.lstat(p);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw Error("Only regular files may be released.");
  const data = await fs.readFile(p);
  if (
    data.length !== entry.bytes ||
    createHash("sha256").update(data).digest("hex") !== entry.sha256
  )
    throw Error("File differs from reviewed candidate: " + entry.path);
  if (/\.(js|mjs)$/.test(entry.path)) {
    const result = spawnSync(process.execPath, ["--check", p], {
      encoding: "utf8",
    });
    if (result.status !== 0) throw Error(result.stderr);
  }
}
async function walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name),
      relative = path.relative(root, p).split(path.sep).join("/");
    // Local runtime and Git metadata are never part of the release allowlist.
    if (dir === root && [".demo-data", ".git"].includes(entry.name)) continue;
    if (entry.isSymbolicLink()) throw Error("Symlinks are not allowed.");
    if (entry.isDirectory()) await walk(p);
    else if (relative !== "export-manifest.json" && !allowed.has(relative))
      throw Error("Unreviewed extra file: " + relative);
  }
}
await walk(root);
console.log(
  `Verified ${allowed.size} allowlisted files, checksums, and JavaScript syntax. Manifest excludes itself from recursive hashing.`,
);
