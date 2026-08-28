import { EraDiagnosticError } from "../diagnostics.js";
import type { IncludedTx, ConfirmedTx, FinalizedTx } from "../web3/tx.js";
import type { EvmChain } from "../web3/types.js";
import type { JitoBundleStatusEvidence, JitoBundleSubmitted } from "./jito.js";
import type { RollupSettlementEvidence } from "./rollup-finality.js";
import type { SolanaSignatureStatusEvidence, SolanaSubmittedTransaction } from "./solana-adapter.js";
import type { SuiCheckpointEvidence, SuiExecutedTransaction, SuiExecutionFailedTransaction } from "./sui-adapter.js";
import type { EvmChainProfile, SolanaChainProfile, SuiChainProfile } from "./types.js";
import {
  createMultichainVerificationReport,
  multichainEvidenceRef,
  type MultichainVerificationCheck,
  type MultichainVerificationReport,
} from "./verification.js";

type EvmObservedTransaction<C extends EvmChain = EvmChain> = IncludedTx<C> | ConfirmedTx<C, number> | FinalizedTx<C>;

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

export function evmExecutionVerificationReport<C extends EvmChain>(profile: EvmChainProfile, transaction: EvmObservedTransaction<C>, settlement?: RollupSettlementEvidence): MultichainVerificationReport {
  if (transaction.intent.chain.id !== profile.chainId) fail("ES4640", "EvmVerificationProfileMismatch", "EVM verification transaction belongs to a different chain profile.", { transactionChainId: transaction.intent.chain.id, profileChainId: profile.chainId, profile: profile.id });
  const checks: MultichainVerificationCheck[] = [
    {
      id: "evm.receipt",
      status: transaction.receipt.status === "success" ? "pass" : "fail",
      message: transaction.receipt.status === "success" ? `EVM transaction is ${transaction.state} with a successful receipt.` : "EVM transaction receipt is reverted.",
      details: { blockNumber: transaction.receipt.blockNumber.toString(), transactionHash: transaction.receipt.transactionHash },
    },
  ];

  let state: "NOT_READY" | "EXECUTION_OBSERVED" | "VERIFIED_FINALITY" = transaction.receipt.status === "success" ? "EXECUTION_OBSERVED" : "NOT_READY";

  if (profile.finality.kind === "evm-rollup") {
    if (!settlement) {
      checks.push({ id: "evm.rollup-settlement", status: "warning", message: "L2 execution is observed, but protocol-specific L1 settlement evidence is not attached." });
    } else {
      const matching = settlement.profileId === profile.id
        && settlement.l2TransactionHash.toLowerCase() === transaction.receipt.transactionHash.toLowerCase()
        && settlement.l2BlockNumber === transaction.receipt.blockNumber
        && settlement.l2BlockHash.toLowerCase() === transaction.receipt.blockHash.toLowerCase();
      if (!matching) {
        checks.push({ id: "evm.rollup-settlement", status: "fail", message: "Rollup settlement evidence is not bound to this exact L2 transaction/block." });
        state = "NOT_READY";
      } else if (settlement.stage === "l1-finalized") {
        checks.push({ id: "evm.rollup-settlement", status: "pass", message: "Protocol-specific adapter reports the L2 transaction as L1-finalized.", details: { protocol: settlement.protocol, adapter: settlement.adapter, l1BlockNumber: settlement.l1Anchor?.blockNumber.toString() ?? null } });
        if (transaction.receipt.status === "success") state = "VERIFIED_FINALITY";
      } else {
        checks.push({ id: "evm.rollup-settlement", status: "warning", message: `Rollup settlement has reached '${settlement.stage}', but not L1 finalized settlement.`, details: { protocol: settlement.protocol, adapter: settlement.adapter } });
      }
    }
  } else {
    if (settlement) {
      checks.push({ id: "evm.rollup-settlement", status: "fail", message: "Rollup settlement evidence was supplied for a non-rollup EVM profile." });
      state = "NOT_READY";
    } else if (transaction.state === "finalized" && transaction.receipt.status === "success") {
      checks.push({ id: "evm.finality", status: "pass", message: "Transaction has reached the chain profile's finalized EVM state." });
      state = "VERIFIED_FINALITY";
    } else {
      checks.push({ id: "evm.finality", status: "warning", message: "Successful EVM execution is observed but has not reached the configured finalized state." });
    }
  }

  return createMultichainVerificationReport({
    profile,
    backend: "public-rpc",
    subject: `evm:${transaction.receipt.transactionHash}`,
    state,
    checks,
    evidence: [
      multichainEvidenceRef("evm-execution", transaction, "viem"),
      ...(settlement ? [multichainEvidenceRef("rollup-settlement", settlement, settlement.adapter)] : []),
    ],
  });
}

