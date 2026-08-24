import { createHash } from "node:crypto";
import { EraDiagnosticError } from "../diagnostics.js";
import type { SuiCheckpointEvidence } from "./sui-adapter.js";
import {
  suiAddress,
  suiObjectDigest,
  suiObjectId,
  type SuiAddress,
  type SuiObjectDigest,
  type SuiObjectId,
} from "./sui.js";

export type SuiOwnerDescriptor =
  | { readonly kind: "address"; readonly address: SuiAddress }
  | { readonly kind: "object"; readonly objectId: SuiObjectId }
  | { readonly kind: "shared" }
  | { readonly kind: "immutable" }
  | { readonly kind: "consensus-address"; readonly address: SuiAddress; readonly startVersion: bigint };

export interface SuiBalanceState {
  readonly owner: SuiAddress;
  readonly coinType: string;
  readonly balance: bigint;
  readonly coinBalance: bigint;
  readonly addressBalance: bigint;
}

export interface SuiObjectState {
  readonly objectId: SuiObjectId;
  readonly exists: boolean;
  readonly version?: bigint;
  readonly digest?: SuiObjectDigest;
  readonly owner?: SuiOwnerDescriptor;
  readonly type?: string;
}

export interface SuiStateReader {
  readonly id: string;
  readBalance(input: { readonly owner: SuiAddress; readonly coinType: string }): Promise<SuiBalanceState>;
  readObject(objectId: SuiObjectId): Promise<SuiObjectState>;
}

export interface SuiStateSnapshot {
  readonly kind: "sui-state-snapshot";
  readonly source: string;
  readonly capturedAtMs: number;
  readonly balances: readonly SuiBalanceState[];
  readonly objects: readonly SuiObjectState[];
  readonly evidenceHash: string;
}

export interface SuiPostStateEvidence {
  readonly kind: "sui-post-state-evidence";
  readonly source: string;
  readonly transactionDigest: string;
  readonly checkpoint: bigint;
  readonly capturedAtMs: number;
  readonly balances: readonly SuiBalanceState[];
  readonly objects: readonly SuiObjectState[];
  readonly snapshotHash: string;
  readonly evidenceHash: string;
}

export interface SuiBalanceExpectation {
  readonly id: string;
  readonly owner: SuiAddress;
  readonly coinType: string;
  readonly minimumDelta?: bigint;
  readonly maximumDelta?: bigint;
  readonly expectedFinalBalance?: bigint;
}

export interface SuiObjectExpectation {
  readonly id: string;
  readonly objectId: SuiObjectId;
  readonly expectedExists?: boolean;
  readonly expectedOwner?: SuiOwnerDescriptor;
  readonly minimumVersion?: bigint;
  readonly expectedDigest?: SuiObjectDigest;
}

