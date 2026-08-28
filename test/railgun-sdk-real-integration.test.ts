import assert from "node:assert/strict";
import test from "node:test";
import {
  awaitWalletScan,
  getSerializedERC20Balances,
  refreshBalances,
  walletForID,
} from "@railgun-community/wallet";
import {
  createRailgunWalletSdkPrivateBalanceReader,
} from "../src/privacy/index.js";
import { Ethereum } from "../src/web3/index.js";

type SdkWallet = ReturnType<typeof walletForID>;
type SdkTxidVersion = Parameters<SdkWallet["getTokenBalancesByBucket"]>[0];
type SdkChain = Parameters<typeof refreshBalances>[0];

test("@railgun-community/wallet 10.9 public balance APIs plug directly into EraScript", () => {
  assert.equal(typeof refreshBalances, "function");
  assert.equal(typeof awaitWalletScan, "function");
  assert.equal(typeof walletForID, "function");
  assert.equal(typeof getSerializedERC20Balances, "function");

  const sdkChain = { type: 0, id: Ethereum.id } as SdkChain;
  const reader = createRailgunWalletSdkPrivateBalanceReader({
    sdk: {
      refreshBalances,
      awaitWalletScan,
      walletForID,
      getSerializedERC20Balances,
    },
    sdkChain,
    resolveTxidVersion: (value): SdkTxidVersion => value as SdkTxidVersion,
    balanceMode: "by-bucket",
  });

  assert.equal(reader.id, "railgun-wallet-sdk:0:1");
});
