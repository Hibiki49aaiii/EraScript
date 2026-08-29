import { EraDiagnosticError } from "../diagnostics.js";
import type { IncludedTx, ConfirmedTx, FinalizedTx } from "../web3/tx.js";
import type { EvmChain } from "../web3/types.js";
import type { JitoBundleStatusEvidence, JitoBundleSubmitted } from "./jito.js";
import type { RollupSettlementEvidence } from "./rollup-finality.js";
import type { SolanaSignatureStatusEvidence, SolanaSubmittedTransaction } from "./solana-adapter.js";
import { assertSolanaExecutionQuorumIntegrity, type SolanaExecutionQuorum } from "./solana-execution-quorum.js";
import type { SuiCheckpointEvidence, SuiExecutedTransaction, SuiExecutionFailedTransaction } from "./sui-adapter.js";
import { assertSuiExecutionQuorumIntegrity, type SuiExecutionQuorum } from "./sui-execution-quorum.js";
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


export function solanaQuorumVerificationReport(
  profile: SolanaChainProfile,
  submitted: SolanaSubmittedTransaction,
  quorum: SolanaExecutionQuorum,
): MultichainVerificationReport {
  assertSolanaExecutionQuorumIntegrity(quorum);
  if (
    quorum.profileId !== profile.id
    || quorum.network !== profile.network
    || quorum.signature !== submitted.signature
    || submitted.simulation.transaction.profileId !== profile.id
  ) {
    fail("ES4781", "SolanaQuorumProviderProfileMismatch", "Solana quorum/report binding does not match the submitted transaction/profile.", {
      profileId: profile.id,
      quorumProfileId: quorum.profileId,
      expectedSignature: submitted.signature,
      quorumSignature: quorum.signature,
    });
  }

  const finalized = quorum.stage === "finalized";
  return createMultichainVerificationReport({
    profile,
    backend: "public-rpc",
    subject: `solana:${submitted.signature}`,
    state: finalized ? "VERIFIED_FINALITY" : "EXECUTION_OBSERVED",
    checks: [
      {
        id: "solana.quorum",
        status: "pass",
        message: `Solana execution quorum passed across ${quorum.providerIds.length} providers.`,
        details: {
          providers: JSON.stringify(quorum.providerIds),
          slot: quorum.slot.toString(),
          stage: quorum.stage,
          quorumHash: quorum.quorumHash,
        },
      },
      {
        id: "solana.finality",
        status: finalized ? "pass" : "warning",
        message: finalized
          ? "Every Solana quorum provider reports finalized commitment for the same signature/slot."
          : "Solana quorum agrees on successful execution, but not every provider is finalized.",
      },
    ],
    evidence: [
      multichainEvidenceRef("solana-submission", submitted, "@solana/kit"),
      multichainEvidenceRef("solana-execution-quorum", quorum, "multi-rpc"),
    ],
  });
}

