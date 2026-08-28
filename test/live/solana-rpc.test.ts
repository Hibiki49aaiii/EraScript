import assert from "node:assert/strict";
import test from "node:test";
import {
  SolanaMainnetProfile,
  assertSolanaKitNetwork,
  captureSolanaRecentBlockhash,
  type SolanaKitClientLike,
} from "../../src/chains/index.js";

const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

async function rpc(method: string, params: readonly unknown[]): Promise<unknown> {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.ok, true, `Solana RPC HTTP ${response.status}`);
  const payload = await response.json() as {
    result?: unknown;
    error?: { code?: number; message?: string };
  };
  if (payload.error) {
    throw new Error(`Solana RPC ${method} failed: ${payload.error.code ?? "?"} ${payload.error.message ?? "unknown error"}`);
  }
  return payload.result;
}

function pending<T>(method: string, params: readonly unknown[]) {
  return { send: () => rpc(method, params) as Promise<T> };
}

const client: SolanaKitClientLike = {
  rpc: {
    getGenesisHash: () => pending<string>("getGenesisHash", []),
    getLatestBlockhash: (config) => pending<unknown>("getLatestBlockhash", config ? [config] : []),
    getBlockHeight: (config) => pending<unknown>("getBlockHeight", config ? [config] : []),
  },
};

test("Solana mainnet RPC satisfies EraScript network and blockhash evidence gates", { timeout: 30_000 }, async () => {
  const genesis = await assertSolanaKitNetwork(
    client,
    SolanaMainnetProfile,
    MAINNET_GENESIS_HASH,
  );
  assert.equal(genesis, MAINNET_GENESIS_HASH);

  const evidence = await captureSolanaRecentBlockhash(client, "confirmed");
  assert.match(String(evidence.blockhash), /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  assert.notEqual(evidence.observedBlockHeight, undefined);
  assert.ok(evidence.lastValidBlockHeight >= evidence.observedBlockHeight!);
  assert.equal(evidence.commitment, "confirmed");
});
