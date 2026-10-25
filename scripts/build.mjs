import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, "dist");
// Only generated directories inside this checkout can be removed. Linked build
// roots are rejected so a cleanup never follows an external directory junction.
if (existsSync(output) && lstatSync(output).isSymbolicLink()) throw new Error("Refusing linked dist directory");
for (const name of ["src", ...(process.argv.includes("--package") ? [] : ["test"])]) {
  const target = join(output, name);
  if (relative(root, target) !== join("dist", name)) throw new Error("Invalid build output path");
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new Error("Refusing linked generated directory");
  rmSync(target, { recursive: true, force: true });
}
const result = spawnSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", process.argv.includes("--package") ? "tsconfig.build.json" : "tsconfig.json"], { cwd: root, stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
