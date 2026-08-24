import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { EraDiagnosticError } from "../src/diagnostics.js";
import {
  Ethereum,
  address,
  assertSignerPolicy,
  draftTransaction,
  eip7702AuthorizationRequest,
  externalTransactionRequest,
  gas,
  maxFeePerGas,
  maxPriorityFeePerGas,
  nonce,
  prepareDraftWithRpc,
  prepareTransaction,
  privateKeyEnv,
  signEip7702WithCapability,
  signerCapability,
  simulatePreparedWithRpc,
  weiPerGas,
  type SignedEip7702Authorization,
} from "../src/web3/index.js";

const PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const account = privateKeyToAccount(PRIVATE_KEY);
const authority = address(account.address, Ethereum);
const delegate = address("0x0000000000000000000000000000000000001000", Ethereum);
const target = address("0x0000000000000000000000000000000000002000", Ethereum);
const BLOCK_HASH = `0x${"33".repeat(32)}` as `0x${string}`;

async function signedAuthorization(authNonce = 8): Promise<SignedEip7702Authorization<typeof Ethereum>> {
  const envName = "ERA_TEST_7702_TX_KEY";
  const previous = process.env[envName];
  process.env[envName] = PRIVATE_KEY;
  try {
    const capability = signerCapability(privateKeyEnv(envName, Ethereum, authority), {
      chain: Ethereum,
      allowedDestinations: [],
      allowedEip7702Delegates: [delegate],
    });
    return await signEip7702WithCapability(capability, eip7702AuthorizationRequest({
      chain: Ethereum,
      authority,
      delegate,
      nonce: authNonce,
      executor: "self",
    }));
  } finally {
    if (previous === undefined) delete process.env[envName];
    else process.env[envName] = previous;
  }
}

const eip1559Fees = {
  type: "eip1559" as const,
  maxFeePerGas: maxFeePerGas(30_000_000_000n),
  maxPriorityFeePerGas: maxPriorityFeePerGas(2_000_000_000n),
};

test("EIP-7702 transaction preparation enforces type-4 structural rules", async () => {
  const authorization = await signedAuthorization(8);
  const draft = draftTransaction({ chain: Ethereum, from: authority, to: target, authorizationList: [authorization] });
  const prepared = prepareTransaction(draft, {
    nonce: nonce(Ethereum, 7, "explicit"),
    gas: gas(50_000n),
    fees: eip1559Fees,
  });
  assert.equal(prepared.intent.authorizationList?.length, 1);

  assert.throws(
    () => prepareTransaction(draft, {
      nonce: nonce(Ethereum, 7, "explicit"),
      gas: gas(50_000n),
      fees: { type: "legacy", gasPrice: weiPerGas(1n) },
    }),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4113",
  );
});

test("EIP-7702 self execution requires authorization nonce = tx nonce + 1", async () => {
  const authorization = await signedAuthorization(9);
  const draft = draftTransaction({ chain: Ethereum, from: authority, to: target, authorizationList: [authorization] });
  assert.throws(
    () => prepareTransaction(draft, {
      nonce: nonce(Ethereum, 7, "explicit"),
      gas: gas(50_000n),
      fees: eip1559Fees,
    }),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4116",
  );
});

test("EIP-7702 transaction rejects duplicate authority tuples", async () => {
  const authorization = await signedAuthorization(8);
  const draft = draftTransaction({ chain: Ethereum, from: authority, to: target, authorizationList: [authorization, authorization] });
  assert.throws(
    () => prepareTransaction(draft, {
      nonce: nonce(Ethereum, 7, "explicit"),
      gas: gas(50_000n),
      fees: eip1559Fees,
    }),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4114",
  );
});

test("RPC estimation and simulation preserve the authorization list", async () => {
  const authorization = await signedAuthorization(8);
  const draft = draftTransaction({ chain: Ethereum, from: authority, to: target, authorizationList: [authorization] });
  let estimatedAuthorizationCount = 0;
  let simulatedAuthorizationCount = 0;
  let requestedFeeType: string | undefined;
  const client = {
    chain: { id: 1, name: "Ethereum" },
    async getTransactionCount() { return 7; },
    async estimateGas(args: { authorizationList?: readonly unknown[] }) {
      estimatedAuthorizationCount = args.authorizationList?.length ?? 0;
      return 50_000n;
    },
    async estimateFeesPerGas(args: { type?: string }) {
      requestedFeeType = args.type;
      return { maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n };
    },
    async getBlock(args: { blockTag?: string }) {
      if (args.blockTag === "latest") return { number: 101n, hash: BLOCK_HASH };
      return { number: 100n, hash: `0x${"44".repeat(32)}` as `0x${string}` };
    },
    async call(args: { authorizationList?: readonly unknown[] }) {
      simulatedAuthorizationCount = args.authorizationList?.length ?? 0;
      return { data: "0x" as const };
    },
  };

  const prepared = await prepareDraftWithRpc(client, draft);
  assert.equal(requestedFeeType, "eip1559");
  assert.equal(estimatedAuthorizationCount, 1);
  const simulated = await simulatePreparedWithRpc(client, prepared);
  assert.equal(simulated.state, "simulated");
  assert.equal(simulatedAuthorizationCount, 1);
});

test("outer signer policy default-denies EIP-7702 transaction and exposes it to external signer when allowed", async () => {
  const authorization = await signedAuthorization(8);
  const draft = draftTransaction({ chain: Ethereum, from: authority, to: target, authorizationList: [authorization] });
  const prepared = prepareTransaction(draft, {
    nonce: nonce(Ethereum, 7, "explicit"),
    gas: gas(50_000n),
    fees: eip1559Fees,
  });
  const simulated = {
    ...prepared,
    state: "simulated" as const,
    simulation: { status: "success" as const, blockNumber: 100n, blockHash: BLOCK_HASH, stateOverrides: false },
  };

  const deniedPolicy = {
    chain: Ethereum,
    allowedDestinations: [target],
    allowNativeTransfer: true,
    allowedEip7702Delegates: [delegate],
  };
  assert.throws(
    () => assertSignerPolicy(Ethereum, deniedPolicy, simulated),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES3818",
  );

  const allowedPolicy = { ...deniedPolicy, allowEip7702Transactions: true };
  assert.doesNotThrow(() => assertSignerPolicy(Ethereum, allowedPolicy, simulated));
  const external = externalTransactionRequest(simulated);
  assert.equal(external.transactionType, "eip7702");
  assert.equal(external.authorizationList?.length, 1);
  assert.equal(external.authorizationList?.[0]?.address.toLowerCase(), delegate.toLowerCase());
});
