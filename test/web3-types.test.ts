import assert from "node:assert/strict";
import test from "node:test";
import { EraDiagnosticError } from "../src/diagnostics.js";
import {
  BNBChain,
  Ethereum,
  address,
  bytes32,
  leftPadBytes32,
  proof,
} from "../src/web3/types.js";

test("bytes32 accepts exactly 32 bytes", () => {
  const value = `0x${"ab".repeat(32)}`;
  assert.equal(bytes32(value), value);
});

test("bytes32 detects a likely missing leading zero", () => {
  const value = `0x${"1".repeat(63)}`;
  assert.throws(
    () => bytes32(value, "claim.proofs[0][7]"),
    (error: unknown) => {
      assert.ok(error instanceof EraDiagnosticError);
      assert.equal(error.diagnostic.code, "ES3201");
      assert.equal(error.diagnostic.path, "claim.proofs[0][7]");
      assert.equal(error.diagnostic.suggestion?.includes("leading zero"), true);
      return true;
    },
  );
});

test("leftPadBytes32 requires explicit repair intent", () => {
  const repaired = leftPadBytes32(`0x${"1".repeat(63)}`);
  assert.equal(repaired.length, 66);
  assert.equal(repaired.startsWith("0x0"), true);
});

test("addresses are validated and chain-branded", () => {
  const raw = "0x000000000000000000000000000000000000dead";
  const ethAddress = address(raw, Ethereum);
  const bnbAddress = address(raw, BNBChain);
  assert.equal(ethAddress, bnbAddress);

  assert.throws(
    () => address("0x123", Ethereum),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES3101",
  );
});

test("invalid mixed-case checksums become structured Era diagnostics", () => {
  assert.throws(
    () => address("0x000000000000000000000000000000000000dEaD", Ethereum),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES3102",
  );
});

test("proof validates every node", () => {
  const good = `0x${"22".repeat(32)}`;
  const bad = `0x${"3".repeat(63)}`;
  assert.equal(proof([good, good]).length, 2);

  assert.throws(
    () => proof([good, bad], "claim.proofs[2]"),
    (error: unknown) => {
      assert.ok(error instanceof EraDiagnosticError);
      assert.equal(error.diagnostic.path, "claim.proofs[2][1]");
      return true;
    },
  );
});
