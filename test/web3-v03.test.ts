import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import { assertEventArgs, decodeEventStrict, expectEventName } from "../src/web3/events.js";
import { nonce, type Nonce } from "../src/web3/nonce.js";
import {
  draftTransaction,
  markBroadcast,
  markConfirmed,
  markFinalized,
  markIncluded,
  markPending,
  prepareTransaction,
  recordSimulation,
  signSimulated,
} from "../src/web3/tx.js";
import { typedDataDigest, typedDataEnvelope } from "../src/web3/typed-data.js";
import { address, BNBChain, Ethereum } from "../src/web3/types.js";
import {
  ether,
  gas,
  gwei,
  maxFeePerGas,
  maxPriorityFeePerGas,
  toWei,
  unwrapGas,
  unwrapWei,
  wei,
  weiPerGas,
} from "../src/web3/values.js";

const HASH_A = `0x${"11".repeat(32)}`;
const HASH_B = `0x${"22".repeat(32)}`;

test("exact Web3 value units reject float-like integer inputs", () => {
  assert.equal(unwrapWei(ether("1.5")), 1_500_000_000_000_000_000n);
  assert.equal(unwrapWei(gwei("2.5")), 2_500_000_000n);
  assert.equal(unwrapWei(toWei(ether("1"))), 1_000_000_000_000_000_000n);
  assert.equal(unwrapGas(gas(21_000)), 21_000n);
  assert.equal(unwrapWei(wei("42")), 42n);
  assert.throws(() => wei("-1"));
  assert.throws(() => gas(21_000.5));
});

test("transaction lifecycle does not treat broadcast as success", () => {
  const safe = address("0x000000000000000000000000000000000000dead", Ethereum);
  const draft = draftTransaction({ chain: Ethereum, to: safe, value: toWei(ether("0.1")) });
  const prepared = prepareTransaction(draft, {
    nonce: nonce(Ethereum, 7, "pending", 100n),
    gas: gas(21_000),
    fees: {
      type: "eip1559",
      maxFeePerGas: maxFeePerGas(toWei(gwei("50"))),
      maxPriorityFeePerGas: maxPriorityFeePerGas(toWei(gwei("2"))),
    },
  });
  const simulated = recordSimulation(prepared, { status: "success", stateOverrides: false, blockNumber: 100n });
  const signed = signSimulated(simulated, "0x02aa" as Hex);
  const broadcast = markBroadcast(signed, HASH_A, 1_000);
  assert.equal(broadcast.state, "broadcast");
  const included = markIncluded(markPending(broadcast, 1_100), {
    transactionHash: HASH_A,
    blockHash: HASH_B,
    blockNumber: 101n,
    status: "success",
    gasUsed: 21_000n,
  });
  assert.equal(markFinalized(markConfirmed(included, 2)).state, "finalized");
});

test("failed simulation is a terminal non-signable state", () => {
  const prepared = prepareTransaction(draftTransaction({ chain: Ethereum }), {
    nonce: nonce(Ethereum, 0, "pending"),
    gas: gas(21_000),
    fees: { type: "eip1559", maxFeePerGas: maxFeePerGas(10n), maxPriorityFeePerGas: maxPriorityFeePerGas(1n) },
  });
  assert.equal(recordSimulation(prepared, {
    status: "failure",
    stateOverrides: false,
    error: "execution reverted",
  }).state, "simulation-failed");
});

test("runtime chain mismatch is rejected", () => {
  const wrongNonce = nonce(BNBChain, 0, "pending") as unknown as Nonce<typeof Ethereum>;
  assert.throws(() => prepareTransaction(draftTransaction({ chain: Ethereum }), {
    nonce: wrongNonce,
    gas: gas(21_000),
    fees: { type: "legacy", gasPrice: weiPerGas(1n) },
  }));
});

const typedDataTypes = {
  Transfer: [
    { name: "to", type: "address" },
    { name: "amount", type: "uint256" },
  ],
};

test("EIP-712 envelope is chain-bound", () => {
  const envelope = typedDataEnvelope({
    chain: Ethereum,
    domain: {
      name: "EraScript",
      version: "1",
      chainId: 1,
      verifyingContract: "0x000000000000000000000000000000000000dead",
    },
    types: typedDataTypes,
    primaryType: "Transfer",
    message: { to: "0x000000000000000000000000000000000000beef", amount: 1n },
  });
  assert.match(typedDataDigest(envelope), /^0x[0-9a-fA-F]{64}$/);
  assert.throws(() => typedDataEnvelope({
    chain: Ethereum,
    domain: { name: "EraScript", version: "1", chainId: 56 },
    types: typedDataTypes,
    primaryType: "Transfer",
    message: { to: "0x000000000000000000000000000000000000beef", amount: 1n },
  }));
});

const transferAbi = [{
  type: "event",
  name: "Transfer",
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false },
  ],
}] as const;

test("strict event decoding can enforce receipt invariants", () => {
  const token = address("0x0000000000000000000000000000000000001000", Ethereum);
  const from = address("0x0000000000000000000000000000000000002000", Ethereum);
  const to = address("0x0000000000000000000000000000000000003000", Ethereum);
  const topics = encodeEventTopics({ abi: transferAbi, eventName: "Transfer", args: { from, to } });
  const data = encodeAbiParameters([{ type: "uint256" }], [123n]);
  const event = decodeEventStrict(Ethereum, transferAbi, { address: token, topics: topics as readonly Hex[], data });
  expectEventName(event, "Transfer");
  assertEventArgs(event, { from, to, value: 123n });
  assert.equal(event.eventName, "Transfer");
});
