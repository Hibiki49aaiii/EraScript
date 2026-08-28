import { EraDiagnosticError } from "../diagnostics.js";
import type { EvmChain } from "../web3/types.js";
import {
  captureRailgunPrivateBalance,
  verifyRailgunPrivateBalanceChanges,
  type RailgunBalanceBucket,
  type RailgunPrivateBalanceExpectation,
  type RailgunPrivateBalanceReader,
  type RailgunPrivateBalanceSnapshot,
} from "./railgun-private-state.js";
import type { RailgunSdkProofSession } from "./railgun-adapter.js";
import type { RailgunPrivateStateEvidence } from "./verification.js";

export interface RailgunWalletSdkChainLike {
  readonly id: number;
  readonly type?: number;
}

export interface RailgunWalletSdkWalletLike<
  TSdkTxidVersion,
  TSdkChain extends RailgunWalletSdkChainLike,
  TTokenBalances,
> {
  readonly id: string;
  getTokenBalancesByBucket(
    txidVersion: TSdkTxidVersion,
    chain: TSdkChain,
  ): Promise<Partial<Record<RailgunBalanceBucket, TTokenBalances>>>;
  getTokenBalances(
    txidVersion: TSdkTxidVersion,
    chain: TSdkChain,
    onlySpendable: boolean,
  ): Promise<TTokenBalances>;
}

export interface RailgunWalletSdkPrivateStateApi<
  TSdkTxidVersion,
  TSdkChain extends RailgunWalletSdkChainLike,
  TTokenBalances,
> {
  refreshBalances(chain: TSdkChain, walletIdFilter: string[] | undefined): Promise<void>;
  awaitWalletScan(walletId: string, chain: TSdkChain): Promise<unknown>;
  walletForID(walletId: string): RailgunWalletSdkWalletLike<TSdkTxidVersion, TSdkChain, TTokenBalances>;
  getSerializedERC20Balances(
    balances: TTokenBalances,
  ): readonly {
    readonly tokenAddress: string;
    readonly amount: bigint | string | number;
  }[];
}

export type RailgunWalletSdkBalanceMode =
  | "by-bucket"
  | "all-as-spendable";

export interface RailgunWalletSdkPrivateBalanceReaderOptions<
  TSdkTxidVersion,
  TSdkChain extends RailgunWalletSdkChainLike,
  TTokenBalances,
> {
  readonly id?: string;
  readonly sdk: RailgunWalletSdkPrivateStateApi<TSdkTxidVersion, TSdkChain, TTokenBalances>;
  readonly sdkChain: TSdkChain;
  readonly resolveTxidVersion: (eraTxidVersion: string) => TSdkTxidVersion;
  /**
   * Use "by-bucket" on POI-enabled networks. Use "all-as-spendable" only
   * where the Wallet SDK itself treats all private balances as Spendable.
   */
  readonly balanceMode?: RailgunWalletSdkBalanceMode;
}

function fail(
  code: string,
  kind: string,
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new EraDiagnosticError({
    code,
    severity: "error",
    kind,
    message,
    ...(details ? { details } : {}),
  });
}

function assertChain<C extends EvmChain>(
  chain: C,
  sdkChain: RailgunWalletSdkChainLike,
): void {
  if (!Number.isSafeInteger(sdkChain.id) || sdkChain.id < 0) {
    fail(
      "ES4730",
      "InvalidRailgunWalletSdkChain",
      "RAILGUN Wallet SDK chain id must be a non-negative safe integer.",
      { sdkChainId: String(sdkChain.id) },
    );
  }
  if (chain.id !== sdkChain.id) {
    fail(
      "ES4731",
      "RailgunWalletSdkChainMismatch",
      "EraScript EVM chain does not match the configured RAILGUN Wallet SDK chain.",
      { eraChainId: chain.id, sdkChainId: sdkChain.id },
    );
  }
}

function assertWallet(walletId: string, observedWalletId: string): void {
  if (!walletId) {
    fail(
      "ES4732",
      "MissingRailgunWalletSdkWalletId",
      "RAILGUN Wallet SDK private-state reader requires a wallet ID.",
    );
  }
  if (observedWalletId !== walletId) {
    fail(
      "ES4733",
      "RailgunWalletSdkWalletMismatch",
      "RAILGUN Wallet SDK returned a different wallet than requested.",
      { requestedWalletId: walletId, observedWalletId },
    );
  }
}

/**
 * Converts the public RAILGUN Wallet SDK balance APIs into EraScript's
 * proof-bound private-state reader contract.
 *
 * refresh() deliberately subscribes to awaitWalletScan() before starting
 * refreshBalances(), preventing a fast WalletDecryptBalancesComplete event
 * from racing past the listener.
 */
export function createRailgunWalletSdkPrivateBalanceReader<
  C extends EvmChain,
  TSdkTxidVersion,
  TSdkChain extends RailgunWalletSdkChainLike,
  TTokenBalances,
