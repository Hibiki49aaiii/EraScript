import assert from "node:assert/strict";
import test from "node:test";
import { EraDiagnosticError } from "../src/diagnostics.js";
import {
  SolanaMainnetProfile,
  SuiMainnetProfile,
  assertEvmCapability,
  assertJitoBundleFinalized,
  assertSolanaFinalized,
  assertSuiRealSimulation,
  captureSolanaRecentBlockhash,
  createJitoBundle,
  discoverEvmCapabilities,
  genericEvmProfile,
  jitoTip,
  lamports,
  prepareSolanaSerializedTransaction,
  prepareSuiTransaction,
  readJitoBundleStatus,
  readJitoTipAccounts,
  readSolanaSignatureStatus,
  simulateSolanaTransaction,
  simulateSuiPreparedTransaction,
  solanaBlockhash,
  solanaTransactionSignature,
  submitJitoBundle,
  submitSolanaTransaction,
  executeSuiTransaction,
  verifyJitoBundleTip,
  verifySolanaSerializedTransaction,
  verifySuiSerializedTransaction,
  waitForSuiCheckpoint,
} from "../src/chains/index.js";

const SOL_BLOCKHASH = "1".repeat(32);
const SOL_OTHER_BLOCKHASH = "2".repeat(32);
const SOL_SIGNATURE = "1".repeat(64);
const SUI_DIGEST = "1".repeat(32);
const SUI_ADDRESS = `0x${"00".repeat(32)}`;
const SUI_OTHER_ADDRESS = `0x${"11".repeat(32)}`;
const BASE64_TX = "AQ==";

test("generic EVM discovery only promotes capabilities proven by RPC evidence", async () => {
  const profile = genericEvmProfile({ id: "evm.test.777", name: "Test EVM", chainId: 777 });
  const client = {
    chain: { id: 777, name: "Test EVM" },
    async getBlock({ blockTag }: { blockTag: string }) {
      if (blockTag === "latest") return { number: 10n, hash: `0x${"11".repeat(32)}`, baseFeePerGas: 1n };
      return { number: 9n, hash: `0x${"22".repeat(32)}` };
    },
    async request() { throw new Error("method not found (-32601)"); },
  };
  const evidence = await discoverEvmCapabilities(client, profile);
  assert.equal(evidence.capabilities.eip1559, "supported");
  assert.equal(evidence.capabilities.finalizedTag, "supported");
  assert.equal(evidence.capabilities.debugTraceCall, "unsupported");
  assert.equal(evidence.capabilities.eip7702, "unknown");
  assert.doesNotThrow(() => assertEvmCapability(evidence, "eip1559"));
  assert.throws(() => assertEvmCapability(evidence, "eip7702"), (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4451");
});

test("Solana adapter requires serialized blockhash/version inspection before simulation", async () => {
  let blockHeight = 100n;
  const client = {
    rpc: {
      getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: SOL_BLOCKHASH, lastValidBlockHeight: 150n } }) }),
      getBlockHeight: () => ({ send: async () => blockHeight }),
      simulateTransaction: () => ({ send: async () => ({ value: { err: null, logs: ["ok"], unitsConsumed: 123n } }) }),
      sendTransaction: () => ({ send: async () => SOL_SIGNATURE }),
      getSignatureStatuses: () => ({ send: async () => ({ value: [{ slot: 200n, confirmations: null, confirmationStatus: "finalized", err: null }] }) }),
    },
  };
  const recent = await captureSolanaRecentBlockhash(client);
  const prepared = prepareSolanaSerializedTransaction({ profile: SolanaMainnetProfile, serializedBase64: BASE64_TX, recentBlockhash: recent });
  const verified = await verifySolanaSerializedTransaction(prepared, async () => ({ version: 0, recentBlockhash: solanaBlockhash(SOL_BLOCKHASH), signerCount: 1 }));
  const simulation = await simulateSolanaTransaction(client, verified);
  assert.equal(simulation.success, true);
  const submitted = await submitSolanaTransaction(client, simulation as typeof simulation & { success: true });
  assert.equal(submitted.signature, SOL_SIGNATURE);
  const status = await readSolanaSignatureStatus(client, solanaTransactionSignature(SOL_SIGNATURE));
  assert.equal(assertSolanaFinalized(status).confirmationStatus, "finalized");

  await assert.rejects(
    () => verifySolanaSerializedTransaction(prepared, async () => ({ version: 0, recentBlockhash: solanaBlockhash(SOL_OTHER_BLOCKHASH), signerCount: 1 })),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4468",
  );

  blockHeight = 151n;
  await assert.rejects(() => simulateSolanaTransaction(client, verified), (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4416");
});

