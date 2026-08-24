import assert from "node:assert/strict";
import test from "node:test";
import {
  Ethereum,
  address,
  captureBalanceSnapshotFromRpc,
  defineToken,
} from "../src/web3/index.js";

const account = address("0x0000000000000000000000000000000000000011", Ethereum);
const token = defineToken({
  symbol: "TEST",
  chain: Ethereum,
  address: address("0x0000000000000000000000000000000000000022", Ethereum),
  decimals: 18,
});

test("RPC snapshot uses one concrete block for native and token balances", async () => {
  const calls: bigint[] = [];
  const client = {
    chain: { id: 1, name: "Ethereum" },
    async getBlock() {
      return { number: 123n, hash: `0x${"aa".repeat(32)}` as `0x${string}` };
    },
    async getBalance(input: { blockNumber: bigint }) {
      calls.push(input.blockNumber);
      return 5n;
    },
    async readContract(input: { blockNumber: bigint }) {
      calls.push(input.blockNumber);
      return 10n;
    },
  };

  const snapshot = await captureBalanceSnapshotFromRpc(client, {
    chain: Ethereum,
    accounts: [account],
    tokens: [token],
  });

  assert.equal(snapshot.blockNumber, 123n);
  assert.equal(snapshot.native[0]?.balance, 5n);
  assert.equal(snapshot.tokens[0]?.balance.raw, 10n);
  assert.deepEqual(calls, [123n, 123n]);
});
