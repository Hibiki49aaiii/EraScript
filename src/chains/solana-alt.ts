import { createHash } from "node:crypto";
import { EraDiagnosticError } from "../diagnostics.js";
import { solanaAddress, type SolanaAddress } from "./solana.js";

const U64_MAX = (1n << 64n) - 1n;

export type SolanaLookupTableStatus = "active" | "deactivating" | "deactivated";

export interface SolanaAddressLookupTableEvidence {
  readonly kind: "solana-address-lookup-table";
  readonly table: SolanaAddress;
  readonly authority?: SolanaAddress;
  readonly deactivationSlot: bigint;
  readonly lastExtendedSlot: bigint;
  readonly lastExtendedSlotStartIndex: number;
  readonly addresses: readonly SolanaAddress[];
  readonly status: SolanaLookupTableStatus;
  readonly observedSlot: bigint;
  readonly observedAtMs: number;
  readonly source?: string;
}

export interface SolanaAddressLookupReference {
  readonly table: string;
  readonly writableIndexes: readonly number[];
  readonly readonlyIndexes: readonly number[];
}

export interface SolanaAddressLookupResolution {
  readonly table: SolanaAddress;
  readonly writable: readonly SolanaAddress[];
  readonly readonly: readonly SolanaAddress[];
}

export interface SolanaAddressLookupBindingEvidence {
  readonly kind: "solana-address-lookup-binding";
  readonly version: 0;
  readonly observedSlot: bigint;
  readonly resolutions: readonly SolanaAddressLookupResolution[];
  readonly bindingHash: string;
  readonly verifiedAtMs: number;
}

export interface SolanaAddressLookupTableReader {
  readonly id?: string;
  read(table: SolanaAddress): Promise<{
    readonly authority?: string;
    readonly deactivationSlot: bigint;
    readonly lastExtendedSlot: bigint;
    readonly lastExtendedSlotStartIndex: number;
    readonly addresses: readonly string[];
    readonly status: SolanaLookupTableStatus;
    readonly observedSlot: bigint;
  }>;
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

function index(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 255) {
    fail("ES4700", "InvalidSolanaLookupIndex", "Solana ALT indexes must be integers between 0 and 255.", { field, value });
  }
  return value;
}

function stable(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (typeof item === "bigint") return item.toString();
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, inner]) => [key, normalize(inner)]),
      );
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}

function hash(value: unknown): string {
  return `0x${createHash("sha256").update(stable(value)).digest("hex")}`;
}

export function solanaAddressLookupTable(input: {
  table: string;
  authority?: string;
  deactivationSlot?: bigint;
  lastExtendedSlot: bigint;
  lastExtendedSlotStartIndex: number;
  addresses: readonly string[];
  status: SolanaLookupTableStatus;
  observedSlot: bigint;
  observedAtMs?: number;
  source?: string;
}): SolanaAddressLookupTableEvidence {
  if (input.observedSlot < 0n || input.lastExtendedSlot < 0n) {
    fail("ES4701", "InvalidSolanaLookupSlot", "ALT observed/extended slots must be non-negative.");
  }
  if (!Number.isSafeInteger(input.lastExtendedSlotStartIndex) || input.lastExtendedSlotStartIndex < 0 || input.lastExtendedSlotStartIndex > 255) {
    fail("ES4702", "InvalidSolanaLookupExtensionIndex", "ALT lastExtendedSlotStartIndex must be an integer between 0 and 255.");
  }
  if (input.addresses.length > 256) {
    fail("ES4703", "SolanaLookupTableTooLarge", "A Solana ALT cannot contain more than 256 addresses.", { addresses: input.addresses.length });
  }
  const deactivationSlot = input.deactivationSlot ?? U64_MAX;
  if (deactivationSlot < 0n || deactivationSlot > U64_MAX) {
    fail("ES4701", "InvalidSolanaLookupSlot", "ALT deactivation slot must fit uint64.");
  }
  return {
    kind: "solana-address-lookup-table",
    table: solanaAddress(input.table),
    ...(input.authority ? { authority: solanaAddress(input.authority) } : {}),
    deactivationSlot,
    lastExtendedSlot: input.lastExtendedSlot,
    lastExtendedSlotStartIndex: input.lastExtendedSlotStartIndex,
    addresses: input.addresses.map(solanaAddress),
    status: input.status,
    observedSlot: input.observedSlot,
    observedAtMs: input.observedAtMs ?? Date.now(),
    ...(input.source ? { source: input.source } : {}),
  };
}

function resolveIndex(
  table: SolanaAddressLookupTableEvidence,
  lookupIndex: number,
  currentSlot: bigint,
  field: string,
): SolanaAddress {
  const i = index(lookupIndex, field);
  if (i >= table.addresses.length) {
    fail("ES4704", "SolanaLookupIndexOutOfRange", "Transaction references an ALT index that does not exist.", {
      table: table.table,
      index: i,
      addresses: table.addresses.length,
    });
  }
  if (table.status === "deactivated") {
    fail("ES4705", "SolanaLookupTableDeactivated", "Transaction references a deactivated ALT.", { table: table.table });
  }
  // Addresses appended in the current slot are not usable until a later slot.
  if (table.lastExtendedSlot === currentSlot && i >= table.lastExtendedSlotStartIndex) {
    fail("ES4706", "SolanaLookupAddressWarmup", "Transaction references an ALT address added in the current slot before its warm-up completes.", {
      table: table.table,
      index: i,
      lastExtendedSlot: table.lastExtendedSlot.toString(),
      currentSlot: currentSlot.toString(),
    });
  }
  return table.addresses[i]!;
}