>(
  options: RailgunWalletSdkPrivateBalanceReaderOptions<
    TSdkTxidVersion,
    TSdkChain,
    TTokenBalances
  >,
): RailgunPrivateBalanceReader<C> {
  const balanceMode = options.balanceMode ?? "by-bucket";
  const id =
    options.id ??
    `railgun-wallet-sdk:${options.sdkChain.type ?? "evm"}:${options.sdkChain.id}`;

  return {
    id,

    async refresh({ chain, walletId }): Promise<void> {
      assertChain(chain, options.sdkChain);
      const wallet = options.sdk.walletForID(walletId);
      assertWallet(walletId, wallet.id);

      const scanComplete = options.sdk.awaitWalletScan(walletId, options.sdkChain);
      await options.sdk.refreshBalances(options.sdkChain, [walletId]);
      await scanComplete;
    },

    async read({
      chain,
      walletId,
      txidVersion,
      balanceBucket,
    }): Promise<
      readonly {
        readonly token: string;
        readonly amount: bigint | string | number;
      }[]
    > {
      assertChain(chain, options.sdkChain);
      const wallet = options.sdk.walletForID(walletId);
      assertWallet(walletId, wallet.id);
      const sdkTxidVersion = options.resolveTxidVersion(txidVersion);

      let rawBalances: TTokenBalances | undefined;
      if (balanceMode === "all-as-spendable") {
        if (balanceBucket !== "Spendable") {
          fail(
            "ES4734",
            "UnsupportedRailgunWalletSdkBalanceBucket",
            "This RAILGUN Wallet SDK reader is configured to expose all balances as Spendable and cannot prove another POI bucket.",
            { balanceBucket },
          );
        }
        rawBalances = await wallet.getTokenBalances(
          sdkTxidVersion,
          options.sdkChain,
          false,
        );
      } else {
        const byBucket = await wallet.getTokenBalancesByBucket(
          sdkTxidVersion,
          options.sdkChain,
        );
        rawBalances = byBucket[balanceBucket];
        if (rawBalances === undefined) {
          fail(
            "ES4735",
            "MissingRailgunWalletSdkBalanceBucket",
            "RAILGUN Wallet SDK did not return the requested private balance bucket.",
            { balanceBucket, walletId },
          );
        }
      }

      let serialized: readonly {
        readonly tokenAddress: string;
        readonly amount: bigint | string | number;
      }[];
      try {
        serialized = options.sdk.getSerializedERC20Balances(rawBalances);
      } catch (error) {
        return fail(
          "ES4736",
          "RailgunWalletSdkBalanceSerializationFailed",
          "RAILGUN Wallet SDK failed to serialize private ERC20 balances.",
          { cause: error instanceof Error ? error.message : String(error) },
        );
      }

      return serialized.map((entry) => ({
        token: entry.tokenAddress,
        amount: entry.amount,
      }));
    },
  };
}


export interface RailgunWalletSdkPrivateTransitionEvidence<
  C extends EvmChain,
  TResult,
> {
  readonly kind: "railgun-wallet-sdk-private-transition";
  readonly proofSession: RailgunSdkProofSession<C>;
  readonly before: RailgunPrivateBalanceSnapshot<C>;
  readonly after: RailgunPrivateBalanceSnapshot<C>;
  readonly privateState: RailgunPrivateStateEvidence;
  readonly transitionResult: TResult;
}

/**
 * Captures one proof-bound RAILGUN private-state transition with a single
 * chain/wallet/TXID-version source of truth.
 *
 * The transition callback should perform the relevant submission/wait step.
 * This helper proves private balance movement only; base-EVM inclusion/finality
 * remains a separate mandatory gate in railgunVerificationReport().
 */
export async function verifyRailgunWalletSdkPrivateTransition<
  C extends EvmChain,
  TResult,
>(input: {
  readonly reader: RailgunPrivateBalanceReader<C>;
  readonly proofSession: RailgunSdkProofSession<C>;
  readonly expectations: readonly RailgunPrivateBalanceExpectation[];
  readonly balanceBucket?: RailgunBalanceBucket;
  readonly transition: () => Promise<TResult>;
  readonly beforeObservedAtMs?: number;
  readonly afterObservedAtMs?: number;
  readonly source?: string;
}): Promise<RailgunWalletSdkPrivateTransitionEvidence<C, TResult>> {
  const source = input.proofSession.source;
  if (source.chain.id !== input.proofSession.proof.chain.id) {
    fail(
      "ES4737",
      "RailgunPrivateTransitionProofChainMismatch",
      "RAILGUN proof session source and generated proof belong to different chains.",
      {
        sourceChainId: source.chain.id,
        proofChainId: input.proofSession.proof.chain.id,
      },
    );
  }

  const balanceBucket = input.balanceBucket ?? "Spendable";
  const before = await captureRailgunPrivateBalance({
    reader: input.reader,
    chain: source.chain,
    walletId: source.walletId,
    txidVersion: source.txidVersion,
    balanceBucket,
    ...(input.beforeObservedAtMs !== undefined
      ? { observedAtMs: input.beforeObservedAtMs }
      : {}),
  });

  const transitionResult = await input.transition();

  const after = await captureRailgunPrivateBalance({
    reader: input.reader,
    chain: source.chain,
    walletId: source.walletId,
    txidVersion: source.txidVersion,
    balanceBucket,
    ...(input.afterObservedAtMs !== undefined
      ? { observedAtMs: input.afterObservedAtMs }
      : {}),
  });

  const privateState = verifyRailgunPrivateBalanceChanges({
    proofBindingHash: input.proofSession.proof.proofBindingHash,
    before,
    after,
    expectations: input.expectations,
    ...(input.source ? { source: input.source } : {}),
  });

  return {
    kind: "railgun-wallet-sdk-private-transition",
    proofSession: input.proofSession,
    before,
    after,
    privateState,
    transitionResult,
  };
}
