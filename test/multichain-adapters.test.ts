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
  readSolanaSignatureStatus,
  simulateSolanaTransaction,
  simulateSuiPreparedTransaction,
  solanaTransactionSignature,
  submitJitoBundle,
  submitSolanaTransaction,
  executeSuiTransaction,
  waitForSuiCheckpoint,
} from "../src/chains/index.js";

const SOL_BLOCKHASH = "1".repeat(32);
const SOL_SIGNATURE = "1".repeat(64);
const SUI_DIGEST = "1".repeat(32);
const SUI_ADDRESS = `0x${"00".repeat(32)}`;
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

test("Solana adapter binds recent blockhash, simulation, submission, and finality", async () => {
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
  const simulation = await simulateSolanaTransaction(client, prepared);
  assert.equal(simulation.success, true);
  const submitted = await submitSolanaTransaction(client, simulation as typeof simulation & { success: true });
  assert.equal(submitted.signature, SOL_SIGNATURE);
  const status = await readSolanaSignatureStatus(client, solanaTransactionSignature(SOL_SIGNATURE));
  assert.equal(assertSolanaFinalized(status).confirmationStatus, "finalized");

  blockHeight = 151n;
  await assert.rejects(() => simulateSolanaTransaction(client, prepared), (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4416");
});

test("Jito bundle submission is not success until finalized bundle status matches", async () => {
  const tip = jitoTip({ account: SOL_BLOCKHASH, lamports: lamports(1_000n), transactionIndex: 0 });
  const draft = createJitoBundle({ profile: SolanaMainnetProfile, transactionsBase64: [BASE64_TX], expectedSignatures: [SOL_SIGNATURE], tip });
  const relay = {
    async request<Result>(method: string): Promise<Result> {
      if (method === "sendBundle") return "bundle-1" as Result;
      if (method === "getBundleStatuses") return { value: [{ bundle_id: "bundle-1", slot: 250n, confirmationStatus: "finalized", transactions: [SOL_SIGNATURE], err: null }] } as Result;
      throw new Error(method);
    },
  };
  const submitted = await submitJitoBundle(relay, draft);
  assert.equal(submitted.state, "jito-bundle-submitted");
  const status = await readJitoBundleStatus(relay, submitted);
  assert.equal(assertJitoBundleFinalized(status).confirmationStatus, "finalized");
});

test("Sui v2 adapter distinguishes simulation/execution success from FailedTransaction and waits for checkpoint", async () => {
  const prepared = prepareSuiTransaction({ profile: SuiMainnetProfile, sender: SUI_ADDRESS, serializedBase64: BASE64_TX });
  const client = {
    network: "mainnet",
    async simulateTransaction() { return { Transaction: { digest: SUI_DIGEST, status: { success: true }, balanceChanges: [], commandResults: [] } }; },
    async executeTransaction() { return { Transaction: { digest: SUI_DIGEST, status: { success: true }, checkpoint: 77n } }; },
    async waitForTransaction() { return { Transaction: { digest: SUI_DIGEST, status: { success: true }, checkpoint: 77n } }; },
  };
  const simulation = await simulateSuiPreparedTransaction(client, prepared);
  assert.equal(assertSuiRealSimulation(simulation).success, true);
  const executed = await executeSuiTransaction(client, simulation, ["signature"]);
  assert.equal(executed.state, "sui-executed");
  if (executed.state !== "sui-executed") throw new Error("expected Sui execution success");
  const checkpoint = await waitForSuiCheckpoint(client, executed);
  assert.equal(checkpoint.checkpoint, 77n);

  const failedClient = { ...client, async executeTransaction() { return { FailedTransaction: { digest: SUI_DIGEST, status: { success: false, error: "MoveAbort" } } }; } };
  const failed = await executeSuiTransaction(failedClient, simulation, ["signature"]);
  assert.equal(failed.state, "sui-execution-failed");
});
