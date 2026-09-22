import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let checked = 0;
async function checkDirectory(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await checkDirectory(file);
    else if (entry.isFile() && /\.(js|mjs)$/.test(file)) {
      const result = spawnSync(process.execPath, ["--check", file], {
        encoding: "utf8",
      });
      if (result.status !== 0) throw Error(result.stderr);
      checked++;
    }
  }
}
for (const folder of ["demo", "src", "public", "scripts", "test"]) {
  await checkDirectory(path.join(root, folder));
}
console.log(`JavaScript syntax checked in ${checked} files.`);
