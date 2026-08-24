import { EraDiagnosticError } from "../diagnostics.js";
import { assertSameToken, sameToken, tokenAmountRaw, type TokenAmount, type TokenDefinition } from "./token.js";
import type { SignedTx } from "./tx.js";
import type { Address, BlockHash, EvmChain } from "./types.js";
import { unwrapWei, wei, type Wei } from "./values.js";

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export type WorkflowAction<C extends EvmChain = EvmChain> =
  | { readonly kind: "fund"; readonly from: Address<C>; readonly to: Address<C> }
  | { readonly kind: "claim"; readonly signer: Address<C>; readonly contract: Address<C> }
  | { readonly kind: "token-rescue"; readonly token: TokenDefinition<string, C, number>; readonly from: Address<C>; readonly to: Address<C> }
  | { readonly kind: "native-sweep"; readonly from: Address<C>; readonly to: Address<C> }
  | { readonly kind: "custom"; readonly label: string };

export interface WorkflowNode<C extends EvmChain = EvmChain> {
  readonly id: string;
  readonly tx: SignedTx<C>;
  readonly action: WorkflowAction<C>;
  readonly dependsOn?: readonly string[];
}

export interface TransactionGraph<C extends EvmChain = EvmChain> {
  readonly kind: "transaction-graph";
  readonly chain: C;
  readonly nodes: readonly WorkflowNode<C>[];
  readonly ordered: readonly WorkflowNode<C>[];
}

function assertActionMatchesTransaction<C extends EvmChain>(node: WorkflowNode<C>): void {
  const from = node.tx.intent.from;
  const to = node.tx.intent.to;
  switch (node.action.kind) {
    case "fund":
      if (!from || !sameAddress(from, node.action.from) || !to || !sameAddress(to, node.action.to)) fail("ES4001", "WorkflowActionMismatch", "Funding action metadata does not match transaction from/to.", { node: node.id });
      break;
    case "claim":
      if (!from || !sameAddress(from, node.action.signer) || !to || !sameAddress(to, node.action.contract)) fail("ES4001", "WorkflowActionMismatch", "Claim action metadata does not match transaction signer/contract.", { node: node.id });
      break;
    case "token-rescue":
      if (!from || !sameAddress(from, node.action.from) || !to || !sameAddress(to, node.action.token.address)) fail("ES4001", "WorkflowActionMismatch", "Token-rescue transaction must be sent by the declared source wallet to the declared token contract.", { node: node.id, token: node.action.token.symbol });
      break;
    case "native-sweep":
      if (!from || !sameAddress(from, node.action.from) || !to || !sameAddress(to, node.action.to)) fail("ES4001", "WorkflowActionMismatch", "Native-sweep action metadata does not match transaction from/to.", { node: node.id });
      break;
    case "custom":
      break;
  }
}

export function defineTransactionGraph<C extends EvmChain>(chain: C, nodes: readonly WorkflowNode<C>[]): TransactionGraph<C> {
  if (nodes.length === 0) fail("ES4002", "EmptyTransactionGraph", "Transaction graph must contain at least one node.");
  const byId = new Map<string, WorkflowNode<C>>();
  for (const node of nodes) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(node.id)) fail("ES4003", "InvalidWorkflowNodeId", "Workflow node IDs must be stable identifier-like strings.", { id: node.id });
    if (byId.has(node.id)) fail("ES4004", "DuplicateWorkflowNodeId", "Transaction graph contains duplicate node IDs.", { id: node.id });
    if (node.tx.intent.chain.id !== chain.id) fail("ES3104", "ChainMismatch", "Transaction graph contains a transaction from another chain.", { node: node.id, graphChain: chain.id, transactionChain: node.tx.intent.chain.id });
    assertActionMatchesTransaction(node);
    byId.set(node.id, node);
  }
  for (const node of nodes) {
    for (const dependency of node.dependsOn ?? []) {
      if (!byId.has(dependency)) fail("ES4005", "MissingWorkflowDependency", "Transaction graph references a dependency that does not exist.", { node: node.id, dependency });
      if (dependency === node.id) fail("ES4006", "WorkflowCycle", "Transaction node cannot depend on itself.", { node: node.id });
    }
  }

  const ordered: WorkflowNode<C>[] = [];
  const temporary = new Set<string>();
  const permanent = new Set<string>();
  const visit = (id: string): void => {
    if (permanent.has(id)) return;
    if (temporary.has(id)) fail("ES4006", "WorkflowCycle", "Transaction graph contains a dependency cycle.", { node: id });
    temporary.add(id);
    const node = byId.get(id)!;
    for (const dependency of node.dependsOn ?? []) visit(dependency);
    temporary.delete(id);
    permanent.add(id);
    ordered.push(node);
  };
  for (const node of nodes) visit(node.id);

  const isAncestor = (ancestor: string, node: WorkflowNode<C>, seen = new Set<string>()): boolean => {
    if (seen.has(node.id)) return false;
    seen.add(node.id);
    for (const dependency of node.dependsOn ?? []) {
      if (dependency === ancestor) return true;
      if (isAncestor(ancestor, byId.get(dependency)!, seen)) return true;
    }
    return false;
  };

  const bySender = new Map<string, WorkflowNode<C>[]>();
  for (const node of ordered) {
    if (!node.tx.intent.from) continue;
    const key = node.tx.intent.from.toLowerCase();
    const list = bySender.get(key) ?? [];
    list.push(node);
    bySender.set(key, list);
  }
  for (const [sender, list] of bySender) {
    const nonceOrder = [...list].sort((a, b) => a.tx.nonce.value - b.tx.nonce.value);
    for (let i = 1; i < nonceOrder.length; i += 1) {
      const previous = nonceOrder[i - 1]!;
      const current = nonceOrder[i]!;
      if (current.tx.nonce.value !== previous.tx.nonce.value + 1) fail("ES4007", "WorkflowNonceGap", "Same-sender transactions in the workflow are not nonce-contiguous.", { sender, previous: previous.id, current: current.id, previousNonce: previous.tx.nonce.value, nonce: current.tx.nonce.value });
      if (!isAncestor(previous.id, current)) fail("ES4008", "MissingNonceDependency", "A later nonce transaction must explicitly depend on the preceding nonce transaction.", { sender, previous: previous.id, current: current.id });
    }
  }

  return { kind: "transaction-graph", chain, nodes, ordered };
}

