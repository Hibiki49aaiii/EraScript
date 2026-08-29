import { EraDiagnosticError } from "../diagnostics.js";
import { RailgunPrivacyOverlay } from "../chains/profiles.js";
import { assertEvmExecutionQuorumIntegrity, type EvmExecutionQuorum } from "../chains/evm-execution-quorum.js";
import type { RollupSettlementEvidence } from "../chains/rollup-finality.js";
import { createMultichainVerificationReport, multichainEvidenceRef, type MultichainVerificationCheck, type MultichainVerificationReport } from "../chains/verification.js";
import type { EvmChainProfile } from "../chains/types.js";
import type { ConfirmedTx, FinalizedTx, IncludedTx } from "../web3/tx.js";
import type { EvmChain } from "../web3/types.js";
import type { RailgunSubmittedTransaction } from "./railgun.js";

export interface RailgunPrivateStateAssertion {
  readonly id: string;
  readonly passed: boolean;
  readonly description: string;
}

export interface RailgunPrivateStateEvidence {
  readonly kind: "railgun-private-state-evidence";
  readonly proofBindingHash: string;
  readonly source: string;
  readonly observedAtMs: number;
  readonly assertions: readonly RailgunPrivateStateAssertion[];
}

type BaseEvmExecution<C extends EvmChain> = IncludedTx<C> | ConfirmedTx<C, number> | FinalizedTx<C>;

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}
function baseTransactionHash<C extends EvmChain>(transaction: BaseEvmExecution<C>): string {
  return transaction.receipt.transactionHash;
}

export function railgunPrivateStateEvidence(input: {
  proofBindingHash: string;
  source: string;
  assertions: readonly RailgunPrivateStateAssertion[];
  observedAtMs?: number;
}): RailgunPrivateStateEvidence {
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.proofBindingHash)) fail("ES4560", "InvalidRailgunPrivateStateBinding", "RAILGUN private-state evidence must bind a 32-byte proof hash.");
  if (!input.source) fail("ES4561", "MissingRailgunPrivateStateSource", "RAILGUN private-state evidence must identify the wallet/indexer/verification source.");
  if (input.assertions.length === 0) fail("ES4562", "MissingRailgunPrivateStateAssertions", "RAILGUN private-state evidence requires at least one explicit post-state assertion.");
  return { kind: "railgun-private-state-evidence", proofBindingHash: input.proofBindingHash, source: input.source, observedAtMs: input.observedAtMs ?? Date.now(), assertions: input.assertions };
}

