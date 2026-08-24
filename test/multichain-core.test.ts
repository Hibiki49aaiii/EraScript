import assert from "node:assert/strict";
import test from "node:test";
import { EraDiagnosticError } from "../src/diagnostics.js";
import {
  EthereumMainnetProfile,
  FlashbotsBundleBackend,
  JitoBundleBackend,
  SolanaMainnetProfile,
  SuiMainnetProfile,
  assertBackendCompatible,
  assertSolanaBlockhashFresh,
  evmProfileFromViemChain,
  genericEvmProfile,
  lamports,
  mist,
  solanaAddress,
  solanaBlockhash,
  solanaRecentBlockhash,
  solanaTransactionSignature,
  suiAddress,
  suiObjectDigest,
  suiObjectId,
  suiObjectRef,
  suiTransactionDigest,
  withEvmCapabilityOverrides,
} from "../src/chains/index.js";

test("generic EVM profile does not assume optional protocol capabilities", () => {
  const chain = genericEvmProfile({ id: "evm.custom.777", name: "Custom EVM", chainId: 777 });
  assert.equal(chain.family, "evm");
  assert.equal(chain.capabilities.eip1559, "unknown");
  assert.equal(chain.capabilities.eip7702, "unknown");
  assert.equal(chain.capabilities.bundleRpc, "unknown");
  assert.deepEqual(chain.executionBackends, ["public-rpc", "custom"]);
});

test("any viem-compatible EVM Chain metadata can enter EraScript without inventing protocol support", () => {
  const profile = evmProfileFromViemChain({
    id: 777,
    name: "Example Rollup",
    nativeCurrency: { name: "Example Ether", symbol: "XETH", decimals: 18 },
    rpcUrls: { default: { http: ["https://example.invalid"] } },
  }, {
    finality: { kind: "evm-rollup", l2Inclusion: true, l1Settlement: "unknown" },
  });
  assert.equal(profile.chainId, 777);
  assert.equal(profile.nativeSymbol, "XETH");
  assert.equal(profile.finality.kind, "evm-rollup");
  assert.equal(profile.capabilities.eip1559, "unknown");
  assert.equal(profile.capabilities.eip7702, "unknown");
  assert.equal(profile.capabilities.bundleRpc, "unknown");

  const promoted = withEvmCapabilityOverrides(profile, { eip1559: "supported", finalizedTag: "supported" });
  assert.equal(promoted.capabilities.eip1559, "supported");
  assert.equal(promoted.capabilities.eip7702, "unknown");
});

test("execution backends are family-bound instead of globally assumed", () => {
  assert.doesNotThrow(() => assertBackendCompatible(EthereumMainnetProfile, FlashbotsBundleBackend));
  assert.doesNotThrow(() => assertBackendCompatible(SolanaMainnetProfile, JitoBundleBackend));
  assert.throws(
    () => assertBackendCompatible(SolanaMainnetProfile, FlashbotsBundleBackend),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4404",
  );
  assert.throws(
    () => assertBackendCompatible(EthereumMainnetProfile, JitoBundleBackend),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4404",
  );
  assert.equal(SuiMainnetProfile.family, "sui");
});

test("Solana primitives validate base58 byte widths and blockhash expiry", () => {
  const address = solanaAddress("11111111111111111111111111111111");
  const blockhash = solanaBlockhash("11111111111111111111111111111111");
  const signature = solanaTransactionSignature("1".repeat(64));
  assert.equal(address.length, 32);
  assert.equal(blockhash.length, 32);
  assert.equal(signature.length, 64);
  assert.equal(lamports("1000000000"), 1_000_000_000n);

  const evidence = solanaRecentBlockhash({ blockhash, lastValidBlockHeight: 200n, observedBlockHeight: 190n });
  assert.doesNotThrow(() => assertSolanaBlockhashFresh(evidence, 200n));
  assert.throws(
    () => assertSolanaBlockhashFresh(evidence, 201n),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4416",
  );
});

test("Sui primitives keep addresses, object refs, digests and MIST distinct", () => {
  const address = suiAddress(`0x${"11".repeat(32)}`);
  const objectId = suiObjectId(`0x${"22".repeat(32)}`);
  const objectDigest = suiObjectDigest("1".repeat(32));
  const txDigest = suiTransactionDigest("1".repeat(32));
  const ref = suiObjectRef({ objectId, version: 7n, digest: objectDigest });
  assert.equal(address, `0x${"11".repeat(32)}`);
  assert.equal(ref.version, 7n);
  assert.equal(txDigest.length, 32);
  assert.equal(mist("1000000000"), 1_000_000_000n);
});
