import type { Hex } from "viem";
import { EraDiagnosticError } from "../diagnostics.js";
import type { SignedEip7702Authorization } from "./eip7702.js";
import type { Nonce } from "./nonce.js";
import {
  blockHash,
  transactionHash,
  type Address,
  type BlockHash,
  type Calldata,
  type EvmChain,
  type TransactionHash,
} from "./types.js";
import type { Gas, MaxFeePerGas, MaxPriorityFeePerGas, Wei, WeiPerGas } from "./values.js";

export type FeeModel =
  | {
      readonly type: "eip1559";
      readonly maxFeePerGas: MaxFeePerGas;
      readonly maxPriorityFeePerGas: MaxPriorityFeePerGas;
    }
  | { readonly type: "legacy"; readonly gasPrice: WeiPerGas };

export interface TxIntent<C extends EvmChain = EvmChain> {
  readonly chain: C;
  readonly from?: Address<C>;
  readonly to?: Address<C>;
  readonly value?: Wei;
  readonly data?: Calldata;
  readonly authorizationList?: readonly SignedEip7702Authorization<C>[];
}

export interface ViemEip7702Authorization<C extends EvmChain = EvmChain> {
  readonly address: Address<C>;
  readonly chainId: number;
  readonly nonce: number;
  readonly yParity: number;
  readonly r: Hex;
  readonly s: Hex;
}

export function authorizationListForViem<C extends EvmChain>(intent: TxIntent<C>): readonly ViemEip7702Authorization<C>[] | undefined {
  return intent.authorizationList?.map((authorization) => ({
    address: authorization.delegate,
    chainId: authorization.chainId,
    nonce: authorization.nonce,
    yParity: authorization.yParity,
    r: authorization.r,
    s: authorization.s,
  }));
}

export interface DraftTx<C extends EvmChain = EvmChain> {
  readonly state: "draft";
  readonly intent: TxIntent<C>;
}

export interface PreparedTx<C extends EvmChain = EvmChain> {
  readonly state: "prepared";
  readonly intent: TxIntent<C>;
  readonly nonce: Nonce<C>;
  readonly gas: Gas;
  readonly fees: FeeModel;
}

export interface SimulationEvidence {
  readonly status: "success";
  readonly blockNumber?: bigint;
  readonly blockHash?: string;
  readonly gasUsed?: bigint;
  readonly returnData?: Hex;
  readonly stateOverrides: boolean;
  readonly provider?: string;
  readonly assumptions?: readonly string[];
}

export interface SimulationFailureEvidence {
  readonly status: "failure";
  readonly blockNumber?: bigint;
  readonly blockHash?: string;
  readonly stateOverrides: boolean;
  readonly provider?: string;
  readonly error: string;
}

export interface SimulatedTx<C extends EvmChain = EvmChain> extends Omit<PreparedTx<C>, "state"> {
  readonly state: "simulated";
  readonly simulation: SimulationEvidence;
}

export interface SimulationFailedTx<C extends EvmChain = EvmChain> extends Omit<PreparedTx<C>, "state"> {
  readonly state: "simulation-failed";
  readonly simulation: SimulationFailureEvidence;
}

export interface SignedTx<C extends EvmChain = EvmChain> extends Omit<SimulatedTx<C>, "state"> {
  readonly state: "signed";
  readonly rawTransaction: Hex;
}

export interface BroadcastTx<C extends EvmChain = EvmChain> extends Omit<SignedTx<C>, "state"> {
  readonly state: "broadcast";
  readonly hash: TransactionHash<C>;
  readonly broadcastAt: number;
}

export interface PendingTx<C extends EvmChain = EvmChain> extends Omit<BroadcastTx<C>, "state"> {
  readonly state: "pending";
  readonly pendingSince: number;
}

export interface ReceiptEvidence<C extends EvmChain = EvmChain> {
  readonly transactionHash: TransactionHash<C>;
  readonly blockHash: BlockHash<C>;
  readonly blockNumber: bigint;
  readonly status: "success" | "reverted";
  readonly gasUsed: bigint;
  readonly effectiveGasPrice?: bigint;
}

export interface IncludedTx<C extends EvmChain = EvmChain> extends Omit<BroadcastTx<C>, "state"> {
  readonly state: "included";
  readonly pendingSince?: number;
  readonly receipt: ReceiptEvidence<C>;
}