export function solanaSubmissionVerificationReport(profile: SolanaChainProfile, submitted: SolanaSubmittedTransaction, status?: SolanaSignatureStatusEvidence): MultichainVerificationReport {
  const lifetimeCheck: MultichainVerificationCheck = submitted.simulation.transaction.lifetimeKind === "recent-blockhash"
    ? {
        id: "solana.blockhash",
        status: "pass",
        message: "Transaction was submitted before its last valid block height.",
        details: {
          submittedAtBlockHeight: submitted.submittedAtBlockHeight.toString(),
          lastValidBlockHeight: submitted.simulation.transaction.recentBlockhash.lastValidBlockHeight.toString(),
        },
      }
    : {
        id: "solana.durable-nonce",
        status: "pass",
        message: "Durable nonce account was bound into the signed transaction and revalidated by the execution gate.",
        details: {
          nonceAccount: submitted.simulation.transaction.durableNonce.account.nonceAccount,
          nonce: submitted.simulation.transaction.durableNonce.account.nonce,
          bindingHash: submitted.simulation.transaction.durableNonce.bindingHash,
        },
      };
  const checks: MultichainVerificationCheck[] = [
    lifetimeCheck,
    { id: "solana.simulation", status: submitted.simulation.success ? "pass" : "fail", message: submitted.simulation.success ? "Signature-verified Solana simulation succeeded." : "Solana simulation failed." },
  ];
  if (!status || !status.found) checks.push({ id: "solana.execution", status: "warning", message: "Transaction signature has not yet been observed in RPC history." });
  else if (status.err !== undefined) checks.push({ id: "solana.execution", status: "fail", message: "Observed Solana transaction contains an execution error." });
  else checks.push({ id: "solana.execution", status: "pass", message: `Solana transaction observed at ${status.confirmationStatus ?? "unknown"} commitment.` });

  const state = !status || !status.found || status.err !== undefined
    ? (!status || !status.found ? "READY_FOR_SUBMISSION" as const : "NOT_READY" as const)
    : status.confirmationStatus === "finalized" ? "VERIFIED_FINALITY" as const : "EXECUTION_OBSERVED" as const;
  return createMultichainVerificationReport({
    profile,
    backend: "public-rpc",
    subject: `solana:${submitted.signature}`,
    state,
    checks,
    evidence: [
      multichainEvidenceRef("solana-submission", submitted, "@solana/kit"),
      ...(status ? [multichainEvidenceRef("solana-signature-status", status, "@solana/kit")] : []),
    ],
  });
}

export function jitoBundleVerificationReport(profile: SolanaChainProfile, submitted: JitoBundleSubmitted, status?: JitoBundleStatusEvidence): MultichainVerificationReport {
  const checks: MultichainVerificationCheck[] = [
    { id: "jito.bundle-binding", status: "pass", message: "Jito bundle submission is bound to the EraScript transaction set and tip evidence." },
  ];
  if (!status || !status.found) checks.push({ id: "jito.execution", status: "warning", message: "Jito bundle has not yet been observed through getBundleStatuses." });
  else if (status.err !== undefined) checks.push({ id: "jito.execution", status: "fail", message: "Jito bundle status contains an execution error." });
  else if (status.confirmationStatus === "finalized") checks.push({ id: "jito.execution", status: "pass", message: "Jito bundle transaction set is observed at finalized Solana commitment." });
  else checks.push({ id: "jito.execution", status: "warning", message: `Jito bundle is observed at ${status.confirmationStatus ?? "unknown"} commitment but is not finalized.` });

  const state = !status || !status.found
    ? "READY_FOR_SUBMISSION" as const
    : status.err !== undefined ? "NOT_READY" as const
    : status.confirmationStatus === "finalized" ? "VERIFIED_FINALITY" as const : "EXECUTION_OBSERVED" as const;
  return createMultichainVerificationReport({
    profile,
    backend: "jito-bundle",
    subject: `jito:${submitted.bundleId}`,
    state,
    checks,
    evidence: [multichainEvidenceRef("jito-submission", submitted, "Jito Block Engine"), ...(status ? [multichainEvidenceRef("jito-bundle-status", status, "Jito Block Engine")] : [])],
  });
}

export function suiExecutionVerificationReport(profile: SuiChainProfile, transaction: SuiExecutedTransaction | SuiExecutionFailedTransaction, checkpoint?: SuiCheckpointEvidence): MultichainVerificationReport {
  const failed = transaction.state === "sui-execution-failed";
  const checks: MultichainVerificationCheck[] = [
    { id: "sui.simulation", status: "pass", message: "Sui transaction passed checks-enabled simulation before signing/execution." },
    { id: "sui.execution", status: failed ? "fail" : "pass", message: failed ? `Sui execution failed: ${transaction.error}` : "Sui executeTransaction returned a successful Transaction result." },
  ];
  if (!failed) checks.push({ id: "sui.checkpoint", status: checkpoint ? "pass" : "warning", message: checkpoint ? `Sui transaction is included in checkpoint ${checkpoint.checkpoint}.` : "Successful Sui effects observed; checkpoint inclusion has not yet been recorded." });
  const state = failed ? "NOT_READY" as const : checkpoint ? "VERIFIED_FINALITY" as const : "EXECUTION_OBSERVED" as const;
  return createMultichainVerificationReport({
    profile,
    backend: "sui-rpc",
    subject: failed ? `sui-failed:${transaction.digest ?? "unknown"}` : `sui:${transaction.digest}`,
    state,
    checks,
    evidence: [multichainEvidenceRef("sui-execution", transaction, "@mysten/sui"), ...(checkpoint ? [multichainEvidenceRef("sui-checkpoint", checkpoint, "@mysten/sui")] : [])],
  });
}
