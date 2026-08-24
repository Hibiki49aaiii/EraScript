import { createHash } from "node:crypto";
import { EraDiagnosticError } from "../diagnostics.js";
import type { EvmChain } from "../web3/types.js";
import { railgunPrivateStateEvidence, type RailgunPrivateStateEvidence } from "./verification.js";

export type RailgunBalanceBucket =
  | "Spendable"
  | "ShieldBlocked"
  | "ShieldPending"
  | "ProofSubmitted"
  | "MissingInternalPOI"
  | "MissingExternalPOI"
  | "Spent";

export interface RailgunPrivateTokenBalance {
  readonly token: `0x${string}`;
  readonly amount: bigint;
}

export interface RailgunPrivateBalanceSnapshot<C extends EvmChain = EvmChain> {
  readonly kind: "railgun-private-balance-snapshot";
  readonly chain: C;
  readonly walletId: string;
  readonly txidVersion: string;
  readonly balanceBucket: RailgunBalanceBucket;
  readonly balances: readonly RailgunPrivateTokenBalance[];
  readonly source: string;
  readonly observedAtMs: number;
  readonly snapshotHash: string;
}

export interface RailgunPrivateBalanceReader<C extends EvmChain = EvmChain> {
  readonly id: string;
  refresh(input: { readonly chain: C; readonly walletId: string }): Promise<void>;
  read(input: { readonly chain: C; readonly walletId: string; readonly txidVersion: string; readonly balanceBucket: RailgunBalanceBucket }): Promise<readonly { readonly token: string; readonly amount: bigint | string | number }[]>;
}

export interface RailgunPrivateBalanceExpectation {
  readonly id: string;
  readonly token: `0x${string}`;
  readonly minimumDelta?: bigint;
  readonly maximumDelta?: bigint;
  readonly expectedFinalAmount?: bigint;
  readonly description: string;
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}
function stable(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (typeof item === "bigint") return item.toString();
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, inner]) => [key, normalize(inner)]));
    return item;
  };
  return JSON.stringify(normalize(value));
}
function sha256(value: unknown): string {
  return `0x${createHash("sha256").update(stable(value)).digest("hex")}`;
}
function token(value: string, field = "token"): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) fail("ES4600", "InvalidRailgunPrivateBalanceToken", `RAILGUN ${field} must be a 20-byte EVM token address.`, { field, value });
  return value.toLowerCase() as `0x${string}`;
}
function amount(value: bigint | string | number, field: string): bigint {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  fail("ES4601", "InvalidRailgunPrivateBalanceAmount", `RAILGUN ${field} must be a non-negative exact integer.`, { field, value: String(value) });
}

export async function captureRailgunPrivateBalance<C extends EvmChain>(input: {
  reader: RailgunPrivateBalanceReader<C>;
  chain: C;
  walletId: string;
  txidVersion: string;
  balanceBucket?: RailgunBalanceBucket;
  refresh?: boolean;
  observedAtMs?: number;
}): Promise<RailgunPrivateBalanceSnapshot<C>> {
  if (!input.walletId) fail("ES4602", "MissingRailgunPrivateWalletId", "RAILGUN private balance snapshot requires a wallet ID.");
  if (!input.txidVersion) fail("ES4603", "MissingRailgunPrivateTxidVersion", "RAILGUN private balance snapshot requires an explicit TXID version.");
  const balanceBucket = input.balanceBucket ?? "Spendable";
  if (input.refresh ?? true) await input.reader.refresh({ chain: input.chain, walletId: input.walletId });
  const raw = await input.reader.read({ chain: input.chain, walletId: input.walletId, txidVersion: input.txidVersion, balanceBucket });
  const byToken = new Map<string, bigint>();
  for (const [index, row] of raw.entries()) {
    const normalizedToken = token(row.token, `balances[${index}].token`);
    const normalizedAmount = amount(row.amount, `balances[${index}].amount`);
    byToken.set(normalizedToken, (byToken.get(normalizedToken) ?? 0n) + normalizedAmount);
  }
  const balances = [...byToken.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([tokenAddress, tokenAmount]) => ({ token: tokenAddress as `0x${string}`, amount: tokenAmount }));
  const core = { chainId: input.chain.id, walletId: input.walletId, txidVersion: input.txidVersion, balanceBucket, balances, source: input.reader.id, observedAtMs: input.observedAtMs ?? Date.now() };
  return { kind: "railgun-private-balance-snapshot", chain: input.chain, walletId: input.walletId, txidVersion: input.txidVersion, balanceBucket, balances, source: input.reader.id, observedAtMs: core.observedAtMs, snapshotHash: sha256(core) };
}

function balanceOf(snapshot: RailgunPrivateBalanceSnapshot, tokenAddress: `0x${string}`): bigint {
  return snapshot.balances.find((entry) => entry.token === tokenAddress)?.amount ?? 0n;
}

export function verifyRailgunPrivateBalanceChanges(input: {
  proofBindingHash: string;
  before: RailgunPrivateBalanceSnapshot;
  after: RailgunPrivateBalanceSnapshot;
  expectations: readonly RailgunPrivateBalanceExpectation[];
  source?: string;
}): RailgunPrivateStateEvidence {
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.proofBindingHash)) fail("ES4604", "InvalidRailgunProofBinding", "RAILGUN private balance verification requires a 32-byte proof binding hash.");
  if (input.before.chain.id !== input.after.chain.id || input.before.walletId !== input.after.walletId || input.before.txidVersion !== input.after.txidVersion || input.before.balanceBucket !== input.after.balanceBucket) fail("ES4605", "RailgunPrivateSnapshotMismatch", "Before/after RAILGUN private balance snapshots must describe the same chain, wallet, TXID version and balance bucket.", { before: input.before.snapshotHash, after: input.after.snapshotHash });
  if (input.after.observedAtMs < input.before.observedAtMs) fail("ES4606", "RailgunPrivateSnapshotTimeReversed", "RAILGUN after-snapshot predates the before-snapshot.", { before: input.before.observedAtMs, after: input.after.observedAtMs });
  if (input.expectations.length === 0) fail("ES4607", "MissingRailgunPrivateBalanceExpectations", "RAILGUN private-state verification requires at least one explicit balance expectation.");
  const assertions = input.expectations.map((expectation, index) => {
    const tokenAddress = token(expectation.token, `expectations[${index}].token`);
    const beforeAmount = balanceOf(input.before, tokenAddress);
    const afterAmount = balanceOf(input.after, tokenAddress);
    const delta = afterAmount - beforeAmount;
    let passed = true;
    if (expectation.minimumDelta !== undefined && delta < expectation.minimumDelta) passed = false;
    if (expectation.maximumDelta !== undefined && delta > expectation.maximumDelta) passed = false;
    if (expectation.expectedFinalAmount !== undefined && afterAmount !== expectation.expectedFinalAmount) passed = false;
    return {
      id: expectation.id,
      passed,
      description: `${expectation.description} [token=${tokenAddress}, before=${beforeAmount}, after=${afterAmount}, delta=${delta}]`,
    };
  });
  return railgunPrivateStateEvidence({
    proofBindingHash: input.proofBindingHash,
    source: input.source ?? `${input.after.source}:${input.after.balanceBucket}`,
    assertions,
    observedAtMs: input.after.observedAtMs,
  });
}
