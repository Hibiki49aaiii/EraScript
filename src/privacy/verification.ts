import { EraDiagnosticError } from "../diagnostics.js";
import { RailgunPrivacyOverlay } from "../chains/profiles.js";
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