export interface ConfirmedTx<C extends EvmChain = EvmChain, N extends number = number>
  extends Omit<IncludedTx<C>, "state"> {
  readonly state: "confirmed";
  readonly confirmations: N;
}

export interface FinalizedTx<C extends EvmChain = EvmChain> extends Omit<ConfirmedTx<C, number>, "state"> {
  readonly state: "finalized";
}

export type ReplacementReason = "repriced" | "replaced" | "cancelled";

export interface ReplacedTx<C extends EvmChain = EvmChain> {
  readonly state: "replaced";
  readonly original: BroadcastTx<C> | PendingTx<C>;
  readonly replacementHash: TransactionHash<C>;
  readonly reason: ReplacementReason;
}

function txError(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({
    code,
    severity: "error",
    kind,
    message,
    ...(details ? { details } : {}),
  });
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function validateAuthorizationList<C extends EvmChain>(draft: DraftTx<C>, txNonce: Nonce<C>, fees: FeeModel): void {
  const list = draft.intent.authorizationList;
  if (list === undefined) return;
  if (list.length === 0) txError("ES4111", "EmptyEip7702AuthorizationList", "EIP-7702 transactions require a non-empty authorization list.");
  if (!draft.intent.from) txError("ES4118", "MissingEip7702Executor", "EIP-7702 transaction intent must declare the outer transaction sender.");
  if (!draft.intent.to) txError("ES4112", "MissingEip7702Destination", "EIP-7702 set-code transactions require a non-null destination.");
  if (fees.type !== "eip1559") txError("ES4113", "InvalidEip7702FeeModel", "EIP-7702 set-code transactions require EIP-1559 fee fields.");

  const authorities = new Set<string>();
  for (const [index, authorization] of list.entries()) {
    if (authorization.chain.id !== draft.intent.chain.id) txError("ES3104", "ChainMismatch", "EIP-7702 authorization is bound to a different EraScript chain.", { index, authorizationChain: authorization.chain.id, transactionChain: draft.intent.chain.id });
    if (authorization.chainId !== 0 && authorization.chainId !== draft.intent.chain.id) txError("ES3104", "ChainMismatch", "EIP-7702 authorization chainId is neither zero nor the transaction chain.", { index, authorizationChainId: authorization.chainId, transactionChain: draft.intent.chain.id });

    const authorityKey = authorization.authority.toLowerCase();
    if (authorities.has(authorityKey)) txError("ES4114", "DuplicateEip7702Authority", "Multiple authorization tuples for the same authority are rejected because protocol processing uses the last valid occurrence.", { index, authority: authorization.authority });
    authorities.add(authorityKey);

    const executorIsAuthority = sameAddress(draft.intent.from, authorization.authority);
    if (authorization.executor === "self") {
      if (!executorIsAuthority) txError("ES4115", "Eip7702ExecutorMismatch", "Authorization declares self execution but the outer transaction sender is different.", { index, authority: authorization.authority, transactionFrom: draft.intent.from });
      if (authorization.nonce !== txNonce.value + 1) txError("ES4116", "Eip7702SelfNonceMismatch", "Self-executing EIP-7702 authorization nonce must equal the outer transaction nonce plus one.", { index, transactionNonce: txNonce.value, authorizationNonce: authorization.nonce });
    } else if (executorIsAuthority) {
      txError("ES4117", "Eip7702ExecutorMismatch", "Authorization declares relayer execution but the authority is also the outer transaction sender. Use executor='self' and the +1 authorization nonce rule.", { index, authority: authorization.authority });
    }
  }
}

export function draftTransaction<C extends EvmChain>(intent: TxIntent<C>): DraftTx<C> {
  return { state: "draft", intent };
}

export function prepareTransaction<C extends EvmChain>(
  draft: DraftTx<C>,
  input: { nonce: Nonce<C>; gas: Gas; fees: FeeModel },
): PreparedTx<C> {
  if (input.nonce.chain.id !== draft.intent.chain.id) {
    txError("ES3104", "ChainMismatch", "Transaction nonce was observed on a different chain.", {
      transactionChain: draft.intent.chain.name,
      nonceChain: input.nonce.chain.name,
    });
  }

  if (
    input.fees.type === "eip1559" &&
    (input.fees.maxPriorityFeePerGas as bigint) > (input.fees.maxFeePerGas as bigint)
  ) {
    txError("ES3420", "InvalidFeeModel", "maxPriorityFeePerGas cannot exceed maxFeePerGas.");
  }

  validateAuthorizationList(draft, input.nonce, input.fees);
  return { state: "prepared", intent: draft.intent, nonce: input.nonce, gas: input.gas, fees: input.fees };
}

export function recordSimulation<C extends EvmChain>(
  prepared: PreparedTx<C>,
  evidence: SimulationEvidence,
): SimulatedTx<C>;
export function recordSimulation<C extends EvmChain>(
  prepared: PreparedTx<C>,
  evidence: SimulationFailureEvidence,
): SimulationFailedTx<C>;
export function recordSimulation<C extends EvmChain>(
  prepared: PreparedTx<C>,
  evidence: SimulationEvidence | SimulationFailureEvidence,
): SimulatedTx<C> | SimulationFailedTx<C> {
  if (evidence.status === "failure") {
    return { ...prepared, state: "simulation-failed", simulation: evidence };
  }
  return { ...prepared, state: "simulated", simulation: evidence };
}

export function signSimulated<C extends EvmChain>(simulated: SimulatedTx<C>, rawTransaction: Hex): SignedTx<C> {
  if (!/^0x[0-9a-fA-F]+$/.test(rawTransaction) || rawTransaction.length % 2 !== 0) {
    txError("ES3430", "InvalidRawTransaction", "Signed transaction must be whole-byte 0x-prefixed hexadecimal.");
  }
  return { ...simulated, state: "signed", rawTransaction };
}

export function markBroadcast<C extends EvmChain>(
  signed: SignedTx<C>,
  hashValue: string,
  broadcastAt = Date.now(),
): BroadcastTx<C> {
  return {
    ...signed,
    state: "broadcast",
    hash: transactionHash(hashValue, signed.intent.chain),
    broadcastAt,
  };
}

export function markPending<C extends EvmChain>(broadcast: BroadcastTx<C>, pendingSince = Date.now()): PendingTx<C> {
  return { ...broadcast, state: "pending", pendingSince };
}

export function markIncluded<C extends EvmChain>(
  source: BroadcastTx<C> | PendingTx<C>,
  receipt: {
    transactionHash: string;
    blockHash: string;
    blockNumber: bigint;
    status: "success" | "reverted";
    gasUsed: bigint;
    effectiveGasPrice?: bigint;
  },
): IncludedTx<C> {
  const txHash = transactionHash(receipt.transactionHash, source.intent.chain);
  if (txHash.toLowerCase() !== source.hash.toLowerCase()) {
    txError("ES3431", "ReceiptHashMismatch", "Receipt transaction hash does not match the broadcast transaction.", {
      broadcastHash: source.hash,
      receiptHash: txHash,
    });
  }

  return {
    ...source,
    state: "included",
    ...(source.state === "pending" ? { pendingSince: source.pendingSince } : {}),
    receipt: {
      transactionHash: txHash,
      blockHash: blockHash(receipt.blockHash, source.intent.chain),
      blockNumber: receipt.blockNumber,
      status: receipt.status,
      gasUsed: receipt.gasUsed,
      ...(receipt.effectiveGasPrice !== undefined ? { effectiveGasPrice: receipt.effectiveGasPrice } : {}),
    },
  };
}

export function markConfirmed<C extends EvmChain, N extends number>(
  included: IncludedTx<C>,
  confirmations: N,
): ConfirmedTx<C, N> {
  if (included.receipt.status !== "success") {
    txError("ES3432", "TransactionReverted", "A reverted transaction cannot be promoted to Confirmed.");
  }
  if (!Number.isSafeInteger(confirmations) || confirmations < 1) {
    txError("ES3433", "InvalidConfirmationCount", "Confirmations must be a positive safe integer.", { confirmations });
  }
  return { ...included, state: "confirmed", confirmations };
}

export function markFinalized<C extends EvmChain>(confirmed: ConfirmedTx<C, number>): FinalizedTx<C> {
  return { ...confirmed, state: "finalized" };
}

export function markReplaced<C extends EvmChain>(
  original: BroadcastTx<C> | PendingTx<C>,
  replacementHashValue: string,
  reason: ReplacementReason,
): ReplacedTx<C> {
  return {
    state: "replaced",
    original,
    replacementHash: transactionHash(replacementHashValue, original.intent.chain),
    reason,
  };
}
