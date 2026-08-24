import assert from "node:assert/strict";
import test from "node:test";
import { keccak256 } from "viem";
import { EraDiagnosticError } from "../src/diagnostics.js";
import {
  Ethereum,
  ERA_TRANSFER_WITNESS_TYPE_STRING,
  address,
  bytes32,
  defineToken,
  hash,
  permit2WitnessSpenderTrust,
  permit2WitnessTransfer,
  permit2WitnessTransferExecution,
  tokenAmountRaw,
  verifyPermit2WitnessSpenderFromRpc,
} from "../src/web3/index.js";

const BLOCK_HASH = `0x${"11".repeat(32)}` as `0x${string}`;
const CODE = "0x60006000" as const;

function fixture() {
  const owner = address("0x0000000000000000000000000000000000001000", Ethereum);
  const spender = address("0x0000000000000000000000000000000000002000", Ethereum);
  const recipient = address("0x0000000000000000000000000000000000003000", Ethereum);
  const otherRecipient = address("0x0000000000000000000000000000000000004000", Ethereum);
  const token = defineToken({
    symbol: "TEST",
    chain: Ethereum,
    address: address("0x0000000000000000000000000000000000005000", Ethereum),
    decimals: 18,
  });
  return { owner, spender, recipient, otherRecipient, token };
}

test("Permit2 witness spender is anchored to approved bytecode before signing", async () => {
  const { spender } = fixture();
  const expectedCodeHash = hash(keccak256(CODE), "keccak256");
  const trust = permit2WitnessSpenderTrust(Ethereum, spender, expectedCodeHash);
  const client = {
    chain: { id: 1, name: "Ethereum" },
    async getBlock() { return { number: 100n, hash: BLOCK_HASH }; },
    async getCode() { return CODE; },
  };
  const verified = await verifyPermit2WitnessSpenderFromRpc(client, trust);
  assert.equal(verified.kind, "permit2-witness-spender-verified");
  assert.equal(verified.observedCodeHash, expectedCodeHash);
  assert.equal(verified.blockNumber, 100n);

  const badClient = { ...client, async getCode() { return "0x6001" as const; } };
  await assert.rejects(
    () => verifyPermit2WitnessSpenderFromRpc(badClient, trust),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES3934",
  );
});

test("Permit2 witness transfer binds EraScript recipient and exact requested amount", async () => {
  const { owner, spender, recipient, otherRecipient, token } = fixture();
  const expectedCodeHash = hash(keccak256(CODE), "keccak256");
  const enforcement = await verifyPermit2WitnessSpenderFromRpc({
    chain: { id: 1, name: "Ethereum" },
    async getBlock() { return { number: 100n, hash: BLOCK_HASH }; },
    async getCode() { return CODE; },
  }, permit2WitnessSpenderTrust(Ethereum, spender, expectedCodeHash));

  const permitted = tokenAmountRaw(token, 1_000n);
  const requested = tokenAmountRaw(token, 600n);
  const authorization = permit2WitnessTransfer({
    owner,
    permitted,
    nonce: 42n,
    deadline: 1_900_000_000n,
    witness: {
      recipient,
      requestedAmount: requested,
      context: bytes32(`0x${"ab".repeat(32)}`),
    },
    enforcement,
  });

  assert.equal(authorization.spender, spender);
  assert.equal(authorization.typedData.primaryType, "PermitWitnessTransferFrom");
  assert.equal(authorization.witnessTypeString, ERA_TRANSFER_WITNESS_TYPE_STRING);
  assert.match(authorization.witnessHash, /^0x[0-9a-f]{64}$/i);

  const execution = permit2WitnessTransferExecution(authorization, recipient, requested);
  assert.equal(execution.recipient, recipient);
  assert.equal(execution.requestedAmount.raw, 600n);

  assert.throws(
    () => permit2WitnessTransferExecution(authorization, otherRecipient, requested),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES3935",
  );
  assert.throws(
    () => permit2WitnessTransferExecution(authorization, recipient, tokenAmountRaw(token, 599n)),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES3936",
  );
});
