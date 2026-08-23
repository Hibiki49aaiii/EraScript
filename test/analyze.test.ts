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
