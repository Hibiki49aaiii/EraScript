// Offline demonstration only: fixed public test signature on chain 1337.
// No key, real hardware, RPC, network listener or transaction submission.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSigningAuthority, hardwareWalletSigningBackend, openFileSigningReplayStore, serviceSigningBackend, signingRequestHash } from "erascript-lang/signing";

const chain = { name: "OfflineFixture", id: 1337 };
const sender = "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf";
const recipient = "0x0000000000000000000000000000000000000022";
const raw = "0xf86180018252089400000000000000000000000000000000000000220180820a95a0ae53d6e151fc405287660a5ca05496b610d090eed4a6dcd9097c331f194f9e33a015276db3606c8d9a5747114df296d072c7164b4d56d8b25e16305b0fa1005a4a";
const request = { kind: "external-transaction-signing-request", chain, transactionType: "legacy", from: sender, to: recipient, value: 1n, nonce: 0, gas: 21000n, fee: { type: "legacy", gasPrice: 1n }, simulation: { status: "success", stateOverrides: false } };
const policy = { chainId: 1337, signer: sender, recipients: [recipient], maxNativeValue: 1n, maxGas: 21000n, maxTotalFee: 21000n, tokens: [] };
const service = serviceSigningBackend({ kind: "external-signer", chain, address: sender, async signTransaction() { return raw; } });
const device = hardwareWalletSigningBackend({ signer: sender, chainId: 1337, bridge: { async displayAddress() { return sender; }, async signTransaction() { return { approval: "device", rawTransaction: raw }; } } });

for (const backend of [service, device]) {
  const directory = await mkdtemp(join(tmpdir(), "era-offline-authority-"));
  try {
    const grant = { id: "offline-fixture", callerId: "offline", walletId: "fixture", createdAtMs: Date.now() - 1000, expiresAtMs: Date.now() + 60_000, request };
    const authority = createSigningAuthority({ wallets: [{ id: "fixture", policy, backend }], grants: [grant], replayStore: await openFileSigningReplayStore(directory), verifySimulation: async () => true /* synthetic fixture only */ });
    const wire = { version: 1, grantId: grant.id, requestId: "12".repeat(16), requestHash: signingRequestHash(request), expectedBackend: backend.kind };
    const result = await authority.sign("offline", wire);
    assert.equal(result.rawTransaction, raw);
    await assert.rejects(authority.sign("offline", wire));
    console.log(JSON.stringify({ backend: backend.kind, fixtureSignatureVerified: true, replayRejected: true, realDeviceUsed: false, executionVerified: false, recoveryVerified: false }));
  } finally {
    // Only this newly created offline fixture directory; real stores must never be reset.
    await rm(directory, { recursive: true, force: true });
  }
}