export interface SuiStateAssertion {
  readonly id: string;
  readonly passed: boolean;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export interface SuiStateInvariantEvidence {
  readonly kind: "sui-state-invariant-evidence";
  readonly transactionDigest: string;
  readonly checkpoint: bigint;
  readonly beforeSnapshotHash?: string;
  readonly afterSnapshotHash: string;
  readonly assertions: readonly SuiStateAssertion[];
  readonly passed: boolean;
  readonly evidenceHash: string;
}

export interface SuiCoreStateClientLike {
  readonly core?: {
    getBalance?: (input: Record<string, unknown>) => Promise<unknown>;
    getObject?: (input: Record<string, unknown>) => Promise<unknown>;
  };
  getBalance?: (input: Record<string, unknown>) => Promise<unknown>;
  getObject?: (input: Record<string, unknown>) => Promise<unknown>;
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

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("ES4680", "MalformedSuiStateResponse", `${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exactUnsigned(value: unknown, field: string): bigint {
  try {
    const parsed = typeof value === "bigint" ? value : BigInt(String(value));
    if (parsed < 0n) throw new Error("negative");
    return parsed;
  } catch {
    return fail("ES4680", "MalformedSuiStateResponse", `${field} must be an exact non-negative integer.`, { field, value: String(value) });
  }
}

function coreMethod(client: SuiCoreStateClientLike, name: "getBalance" | "getObject"): (input: Record<string, unknown>) => Promise<unknown> {
  const direct = client[name];
  if (typeof direct === "function") return direct.bind(client);
  const nested = client.core?.[name];
  if (typeof nested === "function") return nested.bind(client.core);
  fail("ES4681", "MissingSuiStateMethod", `Sui state reader requires '${name}' on the client or client.core.`, { method: name });
}

function normalizeOwner(value: unknown): SuiOwnerDescriptor | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return { kind: "address", address: suiAddress(value) };
  const record = object(value, "Sui object owner");
  const kind = record.$kind;
  if (kind === "AddressOwner" && typeof record.AddressOwner === "string") return { kind: "address", address: suiAddress(record.AddressOwner) };
  if (kind === "ObjectOwner" && typeof record.ObjectOwner === "string") return { kind: "object", objectId: suiObjectId(record.ObjectOwner) };
  if (kind === "Shared") return { kind: "shared" };
  if (kind === "Immutable") return { kind: "immutable" };
  if (kind === "ConsensusAddressOwner") {
    const inner = object(record.ConsensusAddressOwner, "ConsensusAddressOwner");
    if (typeof inner.owner !== "string") fail("ES4680", "MalformedSuiStateResponse", "ConsensusAddressOwner is missing its owner address.");
    return { kind: "consensus-address", address: suiAddress(inner.owner), startVersion: exactUnsigned(inner.startVersion, "owner.startVersion") };
  }
  fail("ES4682", "UnsupportedSuiObjectOwner", "Sui object owner variant is not recognized by EraScript.", { kind: String(kind) });
}

function sameOwner(a: SuiOwnerDescriptor | undefined, b: SuiOwnerDescriptor | undefined): boolean {
  return stable(a) === stable(b);
}

export function createSuiCoreStateReader(client: SuiCoreStateClientLike, id = "@mysten/sui-core-state"): SuiStateReader {
  return {
    id,
    async readBalance(input) {
      const raw = object(await coreMethod(client, "getBalance")({ owner: input.owner, coinType: input.coinType }), "getBalance response");
      const balanceRaw = raw.balance && typeof raw.balance === "object" ? object(raw.balance, "getBalance.balance") : raw;
      const coinType = typeof balanceRaw.coinType === "string" ? balanceRaw.coinType : input.coinType;
      if (coinType !== input.coinType) fail("ES4683", "SuiCoinTypeMismatch", "Sui balance response returned a different coin type than requested.", { expected: input.coinType, actual: coinType });
      return {
        owner: input.owner,
        coinType,
        balance: exactUnsigned(balanceRaw.balance, "balance.balance"),
        coinBalance: exactUnsigned(balanceRaw.coinBalance ?? balanceRaw.balance, "balance.coinBalance"),
        addressBalance: exactUnsigned(balanceRaw.addressBalance ?? 0, "balance.addressBalance"),
      };
    },
    async readObject(objectId) {
      const raw = object(await coreMethod(client, "getObject")({ objectId }), "getObject response");
      const value = raw.object;
      if (value === null || value === undefined) return { objectId, exists: false };
      const record = object(value, "getObject.object");
      const observedId = typeof record.objectId === "string" ? suiObjectId(record.objectId) : objectId;
      if (observedId !== objectId) fail("ES4684", "SuiObjectIdentityMismatch", "Sui getObject response belongs to a different object ID.", { expected: objectId, actual: observedId });
      const owner = record.owner !== undefined ? normalizeOwner(record.owner) : undefined;
      return {
        objectId,
        exists: true,
        ...(record.version !== undefined ? { version: exactUnsigned(record.version, "object.version") } : {}),
        ...(typeof record.digest === "string" ? { digest: suiObjectDigest(record.digest) } : {}),
        ...(owner !== undefined ? { owner } : {}),
        ...(typeof record.type === "string" ? { type: record.type } : {}),
      };
    },
  };
}

async function readSnapshot(input: {
  reader: SuiStateReader;
  balanceQueries?: readonly { readonly owner: SuiAddress; readonly coinType: string }[];
  objectIds?: readonly SuiObjectId[];
  capturedAtMs?: number;
}): Promise<Omit<SuiStateSnapshot, "kind">> {
  const balanceQueries = input.balanceQueries ?? [];
  const objectIds = input.objectIds ?? [];
  const balances = await Promise.all(balanceQueries.map((query) => input.reader.readBalance(query)));
  const objects = await Promise.all(objectIds.map((objectId) => input.reader.readObject(objectId)));
  const core = { source: input.reader.id, capturedAtMs: input.capturedAtMs ?? Date.now(), balances, objects };
  return { ...core, evidenceHash: sha256(core) };
}

export async function captureSuiStateSnapshot(input: {
  reader: SuiStateReader;
  balanceQueries?: readonly { readonly owner: SuiAddress; readonly coinType: string }[];
  objectIds?: readonly SuiObjectId[];
  capturedAtMs?: number;
}): Promise<SuiStateSnapshot> {
  return { kind: "sui-state-snapshot", ...(await readSnapshot(input)) };
}

export async function captureSuiPostState(input: {
  reader: SuiStateReader;
  checkpoint: SuiCheckpointEvidence;
  balanceQueries?: readonly { readonly owner: SuiAddress; readonly coinType: string }[];
  objectIds?: readonly SuiObjectId[];
  capturedAtMs?: number;
}): Promise<SuiPostStateEvidence> {
  const snapshot = await readSnapshot(input);
  const core = {
    source: snapshot.source,
    transactionDigest: input.checkpoint.transaction.digest,
    checkpoint: input.checkpoint.checkpoint,
    capturedAtMs: snapshot.capturedAtMs,
    balances: snapshot.balances,
    objects: snapshot.objects,
    snapshotHash: snapshot.evidenceHash,
  };
  return { kind: "sui-post-state-evidence", ...core, evidenceHash: sha256(core) };
}

function balanceKey(owner: SuiAddress, coinType: string): string {
  return `${owner.toLowerCase()}::${coinType}`;
}

export function verifySuiStateInvariants(input: {
  before?: SuiStateSnapshot;
  after: SuiPostStateEvidence;
  balanceExpectations?: readonly SuiBalanceExpectation[];
  objectExpectations?: readonly SuiObjectExpectation[];
}): SuiStateInvariantEvidence {
  const beforeBalances = new Map((input.before?.balances ?? []).map((entry) => [balanceKey(entry.owner, entry.coinType), entry]));
  const afterBalances = new Map(input.after.balances.map((entry) => [balanceKey(entry.owner, entry.coinType), entry]));
  const afterObjects = new Map(input.after.objects.map((entry) => [entry.objectId, entry]));
  const assertions: SuiStateAssertion[] = [];

  for (const expectation of input.balanceExpectations ?? []) {
    const after = afterBalances.get(balanceKey(expectation.owner, expectation.coinType));
    if (!after) {
      assertions.push({ id: expectation.id, passed: false, message: "Required Sui post-state balance was not captured." });
      continue;
    }
    const before = beforeBalances.get(balanceKey(expectation.owner, expectation.coinType));
    const delta = before ? after.balance - before.balance : undefined;
    const needsDelta = expectation.minimumDelta !== undefined || expectation.maximumDelta !== undefined;
    let passed = true;
    if (needsDelta && delta === undefined) passed = false;
    if (expectation.minimumDelta !== undefined && delta !== undefined && delta < expectation.minimumDelta) passed = false;
    if (expectation.maximumDelta !== undefined && delta !== undefined && delta > expectation.maximumDelta) passed = false;
    if (expectation.expectedFinalBalance !== undefined && after.balance !== expectation.expectedFinalBalance) passed = false;
    assertions.push({
      id: expectation.id,
      passed,
      message: passed ? "Sui balance invariant satisfied." : "Sui balance invariant failed.",
      details: { owner: expectation.owner, coinType: expectation.coinType, before: before?.balance.toString() ?? null, after: after.balance.toString(), delta: delta?.toString() ?? null },
    });
  }

  for (const expectation of input.objectExpectations ?? []) {
    const after = afterObjects.get(expectation.objectId);
    if (!after) {
      assertions.push({ id: expectation.id, passed: false, message: "Required Sui post-state object was not captured." });
      continue;
    }
    let passed = true;
    if (expectation.expectedExists !== undefined && after.exists !== expectation.expectedExists) passed = false;
    if (expectation.expectedOwner !== undefined && !sameOwner(after.owner, expectation.expectedOwner)) passed = false;
    if (expectation.minimumVersion !== undefined && (after.version === undefined || after.version < expectation.minimumVersion)) passed = false;
    if (expectation.expectedDigest !== undefined && after.digest !== expectation.expectedDigest) passed = false;
    assertions.push({
      id: expectation.id,
      passed,
      message: passed ? "Sui object invariant satisfied." : "Sui object invariant failed.",
      details: { objectId: expectation.objectId, exists: after.exists, version: after.version?.toString() ?? null, digest: after.digest ?? null, owner: after.owner ?? null },
    });
  }

  const core = {
    transactionDigest: input.after.transactionDigest,
    checkpoint: input.after.checkpoint,
    ...(input.before ? { beforeSnapshotHash: input.before.evidenceHash } : {}),
    afterSnapshotHash: input.after.snapshotHash,
    assertions,
    passed: assertions.every((assertion) => assertion.passed),
  };
  return { kind: "sui-state-invariant-evidence", ...core, evidenceHash: sha256(core) };
}
