import assert from "node:assert/strict";
import test from "node:test";
import { analyzeWeb3Literals } from "../src/web3/analyze.js";

test("static analyzer rejects malformed bytes32 literals before execution", () => {
  const source = `
const node = bytes32("0x${"1".repeat(63)}")
const recipient = address("0x123", Ethereum)
`;
  const diagnostics = analyzeWeb3Literals(source, "rescue.ts");
  assert.equal(diagnostics.some((diagnostic) => diagnostic.code === "ES3201"), true);
  assert.equal(diagnostics.some((diagnostic) => diagnostic.code === "ES3101"), true);
});

test("static analyzer points to the broken proof element", () => {
  const good = `0x${"ab".repeat(32)}`;
  const bad = `0x${"c".repeat(63)}`;
  const source = `const p = proof(["${good}", "${bad}"])`;
  const diagnostics = analyzeWeb3Literals(source, "claim.ts");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "ES3201");
  assert.equal(diagnostics[0]?.path, "proof[1]");
  assert.equal(diagnostics[0]?.suggestion?.includes("leading zero"), true);
});

test("secret diagnostics follow imported aliases, variable aliases, assignments and destructuring", () => {
  for (const source of [
    'const env = process.env; env.PRIVATE_KEY',
    'import { env as settings } from "node:process"; settings.MNEMONIC',
    'import p from "node:process"; const e = p["env"]; const k = "PRIVATE_" + "KEY"; e[k]',
    'const { env: e } = process; const { SEED_PHRASE: seed } = e',
    'let e; e = process.env; e.WALLET_KEY',
  ]) assert.ok(analyzeWeb3Literals(source).some((d) => d.code === "ES3820"), source);
});

test("hardcoded-key diagnostics follow viem aliases and never include the secret value", () => {
  const literal = `0x${"ab".repeat(32)}`;
  for (const source of [
    `import { privateKeyToAccount as account } from "viem/accounts"; const key = "${literal}"; account(key)`,
    `import * as accounts from "viem/accounts"; const factory = accounts.privateKeyToAccount; factory("${literal}")`,
  ]) {
    const diagnostics = analyzeWeb3Literals(source);
    assert.ok(diagnostics.some((d) => d.code === "ES3821"));
    assert.equal(JSON.stringify(diagnostics).includes(literal), false);
  }
});

test("secret aliases respect lexical shadowing and cycles terminate", () => {
  for (const source of [
    'function f(process: {env: {PRIVATE_KEY: string}}) { return process.env.PRIVATE_KEY }',
    'const env = process.env; function f(env: {PRIVATE_KEY: string}) { return env.PRIVATE_KEY }',
    'let a = b; let b = a; a.PRIVATE_KEY',
  ]) assert.equal(analyzeWeb3Literals(source).some((d) => d.code === "ES3820"), false, source);
});

test("expanding constant aliases stop with a diagnostic instead of unbounded work", () => {
  const lines = ['const k0 = "x"'];
  for (let i = 1; i <= 30; i++) lines.push(`const k${i} = k${i - 1} + k${i - 1}`);
  lines.push("privateKeyToAccount(k30)");
  assert.ok(analyzeWeb3Literals(lines.join(";\n")).some((d) => d.code === "ES4909"));
});
