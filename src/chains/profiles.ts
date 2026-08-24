import type {
  EvmChainProfile,
  ExecutionBackendDescriptor,
  ProtocolOverlayDescriptor,
  SolanaChainProfile,
  SuiChainProfile,
} from "./types.js";
import {
  defineEvmChainProfile,
  defineSolanaChainProfile,
  defineSuiChainProfile,
} from "./types.js";

export const EthereumMainnetProfile: EvmChainProfile = defineEvmChainProfile({
  id: "evm.ethereum.mainnet",
  name: "Ethereum Mainnet",
  family: "evm",
  network: "mainnet",
  nativeSymbol: "ETH",
  chainId: 1,
  finality: { kind: "evm-confirmations", supportsFinalizedTag: "supported", supportsSafeTag: "supported" },
  executionBackends: ["public-rpc", "private-rpc", "flashbots-bundle", "custom"],
  capabilities: {
    eip1559: "supported",
    eip2930: "supported",
    eip4844: "supported",
    eip7702: "supported",
    erc4337: "supported",
    debugTraceCall: "unknown",
    finalizedTag: "supported",
    safeTag: "supported",
    privateRpc: "supported",
    bundleRpc: "supported",
  },
});

export const SolanaMainnetProfile: SolanaChainProfile = defineSolanaChainProfile({
  id: "solana.mainnet-beta",
  name: "Solana Mainnet Beta",
  family: "solana",
  network: "mainnet-beta",
  nativeSymbol: "SOL",
  cluster: "mainnet-beta",
  finality: { kind: "solana-commitment", levels: ["processed", "confirmed", "finalized"] },
  executionBackends: ["public-rpc", "jito-bundle", "custom"],
  capabilities: {
    versionedTransactions: "supported",
    addressLookupTables: "supported",
    durableNonce: "supported",
    jitoBundles: "supported",
    maxTransactionVersion: 0,
  },
});

export const SuiMainnetProfile: SuiChainProfile = defineSuiChainProfile({
  id: "sui.mainnet",
  name: "Sui Mainnet",
  family: "sui",
  network: "mainnet",
  nativeSymbol: "SUI",
  finality: { kind: "sui-effects-checkpoint", effectsFinality: true, checkpointInclusion: true },
  executionBackends: ["sui-rpc", "custom"],
  capabilities: {
    programmableTransactions: "supported",
    sponsoredTransactions: "supported",
    addressBalanceGas: "supported",
    dryRun: "supported",
  },
});

export const PublicRpcBackend: ExecutionBackendDescriptor = {
  id: "public-rpc",
  kind: "public-rpc",
  families: ["evm", "solana"],
  atomicity: "single-transaction",
  privacy: "public",
};

export const FlashbotsBundleBackend: ExecutionBackendDescriptor = {
  id: "flashbots-bundle",
  kind: "flashbots-bundle",
  families: ["evm"],
  atomicity: "multi-transaction",
  privacy: "private-submission",
  requires: ["provider-specific Flashbots relay support"],
};

export const JitoBundleBackend: ExecutionBackendDescriptor = {
  id: "jito-bundle",
  kind: "jito-bundle",
  families: ["solana"],
  atomicity: "multi-transaction",
  privacy: "private-submission",
  requires: ["Jito Block Engine support", "bundle-safe state assertions"],
};

export const SuiRpcBackend: ExecutionBackendDescriptor = {
  id: "sui-rpc",
  kind: "sui-rpc",
  families: ["sui"],
  atomicity: "single-transaction",
  privacy: "public",
};

export const RailgunBroadcasterBackend: ExecutionBackendDescriptor = {
  id: "railgun-broadcaster",
  kind: "railgun-broadcaster",
  families: ["evm"],
  atomicity: "single-transaction",
  privacy: "protocol-private",
  requires: ["RAILGUN Wallet SDK proof", "Broadcaster fee quote", "supported RAILGUN EVM deployment"],
};

export const RailgunSelfSubmitBackend: ExecutionBackendDescriptor = {
  id: "railgun-self-submit",
  kind: "railgun-self-submit",
  families: ["evm"],
  atomicity: "single-transaction",
  privacy: "protocol-private",
  requires: ["RAILGUN Wallet SDK proof", "public EVM signer"],
};

/**
 * RAILGUN is modeled as an EVM privacy overlay, not as a base-chain family.
 * Consensus/finality always comes from the underlying EVM chain profile.
 */
export const RailgunPrivacyOverlay: ProtocolOverlayDescriptor = {
  id: "railgun",
  name: "RAILGUN Privacy System",
  baseFamilies: ["evm"],
  executionBackends: ["railgun-broadcaster", "railgun-self-submit"],
  privacy: "shielded",
  proofSystem: "Groth16 / Poseidon Merkle",
};