export interface RescueWorkflow<C extends EvmChain = EvmChain> {
  readonly kind: "rescue-workflow";
  readonly chain: C;
  readonly victim: Address<C>;
  readonly safe: Address<C>;
  readonly assets: readonly TokenDefinition<string, C, number>[];
  readonly graph: TransactionGraph<C>;
  readonly requireNativeSweep: boolean;
  readonly nativeDustLimit: Wei;
  readonly expectedRecoveries: readonly TokenAmount[];
}

export function defineRescueWorkflow<C extends EvmChain>(input: {
  chain: C;
  victim: Address<C>;
  safe: Address<C>;
  assets: readonly TokenDefinition<string, C, number>[];
  graph: TransactionGraph<C>;
  requireNativeSweep?: boolean;
  nativeDustLimit?: Wei;
  expectedRecoveries?: readonly TokenAmount[];
}): RescueWorkflow<C> {
  if (input.graph.chain.id !== input.chain.id) fail("ES3104", "ChainMismatch", "Rescue workflow and transaction graph are bound to different chains.");
  const requireNativeSweep = input.requireNativeSweep ?? true;
  const nativeDustLimit = input.nativeDustLimit ?? wei(0n);

  for (const asset of input.assets) {
    if (asset.chain.id !== input.chain.id) fail("ES3104", "ChainMismatch", "Rescue asset is defined on another chain.", { token: asset.symbol });
    const rescueNode = input.graph.nodes.find((node) => node.action.kind === "token-rescue" && sameToken(node.action.token, asset) && sameAddress(node.action.from, input.victim) && sameAddress(node.action.to, input.safe));
    if (!rescueNode) fail("ES4010", "MissingTokenRescueStep", "Rescue workflow does not contain a victim-to-safe token rescue step for every declared asset.", { token: asset.symbol, tokenAddress: asset.address });
  }

  if (requireNativeSweep) {
    const sweep = input.graph.nodes.find((node) => node.action.kind === "native-sweep" && sameAddress(node.action.from, input.victim) && sameAddress(node.action.to, input.safe));
    if (!sweep) fail("ES4011", "MissingNativeSweepStep", "Rescue workflow requires a victim-to-safe native sweep but no such transaction exists.", {
      suggestion: "Add the final native-balance recovery transaction or explicitly disable requireNativeSweep for a justified workflow.",
    });
  }

  const expectedRecoveries = input.expectedRecoveries ?? [];
  for (const expected of expectedRecoveries) {
    if (!input.assets.some((asset) => sameToken(asset, expected.token))) fail("ES4012", "UnexpectedRecoveryAsset", "Expected recovery amount references an asset not declared in this rescue workflow.", { token: expected.token.symbol });
  }

  return { kind: "rescue-workflow", chain: input.chain, victim: input.victim, safe: input.safe, assets: input.assets, graph: input.graph, requireNativeSweep, nativeDustLimit, expectedRecoveries };
}

export interface NativeBalance<C extends EvmChain = EvmChain> {
  readonly account: Address<C>;
  readonly balance: Wei;
}

export interface TokenBalance<C extends EvmChain = EvmChain> {
  readonly account: Address<C>;
  readonly token: TokenDefinition<string, C, number>;
  readonly balance: TokenAmount;
}

export interface BalanceSnapshot<C extends EvmChain = EvmChain> {
  readonly kind: "balance-snapshot";
  readonly chain: C;
  readonly blockNumber: bigint;
  readonly blockHash?: BlockHash<C>;
  readonly native: readonly NativeBalance<C>[];
  readonly tokens: readonly TokenBalance<C>[];
}