test("Jito requires official tip-account evidence and an exact serialized tip transfer before sendBundle", async () => {
  const tip = jitoTip({ account: SOL_BLOCKHASH, lamports: lamports(1_000n), transactionIndex: 0 });
  const draft = createJitoBundle({ profile: SolanaMainnetProfile, transactionsBase64: [BASE64_TX], expectedSignatures: [SOL_SIGNATURE], tip });
  const relay = {
    async request<Result>(method: string): Promise<Result> {
      if (method === "getTipAccounts") return [SOL_BLOCKHASH] as Result;
      if (method === "sendBundle") return "bundle-1" as Result;
      if (method === "getBundleStatuses") return { value: [{ bundle_id: "bundle-1", slot: 250n, confirmationStatus: "finalized", transactions: [SOL_SIGNATURE], err: null }] } as Result;
      throw new Error(method);
    },
  };
  const accounts = await readJitoTipAccounts(relay);
  const verified = await verifyJitoBundleTip(draft, accounts, async () => ({
    tipTransfers: [{ recipient: SOL_BLOCKHASH, lamports: 1_000n, via: "top-level" }],
    tipAccountResolvedViaAddressLookupTable: false,
  }));
  const submitted = await submitJitoBundle(relay, verified);
  assert.equal(submitted.state, "jito-bundle-submitted");
  const status = await readJitoBundleStatus(relay, submitted);
  assert.equal(assertJitoBundleFinalized(status).confirmationStatus, "finalized");

  await assert.rejects(
    () => verifyJitoBundleTip(draft, accounts, async () => ({ tipTransfers: [{ recipient: SOL_BLOCKHASH, lamports: 2_000n }] })),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4486",
  );
  await assert.rejects(
    () => verifyJitoBundleTip(draft, accounts, async () => ({ tipTransfers: [{ recipient: SOL_BLOCKHASH, lamports: 1_000n }], tipAccountResolvedViaAddressLookupTable: true })),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4484",
  );
});

test("Sui v2 adapter requires sender/gas-owner inspection and distinguishes failed execution", async () => {
  const prepared = prepareSuiTransaction({ profile: SuiMainnetProfile, sender: SUI_ADDRESS, serializedBase64: BASE64_TX });
  const verified = await verifySuiSerializedTransaction(prepared, async () => ({ sender: SUI_ADDRESS, gasOwner: SUI_ADDRESS, gasBudget: 1_000n, gasPrice: 1n, commandCount: 1 }));
  const client = {
    network: "mainnet",
    async simulateTransaction() { return { Transaction: { digest: SUI_DIGEST, status: { success: true }, balanceChanges: [], commandResults: [] } }; },
    async executeTransaction() { return { Transaction: { digest: SUI_DIGEST, status: { success: true }, checkpoint: 77n } }; },
    async waitForTransaction() { return { Transaction: { digest: SUI_DIGEST, status: { success: true }, checkpoint: 77n } }; },
  };
  const simulation = await simulateSuiPreparedTransaction(client, verified);
  assert.equal(assertSuiRealSimulation(simulation).success, true);
  const executed = await executeSuiTransaction(client, simulation, ["signature"]);
  assert.equal(executed.state, "sui-executed");
  if (executed.state !== "sui-executed") throw new Error("expected Sui execution success");
  const checkpoint = await waitForSuiCheckpoint(client, executed);
  assert.equal(checkpoint.checkpoint, 77n);

  await assert.rejects(
    () => verifySuiSerializedTransaction(prepared, async () => ({ sender: SUI_ADDRESS, gasOwner: SUI_OTHER_ADDRESS })),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4502",
  );

  const failedClient = { ...client, async executeTransaction() { return { FailedTransaction: { digest: SUI_DIGEST, status: { success: false, error: "MoveAbort" } } }; } };
  const failed = await executeSuiTransaction(failedClient, simulation, ["signature"]);
  assert.equal(failed.state, "sui-execution-failed");
});
