import assert from "node:assert/strict";
import test from "node:test";
import {
  Ethereum,
  address,
  analyzeWeb3Literals,
  broadcastSignedWithRpc,
  confirmIncludedFromRpc,
  draftTransaction,
  ether,
  finalizeConfirmedFromRpc,
  privateKeyEnv,
  prepareDraftWithRpc,
  signerCapability,
  signSimulatedWithCapability,
  simulatePreparedWithRpc,
  toWei,
  waitForInclusionFromRpc,
} from "../src/web3/index.js";

const DEV_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TX_HASH = `0x${"11".repeat(32)}` as `0x${string}`;
const BLOCK_HASH = `0x${"22".repeat(32)}` as `0x${string}`;
const SIM_BLOCK_HASH = `0x${"33".repeat(32)}` as `0x${string}`;
const REPLACEMENT_HASH = `0x${"44".repeat(32)}` as `0x${string}`;

function mockClient() {
  const receipt = {
    transactionHash: TX_HASH,
    blockHash: BLOCK_HASH,
    blockNumber: 102n,
    status: "success" as const,
    gasUsed: 21000n,
    effectiveGasPrice: 2_000_000_000n,
  };
  return {
    chain: { id: 1, name: "Ethereum" },
    async getTransactionCount() { return 7; },
    async estimateGas() { return 21000n; },
    async estimateFeesPerGas() { return { maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n }; },
    async call() { return { data: "0x" as const }; },
    async sendRawTransaction() { return TX_HASH; },
    async getTransactionReceipt() { return receipt; },
    async getTransactionConfirmations() { return 3n; },
    async waitForTransactionReceipt() { return receipt; },
    async getBlock(args: { blockTag?: string; blockNumber?: bigint }) {
      if (args.blockNumber === 102n) return { number: 102n, hash: BLOCK_HASH };
      if (args.blockTag === "finalized") return { number: 110n, hash: `0x${"55".repeat(32)}` as `0x${string}` };
      if (args.blockTag === "latest") return { number: 101n, hash: SIM_BLOCK_HASH };
      return { number: 100n, hash: `0x${"66".repeat(32)}` as `0x${string}` };
    },
  };
}

test("RPC evidence flows from draft through finalized", async () => {
  const from = address("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", Ethereum);
  const to = address("0x000000000000000000000000000000000000dead", Ethereum);
  const draft = draftTransaction({ chain: Ethereum, from, to, value: toWei(ether("0.001")) });
  const client = mockClient();

  const prepared = await prepareDraftWithRpc(client, draft);
  assert.equal(prepared.state, "prepared");
  assert.equal(prepared.nonce.source, "pending");

  const simulated = await simulatePreparedWithRpc(client, prepared, { provider: "mock" });
  assert.equal(simulated.state, "simulated");
  if (simulated.state !== "simulated") assert.fail("simulation unexpectedly failed");
  assert.equal(simulated.simulation.blockNumber, 101n);

  const previous = process.env.ERA_TEST_PRIVATE_KEY;
  process.env.ERA_TEST_PRIVATE_KEY = DEV_KEY;
  try {
    const capability = signerCapability(
      privateKeyEnv("ERA_TEST_PRIVATE_KEY", Ethereum, from),
      {
        chain: Ethereum,
        allowedDestinations: [to],
        allowNativeTransfer: true,
        maxValue: toWei(ether("0.01")),
      },
    );
    const signed = await signSimulatedWithCapability(capability, simulated);
    assert.equal(signed.state, "signed");
    assert.match(signed.rawTransaction, /^0x[0-9a-f]+$/i);

    const broadcast = await broadcastSignedWithRpc(client, signed);
    assert.equal(broadcast.state, "broadcast");
    assert.equal(broadcast.hash, TX_HASH);

    const inclusion = await waitForInclusionFromRpc(client, broadcast);
    assert.equal(inclusion.kind, "included");
    if (inclusion.kind !== "included") assert.fail("unexpected replacement");
    assert.equal(inclusion.transaction.receipt.status, "success");

    const confirmed = await confirmIncludedFromRpc(client, inclusion.transaction, 3);
    assert.equal(confirmed.state, "confirmed");
    const finalized = await finalizeConfirmedFromRpc(client, confirmed);
    assert.equal(finalized.state, "finalized");
  } finally {
    if (previous === undefined) delete process.env.ERA_TEST_PRIVATE_KEY;
    else process.env.ERA_TEST_PRIVATE_KEY = previous;
  }
});

test("RPC adapter records transaction replacement", async () => {
  const from = address("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", Ethereum);
  const to = address("0x000000000000000000000000000000000000dead", Ethereum);
  const draft = draftTransaction({ chain: Ethereum, from, to });
  const base = mockClient();
  const prepared = await prepareDraftWithRpc(base, draft);
  const simulated = await simulatePreparedWithRpc(base, prepared);
  if (simulated.state !== "simulated") assert.fail("simulation unexpectedly failed");

  const previous = process.env.ERA_TEST_PRIVATE_KEY;
  process.env.ERA_TEST_PRIVATE_KEY = DEV_KEY;
  try {
    const capability = signerCapability(privateKeyEnv("ERA_TEST_PRIVATE_KEY", Ethereum, from), {
      chain: Ethereum,
      allowedDestinations: [to],
      allowNativeTransfer: true,
    });
    const signed = await signSimulatedWithCapability(capability, simulated);
    const broadcast = await broadcastSignedWithRpc(base, signed);
    const replacementReceipt = {
      transactionHash: REPLACEMENT_HASH,
      blockHash: BLOCK_HASH,
      blockNumber: 102n,
      status: "success" as const,
      gasUsed: 21000n,
    };
    const replacedClient = {
      ...base,
      async waitForTransactionReceipt(args: { onReplaced: (notice: unknown) => void }) {
        args.onReplaced({ reason: "repriced", transaction: { hash: REPLACEMENT_HASH }, transactionReceipt: replacementReceipt });
        return replacementReceipt;
      },
    };
    const result = await waitForInclusionFromRpc(replacedClient, broadcast);
    assert.equal(result.kind, "replaced");
    if (result.kind === "replaced") assert.equal(result.transaction.replacementHash, REPLACEMENT_HASH);
  } finally {
    if (previous === undefined) delete process.env.ERA_TEST_PRIVATE_KEY;
    else process.env.ERA_TEST_PRIVATE_KEY = previous;
  }
});

test("static analyzer rejects direct and hardcoded private keys", () => {
  const diagnostics = analyzeWeb3Literals(`
    const key = process.env.PRIVATE_KEY
    const account = privateKeyToAccount("${DEV_KEY}")
  `, "secret.era");
  assert.ok(diagnostics.some((d) => d.code === "ES3820"));
  assert.ok(diagnostics.some((d) => d.code === "ES3821"));
});