export function verifySolanaAddressLookupReferences(input: {
  version: "legacy" | 0;
  references: readonly SolanaAddressLookupReference[];
  tables: readonly SolanaAddressLookupTableEvidence[];
  currentSlot: bigint;
  nowMs?: number;
}): SolanaAddressLookupBindingEvidence {
  if (input.references.length > 0 && input.version !== 0) {
    fail("ES4707", "SolanaLookupRequiresV0", "Address Lookup Tables are valid only for Solana v0 transactions.", {
      version: input.version,
    });
  }
  if (input.currentSlot < 0n) fail("ES4701", "InvalidSolanaLookupSlot", "Current slot cannot be negative.");

  const byAddress = new Map(input.tables.map((table) => [table.table, table]));
  const resolutions = input.references.map((reference, refIndex): SolanaAddressLookupResolution => {
    const tableAddress = solanaAddress(reference.table);
    const table = byAddress.get(tableAddress);
    if (!table) {
      return fail("ES4708", "MissingSolanaLookupTableEvidence", "Transaction references an ALT without bound on-chain table evidence.", {
        table: tableAddress,
        referenceIndex: refIndex,
      });
    }
    if (table.observedSlot > input.currentSlot) {
      fail("ES4709", "SolanaLookupEvidenceFromFutureSlot", "ALT evidence was observed at a slot newer than the execution slot being verified.", {
        table: table.table,
        observedSlot: table.observedSlot.toString(),
        currentSlot: input.currentSlot.toString(),
      });
    }
    return {
      table: table.table,
      writable: reference.writableIndexes.map((i, indexInList) => resolveIndex(table, i, input.currentSlot, `references[${refIndex}].writableIndexes[${indexInList}]`)),
      readonly: reference.readonlyIndexes.map((i, indexInList) => resolveIndex(table, i, input.currentSlot, `references[${refIndex}].readonlyIndexes[${indexInList}]`)),
    };
  });

  const verifiedAtMs = input.nowMs ?? Date.now();
  return {
    kind: "solana-address-lookup-binding",
    version: 0,
    observedSlot: input.currentSlot,
    resolutions,
    bindingHash: hash({
      version: input.version,
      currentSlot: input.currentSlot,
      resolutions,
      tables: input.tables.map((table) => ({
        table: table.table,
        status: table.status,
        observedSlot: table.observedSlot,
        lastExtendedSlot: table.lastExtendedSlot,
        lastExtendedSlotStartIndex: table.lastExtendedSlotStartIndex,
        deactivationSlot: table.deactivationSlot,
        addresses: table.addresses,
      })),
    }),
    verifiedAtMs,
  };
}

/**
 * Re-reads every referenced ALT before submission. This catches table closure,
 * deactivation, or unexpected state changes after signing.
 */
export async function assertSolanaLookupTablesStillUsable(input: {
  reader: SolanaAddressLookupTableReader;
  binding: SolanaAddressLookupBindingEvidence;
  currentSlot: bigint;
}): Promise<SolanaAddressLookupBindingEvidence> {
  const refreshed: SolanaAddressLookupTableEvidence[] = [];
  for (const resolution of input.binding.resolutions) {
    const raw = await input.reader.read(resolution.table);
    refreshed.push(solanaAddressLookupTable({
      table: resolution.table,
      ...(raw.authority ? { authority: raw.authority } : {}),
      deactivationSlot: raw.deactivationSlot,
      lastExtendedSlot: raw.lastExtendedSlot,
      lastExtendedSlotStartIndex: raw.lastExtendedSlotStartIndex,
      addresses: raw.addresses,
      status: raw.status,
      observedSlot: raw.observedSlot,
      ...(input.reader.id ? { source: input.reader.id } : {}),
    }));
  }

  const references = input.binding.resolutions.map((resolution) => {
    const table = refreshed.find((item) => item.table === resolution.table)!;
    const writableIndexes = resolution.writable.map((address) => {
      const i = table.addresses.indexOf(address);
      if (i < 0) fail("ES4704", "SolanaLookupIndexOutOfRange", "Previously resolved writable ALT address no longer exists in the table.", { table: table.table, address });
      return i;
    });
    const readonlyIndexes = resolution.readonly.map((address) => {
      const i = table.addresses.indexOf(address);
      if (i < 0) fail("ES4704", "SolanaLookupIndexOutOfRange", "Previously resolved readonly ALT address no longer exists in the table.", { table: table.table, address });
      return i;
    });
    return { table: resolution.table, writableIndexes, readonlyIndexes };
  });

  const refreshedBinding = verifySolanaAddressLookupReferences({
    version: 0,
    references,
    tables: refreshed,
    currentSlot: input.currentSlot,
  });
  if (
    refreshedBinding.resolutions.length !== input.binding.resolutions.length
    || refreshedBinding.resolutions.some((resolution, index) => {
      const original = input.binding.resolutions[index];
      return !original
        || resolution.table !== original.table
        || resolution.writable.length !== original.writable.length
        || resolution.readonly.length !== original.readonly.length
        || resolution.writable.some((value, i) => value !== original.writable[i])
        || resolution.readonly.some((value, i) => value !== original.readonly[i]);
    })
  ) {
    fail("ES4708", "MissingSolanaLookupTableEvidence", "ALT resolution changed after the transaction was signed.");
  }
  return input.binding;
}
