import assert from "node:assert/strict";
import test from "node:test";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import {
  SuiMainnetProfile,
  assertSuiClientNetwork,
} from "../../src/chains/index.js";

const BASE_URL = process.env.SUI_GRPC_URL || "https://fullnode.mainnet.sui.io:443";

test("Sui mainnet Core API satisfies EraScript network binding", { timeout: 30_000 }, async () => {
  const client = new SuiGrpcClient({
    network: "mainnet",
    baseUrl: BASE_URL,
  });

  const observed = await client.core.getChainIdentifier();
  assert.equal(typeof observed.chainIdentifier, "string");
  assert.ok(observed.chainIdentifier.length > 0);

  const eraClient = {
    network: "mainnet",
    core: {
      getChainIdentifier: () => client.core.getChainIdentifier(),
    },
  };

  const verified = await assertSuiClientNetwork(
    eraClient,
    SuiMainnetProfile,
    observed.chainIdentifier,
  );
  assert.equal(verified, observed.chainIdentifier);

  const gas = await client.core.getReferenceGasPrice();
  assert.ok(BigInt(gas.referenceGasPrice) > 0n);
});