export function railgunVerificationReport<C extends EvmChain>(input: {
  profile: EvmChainProfile;
  submission: RailgunSubmittedTransaction<C>;
  baseExecution?: BaseEvmExecution<C>;
  privateState?: RailgunPrivateStateEvidence;
}): MultichainVerificationReport {
  if (input.submission.chain.id !== input.profile.chainId) fail("ES4563", "RailgunBaseChainMismatch", "RAILGUN submission chain does not match the selected EVM chain profile.", { submissionChainId: input.submission.chain.id, profileChainId: input.profile.chainId });
  if (input.baseExecution && input.baseExecution.intent.chain.id !== input.submission.chain.id) fail("ES4563", "RailgunBaseChainMismatch", "Base EVM execution evidence belongs to another chain.", { submissionChainId: input.submission.chain.id, executionChainId: input.baseExecution.intent.chain.id });

  const checks: MultichainVerificationCheck[] = [
    { id: "railgun.proof-binding", status: "pass", message: "RAILGUN submission retains the proof binding generated for the selected transfer/gas/fee conditions." },
  ];

  if (input.baseExecution) {
    const observedHash = baseTransactionHash(input.baseExecution);
    if (input.submission.submissionId && input.submission.submissionId.toLowerCase() !== observedHash.toLowerCase()) {
      checks.push({ id: "railgun.base-transaction", status: "fail", message: "Base EVM execution hash does not match the RAILGUN submission ID.", details: { submissionId: input.submission.submissionId, observedHash } });
    } else if (input.baseExecution.receipt.status !== "success") {
      checks.push({ id: "railgun.base-transaction", status: "fail", message: "Base EVM transaction reverted." });
    } else {
      checks.push({ id: "railgun.base-transaction", status: "pass", message: `Base EVM transaction is ${input.baseExecution.state}.`, details: { blockNumber: input.baseExecution.receipt.blockNumber.toString() } });
    }
  } else {
    checks.push({ id: "railgun.base-transaction", status: "warning", message: "RAILGUN transaction was submitted, but no base EVM inclusion evidence is attached." });
  }

  if (input.privateState) {
    if (input.privateState.proofBindingHash.toLowerCase() !== input.submission.proof.proofBindingHash.toLowerCase()) {
      checks.push({ id: "railgun.private-state-binding", status: "fail", message: "Private-state evidence belongs to a different RAILGUN proof binding." });
    } else {
      const failed = input.privateState.assertions.filter((assertion) => !assertion.passed);
      checks.push({ id: "railgun.private-state", status: failed.length === 0 ? "pass" : "fail", message: failed.length === 0 ? "RAILGUN private-state assertions passed." : "One or more RAILGUN private-state assertions failed.", details: { assertions: input.privateState.assertions.length, failed: failed.length } });
    }
  } else {
    checks.push({ id: "railgun.private-state", status: "warning", message: "Base-chain execution alone does not prove the expected private wallet state; no private-state evidence is attached." });
  }

  const anyFail = checks.some((check) => check.status === "fail");
  const finalized = input.baseExecution?.state === "finalized";
  const privatePassed = input.privateState !== undefined && input.privateState.assertions.every((assertion) => assertion.passed) && input.privateState.proofBindingHash.toLowerCase() === input.submission.proof.proofBindingHash.toLowerCase();
  const baseObserved = input.baseExecution !== undefined && input.baseExecution.receipt.status === "success";
  const state = anyFail ? "NOT_READY" as const
    : finalized && privatePassed ? "VERIFIED_FINALITY" as const
    : baseObserved ? "EXECUTION_OBSERVED" as const
    : "READY_FOR_SUBMISSION" as const;

  return createMultichainVerificationReport({
    profile: input.profile,
    backend: input.submission.submission === "broadcaster" ? "railgun-broadcaster" : "railgun-self-submit",
    overlay: RailgunPrivacyOverlay,
    subject: `railgun:${input.submission.proof.proofBindingHash}`,
    state,
    checks,
    evidence: [
      multichainEvidenceRef("railgun-submission", input.submission, input.submission.submission),
      ...(input.baseExecution ? [multichainEvidenceRef("evm-base-execution", input.baseExecution, "viem")] : []),
      ...(input.privateState ? [multichainEvidenceRef("railgun-private-state", input.privateState, input.privateState.source)] : []),
    ],
  });
}