export function jitoBundleVerificationReportWithSolanaQuorum(
  profile: SolanaChainProfile,
  submitted: JitoBundleSubmitted,
  status: JitoBundleStatusEvidence,
  quorums: readonly SolanaExecutionQuorum[],
): MultichainVerificationReport {
  if (!submitted.expectedSignatures || submitted.expectedSignatures.length === 0) {
    fail("ES4801", "JitoSolanaQuorumMissing", "Strict Jito verification requires expected transaction signatures bound at bundle construction.");
  }
  if (!status.found || status.err !== undefined) {
    return createMultichainVerificationReport({
      profile,
      backend: "jito-bundle",
      subject: `jito:${submitted.bundleId}`,
      state: status.err !== undefined ? "NOT_READY" : "EXECUTION_OBSERVED",
      checks: [
        {
          id: "jito.backend-status",
          status: status.err !== undefined ? "fail" : "warning",
          message: status.err !== undefined
            ? "Jito backend reported bundle execution error."
            : "Jito bundle is not yet observable through getBundleStatuses.",
        },
        {
          id: "jito.solana-quorum",
          status: "warning",
          message: "Strict Solana quorum finality cannot be completed until the Jito transaction set is observed.",
        },
      ],
      evidence: [
        multichainEvidenceRef("jito-submission", submitted, "Jito Block Engine"),
        multichainEvidenceRef("jito-bundle-status", status, "Jito Block Engine"),
      ],
    });
  }

  const expected = submitted.expectedSignatures.map(String);
  const actual = status.transactions.map(String);
  if (
    expected.length !== actual.length
    || expected.some((signature, index) => signature !== actual[index])
  ) {
    fail("ES4800", "JitoSolanaQuorumMismatch", "Jito observed transaction set differs from the signatures bound to the submitted bundle.", {
      expected,
      actual,
    });
  }

  const expectedSignatureSet = new Set(
    submitted.expectedSignatures.map((signature) => String(signature)),
  );
  const bySignature = new Map<string, SolanaExecutionQuorum>();
  for (const quorum of quorums) {
    assertSolanaExecutionQuorumIntegrity(quorum);
    const signatureKey = String(quorum.signature);
    if (bySignature.has(signatureKey)) {
      fail("ES4800", "JitoSolanaQuorumMismatch", "Strict Jito verification received duplicate Solana quorum evidence for the same transaction signature.", {
        signature: signatureKey,
      });
    }
    if (quorum.profileId !== profile.id || quorum.network !== profile.network) {
      fail("ES4800", "JitoSolanaQuorumMismatch", "Solana quorum belongs to a different profile/network than the Jito bundle.", {
        quorumProfileId: quorum.profileId,
        profileId: profile.id,
        signature: quorum.signature,
      });
    }
    if (!expectedSignatureSet.has(signatureKey)) {
      fail("ES4800", "JitoSolanaQuorumMismatch", "Strict Jito verification received Solana quorum evidence for a signature that is not part of the submitted bundle.", {
        signature: signatureKey,
      });
    }
    if (status.slot !== undefined && quorum.slot !== status.slot) {
      fail("ES4800", "JitoSolanaQuorumMismatch", "Solana quorum slot differs from the Jito landed bundle slot.", {
        signature: quorum.signature,
        jitoSlot: status.slot.toString(),
        quorumSlot: quorum.slot.toString(),
      });
    }
    bySignature.set(signatureKey, quorum);
  }

  const bound = submitted.expectedSignatures.map((signature) => {
    const quorum = bySignature.get(String(signature));
    if (!quorum) {
      fail("ES4801", "JitoSolanaQuorumMissing", "Strict Jito verification is missing Solana quorum evidence for an expected transaction signature.", {
        signature,
      });
    }
    if (quorum.stage !== "finalized") {
      fail("ES4800", "JitoSolanaQuorumMismatch", "Strict Jito finality requires every expected transaction signature to have finalized Solana quorum evidence.", {
        signature,
        stage: quorum.stage,
      });
    }
    return quorum;
  });

  return createMultichainVerificationReport({
    profile,
    backend: "jito-bundle",
    subject: `jito:${submitted.bundleId}`,
    state: "VERIFIED_FINALITY",
    checks: [
      {
        id: "jito.bundle-binding",
        status: "pass",
        message: "Jito reported the exact transaction signature set bound by EraScript.",
      },
      {
        id: "jito.solana-quorum",
        status: "pass",
        message: "Every expected Jito transaction is independently finalized by a strict Solana multi-provider quorum.",
        details: {
          transactions: bound.length,
          quorumHashes: JSON.stringify(bound.map((quorum) => quorum.quorumHash)),
        },
      },
    ],
    evidence: [
      multichainEvidenceRef("jito-submission", submitted, "Jito Block Engine"),
      multichainEvidenceRef("jito-bundle-status", status, "Jito Block Engine"),
      ...bound.map((quorum) =>
        multichainEvidenceRef("solana-execution-quorum", quorum, "multi-rpc"),
      ),
    ],
  });
}

export function suiQuorumVerificationReport(
  profile: SuiChainProfile,
  transaction: SuiExecutedTransaction,
  quorum: SuiExecutionQuorum,
): MultichainVerificationReport {
  assertSuiExecutionQuorumIntegrity(quorum);
  if (
    quorum.profileId !== profile.id
    || quorum.network !== profile.network
    || quorum.digest !== transaction.digest
    || transaction.simulation.transaction.profileId !== profile.id
  ) {
    fail("ES4791", "SuiQuorumProviderProfileMismatch", "Sui quorum/report binding does not match the executed transaction/profile.", {
      profileId: profile.id,
      quorumProfileId: quorum.profileId,
      expectedDigest: transaction.digest,
      quorumDigest: quorum.digest,
    });
  }

  const checkpointed = quorum.stage === "checkpointed";
  return createMultichainVerificationReport({
    profile,
    backend: "sui-rpc",
    subject: `sui:${transaction.digest}`,
    state: checkpointed ? "VERIFIED_FINALITY" : "EXECUTION_OBSERVED",
    checks: [
      {
        id: "sui.quorum",
        status: "pass",
        message: `Sui execution quorum passed across ${quorum.providerIds.length} providers.`,
        details: {
          providers: JSON.stringify(quorum.providerIds),
          stage: quorum.stage,
          checkpoint: quorum.checkpoint?.toString() ?? null,
          quorumHash: quorum.quorumHash,
        },
      },
      {
        id: "sui.checkpoint",
        status: checkpointed ? "pass" : "warning",
        message: checkpointed
          ? "Every Sui quorum provider agrees on successful execution and checkpoint inclusion."
          : "Sui quorum agrees on execution but does not yet have required checkpoint finality.",
      },
    ],
    evidence: [
      multichainEvidenceRef("sui-execution", transaction, "@mysten/sui"),
      multichainEvidenceRef("sui-execution-quorum", quorum, "multi-core-api"),
    ],
  });
}
