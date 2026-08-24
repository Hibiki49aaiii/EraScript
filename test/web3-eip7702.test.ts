import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { EraDiagnosticError } from "../src/diagnostics.js";
import {
  Ethereum,
  address,
  assertEip7702Policy,
  eip7702AuthorizationRequest,
  externalSignerCapability,
  prepareEip7702AuthorizationFromRpc,
  privateKeyEnv,
  signEip7702WithCapability,
  signEip7702WithExternalCapability,
  signerCapability,
  zeroDelegationAddress,
  type ExternalSigner,
} from "../src/web3/index.js";

const PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const account = privateKeyToAccount(PRIVATE_KEY);
const authority = address(account.address, Ethereum);
const delegate = address("0x0000000000000000000000000000000000001000", Ethereum);

const basePolicy = {
  chain: Ethereum,
  allowedDestinations: [] as const,
  allowedEip7702Delegates: [delegate] as const,
};

test("EIP-7702 preparation increments nonce only for self execution", async () => {
  const client = {
    chain: { id: 1, name: "Ethereum" },
    async getTransactionCount() { return 7; },
  };
  const relayed = await prepareEip7702AuthorizationFromRpc(client, {
    chain: Ethereum,
    authority,
    delegate,
    executor: "relayer",
  });
  const self = await prepareEip7702AuthorizationFromRpc(client, {
    chain: Ethereum,
    authority,
    delegate,
    executor: "self",
  });
  assert.equal(relayed.observedPendingNonce, 7);
  assert.equal(relayed.request.nonce, 7);
  assert.equal(self.request.nonce, 8);
});

test("EIP-7702 replayable and clear-delegation authorizations are default deny", () => {
  const replayable = eip7702AuthorizationRequest({
    chain: Ethereum,
    authority,
    delegate,
    nonce: 1,
    executor: "relayer",
    chainId: 0,
    allowReplayable: true,
  });
  assert.throws(
    () => assertEip7702Policy(basePolicy, replayable),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4104",
  );

  const clear = eip7702AuthorizationRequest({
    chain: Ethereum,
    authority,
    delegate: zeroDelegationAddress(Ethereum),
    nonce: 1,
    executor: "relayer",
    allowClearDelegation: true,
  });
  assert.throws(
    () => assertEip7702Policy(basePolicy, clear),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4105",
  );
});

test("local capability signs and cryptographically verifies EIP-7702 authorization", async () => {
  const envName = "ERA_TEST_EIP7702_KEY";
  const previous = process.env[envName];
  process.env[envName] = PRIVATE_KEY;
  try {
    const capability = signerCapability(privateKeyEnv(envName, Ethereum, authority), basePolicy);
    const request = eip7702AuthorizationRequest({
      chain: Ethereum,
      authority,
      delegate,
      nonce: 3,
      executor: "relayer",
    });
    const signed = await signEip7702WithCapability(capability, request);
    assert.equal(signed.authority, authority);
    assert.equal(signed.delegate, delegate);
    assert.equal(signed.nonce, 3);
    assert.match(signed.r, /^0x[0-9a-f]{64}$/i);
    assert.match(signed.s, /^0x[0-9a-f]{64}$/i);
  } finally {
    if (previous === undefined) delete process.env[envName];
    else process.env[envName] = previous;
  }
});

test("external signer capability verifies returned EIP-7702 signature against authority", async () => {
  const signAuthorization = account.signAuthorization as unknown as (parameters: {
    contractAddress: `0x${string}`;
    chainId: number;
    nonce: number;
  }) => Promise<{ address: string; chainId: number; nonce: number; yParity: number; r: string; s: string }>;

  const signer: ExternalSigner<typeof Ethereum> = {
    kind: "external-signer",
    chain: Ethereum,
    address: authority,
    async signTransaction() { return "0x01"; },
    async signEip7702Authorization(request) {
      return signAuthorization({ contractAddress: request.delegate, chainId: request.chainId, nonce: request.nonce });
    },
  };
  const capability = externalSignerCapability(signer, basePolicy);
  const request = eip7702AuthorizationRequest({ chain: Ethereum, authority, delegate, nonce: 4, executor: "relayer" });
  const signed = await signEip7702WithExternalCapability(capability, request);
  assert.equal(signed.kind, "eip7702-signed-authorization");
});
