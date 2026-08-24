import type { JitoBundleStatusEvidence, JitoBundleSubmitted } from "./jito.js";
import type { SolanaSignatureStatusEvidence, SolanaSubmittedTransaction } from "./solana-adapter.js";
import type { SuiCheckpointEvidence, SuiExecutedTransaction, SuiExecutionFailedTransaction } from "./sui-adapter.js";
import type { SolanaChainProfile, SuiChainProfile } from "./types.js";
import { createMultichainVerificationReport, multichainEvidenceRef, type MultichainVerificationReport } from "./verification.js";

export function solanaSubmissionVerificationReport(profile: SolanaChainProfile, submitted: SolanaSubmittedTransaction, status?: SolanaSignatureStatusEvidence): MultichainVerificationReport {
  const checks = [
    { id: "solana.blockhash", status: "pass" as const, message: "Transaction was submitted before its last valid block height.", details: { submittedAtBlockHeight: submitted.submittedAtBlockHeight.toString(), lastValidBlockHeight: submitted.simulation.transaction.recentBlockhash.lastValidBlockHeight.toString() } },
    { id: "solana.simulation", status: submitted.simulation.success ? "pass" as const : "fail" as const, message: submitted.simulation.success ? "Signature-verified Solana simulation succeeded." : "Solana simulation failed." },
  ];
  if (!status || !status.found) checks.push({ id: "solana.execution", status: "warning" as const, message: "Transaction signature has not yet been observed in RPC history." });
  else if (status.err !== undefined) checks.push({ id: "solana.execution", status: "fail" as const, message: "Observed Solana transaction contains an execution error." });
  else checks.push({ id: "solana.execution", status: "pass" as const, message: `Solana transaction observed at ${status.confirmationStatus ?? "unknown"} commitment.` });

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
  const checks = [
    { id: "jito.bundle-binding", status: "pass" as const, message: "Jito bundle submission is bound to the EraScript transaction set and tip evidence." },
  ];
  if (!status || !status.found) checks.push({ id: "jito.execution", status: "warning" as const, message: "Jito bundle has not yet been observed through getBundleStatuses." });
  else if (status.err !== undefined) checks.push({ id: "jito.execution", status: "fail" as const, message: "Jito bundle status contains an execution error." });
  else if (status.confirmationStatus === "finalized") checks.push({ id: "jito.execution", status: "pass" as const, message: "Jito bundle transaction set is observed at finalized Solana commitment." });
  else checks.push({ id: "jito.execution", status: "warning" as const, message: `Jito bundle is observed at ${status.confirmationStatus ?? "unknown"} commitment but is not finalized.` });

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
  const checks = [
    { id: "sui.simulation", status: "pass" as const, message: "Sui transaction passed checks-enabled simulation before signing/execution." },
    { id: "sui.execution", status: failed ? "fail" as const : "pass" as const, message: failed ? `Sui execution failed: ${transaction.error}` : "Sui executeTransaction returned a successful Transaction result." },
    ...(!failed ? [{ id: "sui.checkpoint", status: checkpoint ? "pass" as const : "warning" as const, message: checkpoint ? `Sui transaction is included in checkpoint ${checkpoint.checkpoint}.` : "Successful Sui effects observed; checkpoint inclusion has not yet been recorded." }] : []),
  ];
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
