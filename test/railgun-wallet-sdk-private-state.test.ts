import assert from "node:assert/strict";
import test from "node:test";
import { EraDiagnosticError } from "../src/diagnostics.js";
import { Ethereum } from "../src/web3/index.js";
import {
  captureRailgunPrivateBalance,
  createRailgunWalletSdkPrivateBalanceReader,
  verifyRailgunPrivateBalanceChanges,
} from "../src/privacy/index.js";

const TOKEN = "0x0000000000000000000000000000000000001000";
const OTHER_TOKEN = "0x0000000000000000000000000000000000002000";
const PROOF_BINDING = `0x${"ab".repeat(32)}`;

type TokenBalances = readonly {
  tokenAddress: string;
  amount: bigint;
}[];

test("RAILGUN Wallet SDK reader subscribes before refresh and captures POI bucket balances", async () => {
  const calls: string[] = [];
  let amount = 100n;
  const wallet = {
    id: "wallet-1",
    async getTokenBalancesByBucket() {
      calls.push("by-bucket");
      return {
        Spendable: [
          { tokenAddress: TOKEN, amount },
          { tokenAddress: OTHER_TOKEN, amount: 7n },
        ],
      } satisfies Partial<Record<string, TokenBalances>>;
    },
    async getTokenBalances() {
      throw new Error("unexpected all-balance path");
    },
  };

  const sdk = {
    async refreshBalances(_chain: { id: number }, walletIds: string[] | undefined) {
      calls.push(`refresh:${walletIds?.join(",")}`);
    },
    async awaitWalletScan() {
      calls.push("subscribe");
      return "scanned";
    },
    walletForID() {
      calls.push("wallet");
      return wallet;
    },
    getSerializedERC20Balances(balances: TokenBalances) {
      calls.push("serialize");
      return balances;
    },
  };

  const reader = createRailgunWalletSdkPrivateBalanceReader({
    sdk,
    sdkChain: { type: 0, id: 1 },
    resolveTxidVersion: (value) => value,
  });

  const before = await captureRailgunPrivateBalance({
    reader,
    chain: Ethereum,
    walletId: "wallet-1",
    txidVersion: "V2_PoseidonMerkle",
    balanceBucket: "Spendable",
    observedAtMs: 1_000,
  });

  assert.deepEqual(calls.slice(0, 3), ["wallet", "subscribe", "refresh:wallet-1"]);
  assert.equal(before.balances.find((entry) => entry.token === TOKEN)?.amount, 100n);

  amount = 150n;
  const after = await captureRailgunPrivateBalance({
    reader,
    chain: Ethereum,
    walletId: "wallet-1",
    txidVersion: "V2_PoseidonMerkle",
    balanceBucket: "Spendable",
    observedAtMs: 2_000,
  });

  const evidence = verifyRailgunPrivateBalanceChanges({
    proofBindingHash: PROOF_BINDING,
    before,
    after,
    expectations: [{
      id: "received-private-token",
      token: TOKEN,
      minimumDelta: 50n,
      expectedFinalAmount: 150n,
      description: "Shielded token balance increased by the expected amount.",
    }],
  });
  assert.equal(evidence.assertions[0]?.passed, true);
  assert.match(evidence.source, /^railgun-wallet-sdk:/);
});

test("RAILGUN all-as-spendable mode mirrors non-POI SDK behavior and rejects fake bucket evidence", async () => {
  const sdk = {
    async refreshBalances() {},
    async awaitWalletScan() {},
    walletForID() {
      return {
        id: "wallet-1",
        async getTokenBalancesByBucket() {
          throw new Error("unexpected POI path");
        },
        async getTokenBalances(_version: string, _chain: { id: number }, onlySpendable: boolean) {
          assert.equal(onlySpendable, false);
          return [{ tokenAddress: TOKEN, amount: 42n }] as TokenBalances;
        },
      };
    },
    getSerializedERC20Balances(balances: TokenBalances) {
      return balances;
    },
  };

  const reader = createRailgunWalletSdkPrivateBalanceReader({
    sdk,
    sdkChain: { id: 1 },
    resolveTxidVersion: (value) => value,
    balanceMode: "all-as-spendable",
  });

  const snapshot = await captureRailgunPrivateBalance({
    reader,
    chain: Ethereum,
    walletId: "wallet-1",
    txidVersion: "V2_PoseidonMerkle",
    balanceBucket: "Spendable",
    refresh: false,
  });
  assert.equal(snapshot.balances[0]?.amount, 42n);

  await assert.rejects(
    () => captureRailgunPrivateBalance({
      reader,
      chain: Ethereum,
      walletId: "wallet-1",
      txidVersion: "V2_PoseidonMerkle",
      balanceBucket: "ShieldPending",
      refresh: false,
    }),
    (error: unknown) =>
      error instanceof EraDiagnosticError && error.diagnostic.code === "ES4734",
  );
});

test("RAILGUN Wallet SDK reader rejects chain and wallet identity mismatches", async () => {
  const reader = createRailgunWalletSdkPrivateBalanceReader({
    sdk: {
      async refreshBalances() {},
      async awaitWalletScan() {},
      walletForID() {
        return {
          id: "different-wallet",
          async getTokenBalancesByBucket() { return {}; },
          async getTokenBalances() { return [] as TokenBalances; },
        };
      },
      getSerializedERC20Balances() { return [] as TokenBalances; },
    },
    sdkChain: { id: 56 },
    resolveTxidVersion: (value) => value,
  });

  await assert.rejects(
    () => reader.read({
      chain: Ethereum,
      walletId: "wallet-1",
      txidVersion: "V2",
      balanceBucket: "Spendable",
    }),
    (error: unknown) =>
      error instanceof EraDiagnosticError && error.diagnostic.code === "ES4731",
  );
});
