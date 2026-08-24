import assert from "node:assert/strict";
import test from "node:test";
import {
  Ethereum,
  address,
  assertAbiMerkleProof,
  bytes32,
  defineAbiMerkleScheme,
  defineToken,
  erc2612Permit,
  formatTokenAmount,
  hashMerklePair,
  merkleRoot,
  permit2Allowance,
  permit2SignatureTransfer,
  permit2TransferExecution,
  tokenAmount,
  tokenAmountRaw,
  typedDataDigest,
} from "../src/web3/index.js";
import { EraDiagnosticError } from "../src/diagnostics.js";

const owner = address("0x0000000000000000000000000000000000000001", Ethereum);
const spender = address("0x0000000000000000000000000000000000000002", Ethereum);
const recipient = address("0x0000000000000000000000000000000000000003", Ethereum);
const usdc = defineToken({
  symbol: "USDC",
  chain: Ethereum,
  address: address("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", Ethereum),
  decimals: 6,
});

test("TokenAmount preserves exact token identity and decimals", () => {
  const amount = tokenAmount(usdc, "100.500001");
  assert.equal(amount.raw, 100_500_001n);
  assert.equal(formatTokenAmount(amount), "100.500001");
});

test("Merkle scheme verifies declared ABI leaf semantics", () => {
  const scheme = defineAbiMerkleScheme({
    name: "claim-v1",
    parameters: [
      { name: "account", type: "address" },
      { name: "amount", type: "uint256" },
    ],
  });
  const leftValues = [owner, 100n] as const;
  const rightValues = [recipient, 200n] as const;

  // First obtain leaves using a one-leaf temporary verification path.
  const emptyRootLeft = (() => {
    try {
      return assertAbiMerkleProof({ scheme, values: leftValues, proof: [], root: merkleRoot(bytes32(`0x${"00".repeat(32)}`)) });
    } catch (error) {
      if (!(error instanceof EraDiagnosticError) || error.diagnostic.code !== "ES3913") throw error;
      return error.diagnostic.details as { computedRoot: string };
    }
  })();
  const left = bytes32("computedRoot" in emptyRootLeft ? emptyRootLeft.computedRoot : emptyRootLeft.computedRoot);

  const emptyRootRight = (() => {
    try {
      return assertAbiMerkleProof({ scheme, values: rightValues, proof: [], root: merkleRoot(bytes32(`0x${"00".repeat(32)}`)) });
    } catch (error) {
      if (!(error instanceof EraDiagnosticError) || error.diagnostic.code !== "ES3913") throw error;
      return error.diagnostic.details as { computedRoot: string };
    }
  })();
  const right = bytes32("computedRoot" in emptyRootRight ? emptyRootRight.computedRoot : emptyRootRight.computedRoot);

  const root = merkleRoot(hashMerklePair(left, right));
  const verified = assertAbiMerkleProof({ scheme, values: leftValues, proof: [right], root });
  assert.equal(verified.valid, true);
  assert.equal(verified.computedRoot, root);
});

test("64-byte non-double-hashed Merkle leaf preimage is rejected by default", () => {
  const scheme = defineAbiMerkleScheme({
    name: "unsafe-legacy-tree",
    parameters: [{ type: "bytes32" }, { type: "bytes32" }],
    doubleHashLeaf: false,
  });
  assert.throws(
    () => assertAbiMerkleProof({
      scheme,
      values: [bytes32(`0x${"11".repeat(32)}`), bytes32(`0x${"22".repeat(32)}`)],
      proof: [],
      root: merkleRoot(bytes32(`0x${"00".repeat(32)}`)),
    }),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES3912",
  );
});

test("ERC-2612 permit produces a chain-bound typed-data digest", () => {
  const authorization = erc2612Permit({
    token: usdc,
    tokenName: "USD Coin",
    tokenVersion: "2",
    owner,
    spender,
    amount: tokenAmount(usdc, "50"),
    nonce: 1n,
    deadline: 2_000_000_000n,
  });
  assert.equal(authorization.typedData.primaryType, "Permit");
  assert.match(typedDataDigest(authorization.typedData), /^0x[0-9a-f]{64}$/i);
});

test("Permit2 rejects accidental unlimited allowance", () => {
  const maxUint160 = (1n << 160n) - 1n;
  assert.throws(
    () => permit2Allowance({
      owner,
      spender,
      amount: tokenAmountRaw(usdc, maxUint160),
      expiration: 2_000_000_000n,
      nonce: 0n,
      sigDeadline: 2_000_000_000n,
    }),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES3922",
  );
});

test("Permit2 SignatureTransfer makes spender-controlled recipient semantics explicit", () => {
  const authorization = permit2SignatureTransfer({
    owner,
    spender,
    permitted: tokenAmount(usdc, "25"),
    nonce: 123n,
    deadline: 2_000_000_000n,
    recipientBinding: "spender-controlled",
  });
  assert.equal(authorization.recipientBinding, "spender-controlled");
  assert.equal(authorization.typedData.message.spender, spender);

  const execution = permit2TransferExecution(authorization, recipient, tokenAmount(usdc, "10"));
  assert.equal(execution.recipient, recipient);
  assert.equal(execution.requestedAmount.raw, 10_000_000n);
});
