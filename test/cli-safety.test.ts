import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildEraProject } from "../src/project-build.js";
import { verificationReportHash } from "../src/web3/verification.js";
import { Ethereum } from "../src/web3/types.js";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
function run(args: string[], cwd: string) { return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", timeout: 30_000, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } }); }
function temp(t: test.TestContext): string { const root = mkdtempSync(join(tmpdir(), "era-safety-")); t.after(() => rmSync(root, { recursive: true, force: true })); return root; }

test("init refuses existing config or source without modifying either", (t) => {
  const root = temp(t);
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/main.era"), "user-owned-content");
  assert.equal(run(["init"], root).status, 2);
  assert.equal(readFileSync(join(root, "src/main.era"), "utf8"), "user-owned-content");
  assert.equal(existsSync(join(root, "era.json")), false);
  writeFileSync(join(root, "era.json"), "user-config");
  assert.equal(run(["init"], root).status, 2);
  assert.equal(readFileSync(join(root, "era.json"), "utf8"), "user-config");
});

test("init creates a runnable project and refuses linked source directories", (t) => {
  const root = temp(t);
  const fresh = join(root, "new");
  assert.equal(run(["init", fresh], root).status, 0);
  const output = run(["run"], fresh);
  assert.equal(output.status, 0, output.stderr);
  assert.match(output.stdout, /Hello, EraScript/);
  const linked = join(root, "linked");
  mkdirSync(linked);
  symlinkSync(join(fresh, "src"), join(linked, "src"), process.platform === "win32" ? "junction" : "dir");
  assert.equal(run(["init", linked], root).status, 2);
  assert.equal(existsSync(join(linked, "era.json")), false);
});

test("verification CLI rejects typos, contradictory flags, unreadable and malformed files with JSON", (t) => {
  const root = temp(t);
  writeFileSync(join(root, "invalid.json"), "{ confidential invalid input");
  // A valid, nonterminal fixture reaches argument validation after parsing.
  const checks: [] = [];
  writeFileSync(join(root, "valid.json"), JSON.stringify({ kind: "rescue-verification-report", chain: Ethereum, state: "NOT_READY", checks, reportHash: verificationReportHash(Ethereum, "NOT_READY", checks), readyForBroadcast: false, recoveryObserved: false, verifiedRecovery: false }));
  const cases = [
    ["verify", "invalid.json", "--requier", "VERIFIED_FINALITY", "--json"],
    ["verify", "invalid.json", "--integrity-only", "--require", "VERIFIED_FINALITY", "--json"],
    ["verify", "invalid.json", "--require", "--json"],
    ["verify", "invalid.json", "--json"],
    ["verify", "missing.json", "--json"],
    ["verify", "--json"],
    ["verify", "invalid.json", "--attestation", "missing.json", "--json"],
    ["verify", "valid.json", "--require", "TYPO", "--json"],
  ];
  for (const args of cases) {
    const result = run(args, root);
    assert.equal(result.status, 2, `${args}: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, false);
    assert.equal(result.stdout.includes("confidential invalid input"), false);
    assert.doesNotMatch(result.stderr, /\bat .*\.js:/);
  }
});

test("project build rejects root escape, source/output collision, and output symlinks before writing", (t) => {
  const root = temp(t);
  const entry = join(root, "main.era");
  writeFileSync(entry, "console.log(1)");
  const project = { root, configFile: join(root, "era.json"), entry, outDir: join(root, "dist") };
  for (const outDir of [root, join(root, ".."), join(root, ".git")]) {
    assert.throws(() => buildEraProject({ ...project, outDir }), /outDir|escapes/);
  }
  const outside = join(root, "outside");
  mkdirSync(outside);
  symlinkSync(outside, project.outDir, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => buildEraProject(project), /linked/);
  assert.equal(existsSync(join(outside, "main.mjs")), false);

  writeFileSync(entry, 'import "./main.mjs"; console.log(1)');
  writeFileSync(join(root, "main.mjs"), "user-asset");
  assert.throws(() => buildEraProject({ ...project, outDir: join(root, "build") }), /collide/);
  assert.equal(existsSync(join(root, "build")), false);
  assert.equal(readFileSync(join(root, "main.mjs"), "utf8"), "user-asset");
});
