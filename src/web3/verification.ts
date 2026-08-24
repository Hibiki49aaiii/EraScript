import { keccak256, stringToHex } from "viem";
import { EraDiagnosticError } from "../diagnostics.js";
import type { SimulatedFlashbotsBundle } from "./flashbots.js";
import { assertRescueFinalState, type BalanceSnapshot, type RescueWorkflow } from "./workflow.js";
import type { EvmChain, Hash } from "./types.js";

export type RescueVerificationState = "NOT_READY" | "READY_FOR_BROADCAST" | "VERIFIED_RECOVERY";
export type VerificationCheckStatus = "pass" | "fail" | "warning";

export interface VerificationCheck {
  readonly id: string;
  readonly status: VerificationCheckStatus;
  readonly message: string;
  readonly details?: Record<string, string | number | boolean | null>;
}

export interface RescueVerificationReport<C extends EvmChain = EvmChain> {
  readonly kind: "rescue-verification-report";
  readonly chain: C;
  readonly state: RescueVerificationState;
  readonly reportHash: Hash<"keccak256">;
  readonly checks: readonly VerificationCheck[];
  readonly readyForBroadcast: boolean;
  readonly verifiedRecovery: boolean;
}

export interface RescuePlanVerificationOptions<C extends EvmChain> {
  readonly workflow: RescueWorkflow<C>;
  readonly currentBlock: bigint;
  readonly atomic?: boolean;
  readonly flashbots?: SimulatedFlashbotsBundle<C>;
  readonly allowStateOverrideSimulation?: boolean;
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

function check(id: string, status: VerificationCheckStatus, message: string, details?: VerificationCheck["details"]): VerificationCheck {
  return { id, status, message, ...(details ? { details } : {}) };
}

function stableReportHash<C extends EvmChain>(chain: C, state: RescueVerificationState, checks: readonly VerificationCheck[]): Hash<"keccak256"> {
  const normalized = JSON.stringify({
    chainId: chain.id,
    state,
    checks: checks.map((entry) => ({ id: entry.id, status: entry.status, message: entry.message, details: entry.details ?? null })),
  });
  return keccak256(stringToHex(normalized)) as Hash<"keccak256">;
}

function report<C extends EvmChain>(chain: C, state: RescueVerificationState, checks: readonly VerificationCheck[]): RescueVerificationReport<C> {
  return {
    kind: "rescue-verification-report",
    chain,
    state,
    reportHash: stableReportHash(chain, state, checks),
    checks,
    readyForBroadcast: state === "READY_FOR_BROADCAST" || state === "VERIFIED_RECOVERY",
    verifiedRecovery: state === "VERIFIED_RECOVERY",
  };
}

function sameRawTransactionSet<C extends EvmChain>(workflow: RescueWorkflow<C>, bundle: SimulatedFlashbotsBundle<C>): boolean {
  const graph = workflow.graph.ordered.map((node) => node.tx.rawTransaction.toLowerCase());
  const bundled = bundle.transactions.map((tx) => tx.rawTransaction.toLowerCase());
  return graph.length === bundled.length && graph.every((raw, index) => raw === bundled[index]);
}

export function verifyRescuePlan<C extends EvmChain>(options: RescuePlanVerificationOptions<C>): RescueVerificationReport<C> {
  const { workflow } = options;
  const checks: VerificationCheck[] = [];
  const atomic = options.atomic ?? true;
  const allowStateOverride = options.allowStateOverrideSimulation ?? false;

  checks.push(check(
    "graph.complete",
    "pass",
    "Rescue workflow passed graph construction and completeness checks.",
    { nodes: workflow.graph.nodes.length, assets: workflow.assets.length, nativeSweepRequired: workflow.requireNativeSweep },
  ));

  const stateOverrideNodes = workflow.graph.ordered.filter((node) => node.tx.simulation.stateOverrides);
  if (stateOverrideNodes.length > 0 && !allowStateOverride) {
    checks.push(check(
      "simulation.real-state",
      "fail",
      "One or more signed workflow transactions rely on state-override simulation evidence.",
      { count: stateOverrideNodes.length },
    ));
  } else {
    checks.push(check(
      "simulation.real-state",
      stateOverrideNodes.length > 0 ? "warning" : "pass",
      stateOverrideNodes.length > 0
        ? "State-override simulation was explicitly allowed by verification policy."
        : "Workflow transactions use non-state-override simulation evidence.",
      { count: stateOverrideNodes.length },
    ));
  }

  const unanchoredNodes = workflow.graph.ordered.filter((node) => node.tx.simulation.blockNumber === undefined || node.tx.simulation.blockHash === undefined);
  if (unanchoredNodes.length > 0) {
    checks.push(check("simulation.anchored", "fail", "One or more transaction simulations are not anchored to a concrete block number and hash.", { count: unanchoredNodes.length }));
  } else {
    checks.push(check("simulation.anchored", "pass", "All transaction simulations are block-anchored.", { count: workflow.graph.ordered.length }));
  }

  const simulationBlocks = new Set(workflow.graph.ordered.map((node) => node.tx.simulation.blockNumber?.toString() ?? "missing"));
  if (simulationBlocks.size > 1) {
    checks.push(check("simulation.common-state", "fail", "Workflow transaction simulations were produced from different block numbers.", { distinctBlocks: simulationBlocks.size }));
  } else {
    checks.push(check("simulation.common-state", "pass", "Workflow transaction simulations share one state block.", { block: [...simulationBlocks][0] ?? "unknown" }));
  }

  if (atomic) {
    if (!options.flashbots) {
      checks.push(check("atomic.bundle", "fail", "Atomic rescue policy requires a simulated Flashbots bundle containing the exact workflow transaction order."));
    } else {
      const bundle = options.flashbots;
      if (bundle.chain.id !== workflow.chain.id) {
        checks.push(check("atomic.bundle-chain", "fail", "Flashbots bundle is bound to a different chain.", { bundleChainId: bundle.chain.id, workflowChainId: workflow.chain.id }));
      } else {
        checks.push(check("atomic.bundle-chain", "pass", "Flashbots bundle chain matches the rescue workflow.", { chainId: workflow.chain.id }));
      }

      if (!sameRawTransactionSet(workflow, bundle)) {
        checks.push(check("atomic.bundle-order", "fail", "Flashbots bundle transactions do not exactly match the workflow's topological transaction order."));
      } else {
        checks.push(check("atomic.bundle-order", "pass", "Flashbots bundle exactly matches the workflow transaction order.", { transactions: bundle.transactions.length }));
      }

      if (bundle.stateBlock !== options.currentBlock) {
        checks.push(check("atomic.bundle-fresh", "fail", "Flashbots bundle simulation is stale relative to the current block.", { simulatedStateBlock: bundle.stateBlock.toString(), currentBlock: options.currentBlock.toString() }));
      } else if (bundle.targetBlock <= options.currentBlock) {
        checks.push(check("atomic.bundle-fresh", "fail", "Flashbots target block is no longer in the future.", { targetBlock: bundle.targetBlock.toString(), currentBlock: options.currentBlock.toString() }));
      } else {
        checks.push(check("atomic.bundle-fresh", "pass", "Flashbots simulation is bound to the current state block and a future target block.", { stateBlock: bundle.stateBlock.toString(), targetBlock: bundle.targetBlock.toString() }));
      }

      if (bundle.simulation.stateBlock !== bundle.stateBlock || bundle.simulation.targetBlock !== bundle.targetBlock) {
        checks.push(check("atomic.bundle-binding", "fail", "Flashbots simulation evidence is not bound to the bundle's current state/target pair."));
      } else {
        checks.push(check("atomic.bundle-binding", "pass", "Flashbots simulation evidence matches the bundle state/target pair."));
      }
    }
  } else {
    checks.push(check("atomic.bundle", "warning", "Atomic execution is disabled by verification policy."));
  }

  const failed = checks.some((entry) => entry.status === "fail");
  return report(workflow.chain, failed ? "NOT_READY" : "READY_FOR_BROADCAST", checks);
}

export function assertRescueReadyForBroadcast<C extends EvmChain>(options: RescuePlanVerificationOptions<C>): RescueVerificationReport<C> {
  const result = verifyRescuePlan(options);
  if (!result.readyForBroadcast) {
    fail("ES4040", "RescuePlanNotReady", "Rescue plan does not satisfy the configured pre-broadcast verification policy.", {
      reportHash: result.reportHash,
      failed: result.checks.filter((entry) => entry.status === "fail").map((entry) => entry.id),
    });
  }
  return result;
}

export function verifyCompletedRescue<C extends EvmChain>(input: {
  workflow: RescueWorkflow<C>;
  before: BalanceSnapshot<C>;
  after: BalanceSnapshot<C>;
  preBroadcastReport?: RescueVerificationReport<C>;
}): RescueVerificationReport<C> {
  const checks: VerificationCheck[] = [...(input.preBroadcastReport?.checks ?? [])];
  try {
    const finalState = assertRescueFinalState(input.workflow, input.before, input.after);
    checks.push(check("recovery.final-state", "pass", "Post-execution state satisfies all configured rescue invariants.", { invariants: finalState.results.length, afterBlock: input.after.blockNumber.toString() }));
    return report(input.workflow.chain, "VERIFIED_RECOVERY", checks);
  } catch (error) {
    if (!(error instanceof EraDiagnosticError)) throw error;
    checks.push(check("recovery.final-state", "fail", error.message));
    return report(input.workflow.chain, "NOT_READY", checks);
  }
}
