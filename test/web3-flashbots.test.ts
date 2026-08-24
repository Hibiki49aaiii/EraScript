import assert from "node:assert/strict";
import test from "node:test";
import {
  Ethereum,
  address,
  createFlashbotsBundle,
  draftTransaction,
  gas,
  nonce,
  prepareTransaction,
  recordSimulation,
  retargetFlashbotsBundle,
  signSimulated,
  simulateFlashbotsBundle,
  submitFlashbotsBundle,
  weiPerGas,
  type FlashbotsRelay,
  type SignedTx,
} from "../src/web3/index.js";
import { EraDiagnosticError } from "../src/diagnostics.js";

const sender = address("0x0000000000000000000000000000000000000001", Ethereum);
const target = address("0x0000000000000000000000000000000000000002", Ethereum);

function signedTx(nonceValue: number, raw: `0x${string}`): SignedTx<typeof Ethereum> {
  const draft = draftTransaction({ chain: Ethereum, from: sender, to: target });
  const prepared = prepareTransaction(draft, {
    nonce: nonce(Ethereum, nonceValue, "explicit"),
    gas: gas(21_000n),
    fees: { type: "legacy", gasPrice: weiPerGas(1n) },
  });
  const simulated = recordSimulation(prepared, { status: "success", blockNumber: 100n, blockHash: `0x${"aa".repeat(32)}`, stateOverrides: false });
  return signSimulated(simulated, raw);
}

function mockRelay(): FlashbotsRelay {
  return {
    url: "https://relay.example.invalid",
    authAddress: "0x0000000000000000000000000000000000000009",
    async request<Result>(method: string): Promise<Result> {
      if (method === "eth_callBundle") {
        return {
          bundleHash: `0x${"bb".repeat(32)}`,
          totalGasUsed: 42_000,
          results: [
            { txHash: `0x${"11".repeat(32)}`, gasUsed: 21_000 },
            { txHash: `0x${"22".repeat(32)}`, gasUsed: 21_000 },
          ],
        } as Result;
      }
      if (method === "eth_sendBundle") {
        return { bundleHash: `0x${"bb".repeat(32)}` } as Result;
      }
      throw new Error(`unexpected method ${method}`);
    },
  };
}

test("Flashbots bundle requires target-bound simulation before submission", async () => {
  const bundle = createFlashbotsBundle({
    chain: Ethereum,
    transactions: [signedTx(7, "0x01"), signedTx(8, "0x02")],
    currentBlock: 100n,
  });
  assert.equal(bundle.targetBlock, 101n);
  assert.equal(bundle.stateBlock, 100n);

  const simulated = await simulateFlashbotsBundle(mockRelay(), bundle);
  assert.equal(simulated.state, "bundle-simulated");
  assert.equal(simulated.simulation.targetBlock, 101n);

  const submitted = await submitFlashbotsBundle(mockRelay(), simulated, 100n);
  assert.equal(submitted.state, "bundle-submitted");

  const retargeted = retargetFlashbotsBundle(simulated, 101n);
  assert.equal(retargeted.state, "bundle-draft");
  assert.equal(retargeted.targetBlock, 102n);
});

test("Flashbots submission rejects stale simulation after head changes", async () => {
  const bundle = createFlashbotsBundle({ chain: Ethereum, transactions: [signedTx(7, "0x01")], currentBlock: 100n });
  const simulated = await simulateFlashbotsBundle(mockRelay(), bundle);
  await assert.rejects(
    () => submitFlashbotsBundle(mockRelay(), simulated, 101n),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES3940",
  );
});

test("Flashbots bundle rejects nonce gaps for the same sender", () => {
  assert.throws(
    () => createFlashbotsBundle({
      chain: Ethereum,
      transactions: [signedTx(7, "0x01"), signedTx(9, "0x02")],
      currentBlock: 100n,
    }),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES3935",
  );
});