export function balanceSnapshot<C extends EvmChain>(input: Omit<BalanceSnapshot<C>, "kind">): BalanceSnapshot<C> {
  for (const entry of input.tokens) {
    if (entry.token.chain.id !== input.chain.id) fail("ES3104", "ChainMismatch", "Token balance snapshot contains another chain's token.", { token: entry.token.symbol });
    assertSameToken(entry.token, entry.balance.token);
  }
  return { kind: "balance-snapshot", ...input };
}

export type StateInvariant<C extends EvmChain = EvmChain> =
  | { readonly id: string; readonly type: "native-lte"; readonly account: Address<C>; readonly value: Wei }
  | { readonly id: string; readonly type: "token-eq"; readonly account: Address<C>; readonly value: TokenAmount }
  | { readonly id: string; readonly type: "token-delta-gte"; readonly account: Address<C>; readonly value: TokenAmount };

export interface InvariantResult {
  readonly id: string;
  readonly passed: boolean;
  readonly expected: string;
  readonly actual: string;
}

function nativeAt<C extends EvmChain>(snapshot: BalanceSnapshot<C>, account: Address<C>): Wei {
  const entry = snapshot.native.find((item) => sameAddress(item.account, account));
  if (!entry) fail("ES4020", "MissingSnapshotBalance", "Snapshot is missing a required native balance.", { account, blockNumber: snapshot.blockNumber.toString() });
  return entry.balance;
}

function tokenAt<C extends EvmChain>(snapshot: BalanceSnapshot<C>, account: Address<C>, token: TokenDefinition): TokenAmount {
  const entry = snapshot.tokens.find((item) => sameAddress(item.account, account) && sameToken(item.token, token));
  if (!entry) fail("ES4020", "MissingSnapshotBalance", "Snapshot is missing a required token balance.", { account, token: token.symbol, blockNumber: snapshot.blockNumber.toString() });
  return entry.balance;
}

export function verifyStateInvariants<C extends EvmChain>(before: BalanceSnapshot<C>, after: BalanceSnapshot<C>, invariants: readonly StateInvariant<C>[]): { readonly passed: boolean; readonly results: readonly InvariantResult[] } {
  if (before.chain.id !== after.chain.id) fail("ES3104", "ChainMismatch", "Before/after snapshots are from different chains.");
  if (after.blockNumber < before.blockNumber) fail("ES4021", "SnapshotOrderInvalid", "After snapshot predates before snapshot.", { before: before.blockNumber.toString(), after: after.blockNumber.toString() });

  const results = invariants.map((invariant): InvariantResult => {
    if (invariant.type === "native-lte") {
      const actual = unwrapWei(nativeAt(after, invariant.account));
      const expected = unwrapWei(invariant.value);
      return { id: invariant.id, passed: actual <= expected, expected: `<= ${expected} wei`, actual: `${actual} wei` };
    }
    if (invariant.type === "token-eq") {
      const actualAmount = tokenAt(after, invariant.account, invariant.value.token);
      assertSameToken(actualAmount.token, invariant.value.token);
      return { id: invariant.id, passed: actualAmount.raw === invariant.value.raw, expected: `== ${invariant.value.raw} raw ${invariant.value.token.symbol}`, actual: `${actualAmount.raw} raw ${actualAmount.token.symbol}` };
    }
    const beforeAmount = tokenAt(before, invariant.account, invariant.value.token);
    const afterAmount = tokenAt(after, invariant.account, invariant.value.token);
    assertSameToken(beforeAmount.token, invariant.value.token);
    assertSameToken(afterAmount.token, invariant.value.token);
    const delta = afterAmount.raw - beforeAmount.raw;
    return { id: invariant.id, passed: delta >= invariant.value.raw, expected: `delta >= ${invariant.value.raw} raw ${invariant.value.token.symbol}`, actual: `delta ${delta} raw ${invariant.value.token.symbol}` };
  });
  return { passed: results.every((result) => result.passed), results };
}

export function rescueFinalStateInvariants<C extends EvmChain>(workflow: RescueWorkflow<C>): StateInvariant<C>[] {
  const invariants: StateInvariant<C>[] = workflow.assets.map((token) => ({
    id: `victim-${token.symbol}-zero`,
    type: "token-eq" as const,
    account: workflow.victim,
    value: tokenAmountRaw(token, 0n),
  }));
  if (workflow.requireNativeSweep) invariants.push({ id: "victim-native-dust", type: "native-lte", account: workflow.victim, value: workflow.nativeDustLimit });
  for (const expected of workflow.expectedRecoveries) invariants.push({ id: `safe-${expected.token.symbol}-delta`, type: "token-delta-gte", account: workflow.safe, value: expected });
  return invariants;
}

export function assertRescueFinalState<C extends EvmChain>(workflow: RescueWorkflow<C>, before: BalanceSnapshot<C>, after: BalanceSnapshot<C>): { readonly passed: true; readonly results: readonly InvariantResult[] } {
  const verification = verifyStateInvariants(before, after, rescueFinalStateInvariants(workflow));
  if (!verification.passed) fail("ES4022", "RescueInvariantFailed", "Post-execution state does not satisfy the rescue workflow invariants.", { failed: verification.results.filter((result) => !result.passed) });
  return { passed: true, results: verification.results };
}