export function railgunVerificationReportWithEvmQuorum<C extends EvmChain>(input: {
  profile: EvmChainProfile;
  submission: RailgunSubmittedTransaction<C>;
  baseExecution: BaseEvmExecution<C>;
  baseQuorum: EvmExecutionQuorum<C>;
  privateState: RailgunPrivateStateEvidence;
  settlement?: RollupSettlementEvidence;
}): MultichainVerificationReport {
  assertEvmExecutionQuorumIntegrity(input.baseQuorum);

  const txHash = input.baseExecution.receipt.transactionHash;
  if (
    input.submission.chain.id !== input.profile.chainId
    || input.baseExecution.intent.chain.id !== input.profile.chainId
    || input.baseQuorum.profileId !== input.profile.id
    || input.baseQuorum.chainId !== input.profile.chainId
    || input.baseQuorum.transactionHash.toLowerCase() !== txHash.toLowerCase()
    || input.baseQuorum.receipt.transactionHash.toLowerCase() !== txHash.toLowerCase()
    || input.baseQuorum.receipt.blockNumber !== input.baseExecution.receipt.blockNumber
    || input.baseQuorum.receipt.blockHash.toLowerCase() !== input.baseExecution.receipt.blockHash.toLowerCase()
  ) {
    fail("ES4802", "RailgunEvmQuorumMismatch", "RAILGUN strict verification received base EVM quorum evidence for a different chain/transaction/block.", {
      profileId: input.profile.id,
      profileChainId: input.profile.chainId,
      submissionChainId: input.submission.chain.id,
      executionChainId: input.baseExecution.intent.chain.id,
      quorumProfileId: input.baseQuorum.profileId,
      quorumChainId: input.baseQuorum.chainId,
      executionTransactionHash: txHash,
      quorumTransactionHash: input.baseQuorum.transactionHash,
    });
  }
  if (
    input.submission.submissionId
    && input.submission.submissionId.toLowerCase() !== txHash.toLowerCase()
  ) {
    fail("ES4802", "RailgunEvmQuorumMismatch", "RAILGUN submission ID does not match the strict base EVM quorum transaction.", {
      submissionId: input.submission.submissionId,
      transactionHash: txHash,
    });
  }
  if (
    input.baseQuorum.stage !== "finalized"
    || input.baseQuorum.receipt.status !== "success"
    || input.baseExecution.receipt.status !== "success"
  ) {
    fail("ES4803", "RailgunEvmQuorumMissing", "RAILGUN strict verification requires a successful finalized EVM execution quorum.", {
      quorumStage: input.baseQuorum.stage,
      quorumReceiptStatus: input.baseQuorum.receipt.status,
      executionReceiptStatus: input.baseExecution.receipt.status,
    });
  }

  if (
    input.privateState.proofBindingHash.toLowerCase()
    !== input.submission.proof.proofBindingHash.toLowerCase()
  ) {
    fail("ES4560", "InvalidRailgunPrivateStateBinding", "RAILGUN private-state evidence belongs to a different proof binding.");
  }
  const failedPrivate = input.privateState.assertions.filter((assertion) => !assertion.passed);
  if (failedPrivate.length > 0) {
    fail("ES4562", "MissingRailgunPrivateStateAssertions", "RAILGUN strict verification requires all proof-bound private-state assertions to pass.", {
      assertions: input.privateState.assertions.length,
      failed: failedPrivate.length,
    });
  }

  let rollupFinal = true;
  const checks: MultichainVerificationCheck[] = [
    {
      id: "railgun.evm-quorum",
      status: "pass",
      message: `Base EVM transaction is finalized by a strict ${input.baseQuorum.providerIds.length}-provider quorum.`,
      details: {
        transactionHash: txHash,
        quorumHash: input.baseQuorum.quorumHash,
        scope: input.baseQuorum.scope,
      },
    },
    {
      id: "railgun.private-state",
      status: "pass",
      message: "Proof-bound RAILGUN private-state assertions passed.",
      details: {
        assertions: input.privateState.assertions.length,
        proofBindingHash: input.privateState.proofBindingHash,
      },
    },
  ];

  if (input.profile.finality.kind === "evm-rollup") {
    const settlement = input.settlement;
    const matching = settlement
      && settlement.profileId === input.profile.id
      && settlement.l2TransactionHash.toLowerCase() === txHash.toLowerCase()
      && settlement.l2BlockNumber === input.baseExecution.receipt.blockNumber
      && settlement.l2BlockHash.toLowerCase() === input.baseExecution.receipt.blockHash.toLowerCase();
    rollupFinal = Boolean(matching && settlement?.stage === "l1-finalized");
    checks.push({
      id: "railgun.rollup-settlement",
      status: rollupFinal ? "pass" : "warning",
      message: rollupFinal
        ? "Base rollup transaction has protocol-specific L1-finalized settlement evidence."
        : "EVM quorum proves L2 execution only; protocol-specific L1-finalized settlement is still required.",
      ...(settlement ? {
        details: {
          settlementStage: settlement.stage,
          protocol: settlement.protocol,
        },
      } : {}),
    });
  } else if (input.settlement) {
    fail("ES4802", "RailgunEvmQuorumMismatch", "Rollup settlement evidence was supplied for a non-rollup RAILGUN base chain.");
  }

  return createMultichainVerificationReport({
    profile: input.profile,
    backend: input.submission.submission === "broadcaster"
      ? "railgun-broadcaster"
      : "railgun-self-submit",
    overlay: RailgunPrivacyOverlay,
    subject: `railgun:${input.submission.proof.proofBindingHash}`,
    state: rollupFinal ? "VERIFIED_FINALITY" : "EXECUTION_OBSERVED",
    checks,
    evidence: [
      multichainEvidenceRef("railgun-submission", input.submission, input.submission.submission),
      multichainEvidenceRef("evm-base-execution", input.baseExecution, "viem"),
      multichainEvidenceRef("evm-execution-quorum", input.baseQuorum, "multi-rpc"),
      multichainEvidenceRef("railgun-private-state", input.privateState, input.privateState.source),
      ...(input.settlement
        ? [multichainEvidenceRef("rollup-settlement", input.settlement, input.settlement.adapter)]
        : []),
    ],
  });
}
