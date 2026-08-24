import { EraDiagnosticError } from "../diagnostics.js";
import type { ForkSequenceEvidence } from "./fork.js";
import {
  verificationReportHash,
  verifyRescuePlan,
  type RescuePlanVerificationOptions,
  type RescueVerificationReport,
  type VerificationCheck,
} from "./verification.js";
import type { EvmChain } from "./types.js";

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

function check(id: string, status: "pass" | "fail" | "warning", message: string, details?: VerificationCheck["details"]): VerificationCheck {
  return { id, status, message, ...(details ? { details } : {}) };
}

function sameNodeSequence<C extends EvmChain>(options: RescuePlanVerificationOptions<C>, fork: ForkSequenceEvidence<C>): boolean {
  const expected = options.workflow.graph.ordered.map((node) => node.id);
  const actual = fork.executions.map((execution) => execution.nodeId);
  return expected.length === actual.length && expected.every((id, index) => id === actual[index]);
}

export function verifyRescuePlanWithFork<C extends EvmChain>(options: RescuePlanVerificationOptions<C> & {
  readonly fork: ForkSequenceEvidence<C>;
}): RescueVerificationReport<C> {
  const base = verifyRescuePlan(options);
  const checks: VerificationCheck[] = [...base.checks];
  const fork = options.fork;

  if (fork.chain.id !== options.workflow.chain.id) {
    checks.push(check("fork.chain", "fail", "Fork sequence evidence is bound to another chain.", { forkChainId: fork.chain.id, workflowChainId: options.workflow.chain.id }));
  } else {
    checks.push(check("fork.chain", "pass", "Fork sequence chain matches the rescue workflow.", { chainId: fork.chain.id }));
  }

  const firstSimulation = options.workflow.graph.ordered[0]?.tx.simulation;
  if (fork.forkBlockNumber !== options.currentBlock) {
    checks.push(check("fork.fresh", "fail", "Fork sequence was not based on the current public-chain block.", { forkBlock: fork.forkBlockNumber.toString(), currentBlock: options.currentBlock.toString() }));
  } else if (!firstSimulation?.blockHash || firstSimulation.blockNumber !== fork.forkBlockNumber || firstSimulation.blockHash.toLowerCase() !== fork.forkBlockHash.toLowerCase()) {
    checks.push(check("fork.anchor", "fail", "Fork base block does not match the workflow transaction simulation anchor.", { forkBlock: fork.forkBlockNumber.toString(), forkBlockHash: fork.forkBlockHash, simulationBlock: firstSimulation?.blockNumber?.toString() ?? null, simulationBlockHash: firstSimulation?.blockHash ?? null }));
  } else {
    checks.push(check("fork.anchor", "pass", "Fork sequence, public current block, and transaction simulations share one source block/hash.", { block: fork.forkBlockNumber.toString(), blockHash: fork.forkBlockHash }));
  }

  if (!sameNodeSequence(options, fork)) {
    checks.push(check("fork.order", "fail", "Fork execution sequence does not exactly match the rescue DAG topological order.", { executed: fork.executions.length, expected: options.workflow.graph.ordered.length }));
  } else {
    checks.push(check("fork.order", "pass", "Fork execution sequence exactly matches the rescue DAG order.", { transactions: fork.executions.length }));
  }

  checks.push(check(
    "fork.execution",
    fork.executionSucceeded ? "pass" : "fail",
    fork.executionSucceeded ? "Every signed workflow transaction executed successfully on the fork." : "One or more workflow transactions reverted or were not executed on the fork.",
    { evidenceHash: fork.evidenceHash },
  ));
  checks.push(check(
    "fork.invariants",
    fork.invariantsPassed ? "pass" : "fail",
    fork.invariantsPassed ? "Fork post-state satisfies the rescue final-state invariants." : "Fork post-state did not satisfy the rescue final-state invariants.",
    { evidenceHash: fork.evidenceHash },
  ));

  const state = checks.some((entry) => entry.status === "fail") ? "NOT_READY" as const : "READY_FOR_BROADCAST" as const;
  const unsafeBoundaries = base.unsafeBoundaries ?? [];
  return {
    kind: "rescue-verification-report",
    chain: options.workflow.chain,
    state,
    reportHash: verificationReportHash(options.workflow.chain, state, checks, unsafeBoundaries),
    checks,
    ...(unsafeBoundaries.length > 0 ? { unsafeBoundaries } : {}),
    readyForBroadcast: state === "READY_FOR_BROADCAST",
    recoveryObserved: false,
    verifiedRecovery: false,
  };
}

export function assertRescueReadyWithFork<C extends EvmChain>(options: RescuePlanVerificationOptions<C> & {
  readonly fork: ForkSequenceEvidence<C>;
}): RescueVerificationReport<C> {
  const report = verifyRescuePlanWithFork(options);
  if (!report.readyForBroadcast) fail("ES4077", "ForkVerifiedRescueNotReady", "Rescue plan failed the fork-enhanced broadcast-readiness gate.", { reportHash: report.reportHash, failed: report.checks.filter((entry) => entry.status === "fail").map((entry) => entry.id) });
  return report;
}
