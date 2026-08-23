import { decodeEventLog, type Abi, type Hex } from "viem";
import { EraDiagnosticError } from "../diagnostics.js";
import type { Address, BlockHash, EvmChain, TransactionHash } from "./types.js";

export interface RawLog<C extends EvmChain = EvmChain> {
  readonly address: Address<C>;
  readonly data: Hex;
  readonly topics: readonly Hex[];
  readonly transactionHash?: TransactionHash<C>;
  readonly blockHash?: BlockHash<C>;
  readonly blockNumber?: bigint;
  readonly logIndex?: number;
}

export interface DecodedEvent<C extends EvmChain = EvmChain> {
  readonly chain: C;
  readonly address: Address<C>;
  readonly eventName: string;
  readonly args: unknown;
  readonly raw: RawLog<C>;
}

const decodeEventLogLoose = decodeEventLog as unknown as (parameters: {
  abi: Abi;
  data: Hex;
  topics: readonly Hex[];
  strict: true;
}) => { eventName: string; args?: unknown };

function eventError(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

export function decodeEventStrict<C extends EvmChain>(chain: C, abi: Abi, log: RawLog<C>): DecodedEvent<C> {
  try {
    const decoded = decodeEventLogLoose({ abi, data: log.data, topics: log.topics, strict: true });
    return { chain, address: log.address, eventName: decoded.eventName, args: decoded.args ?? {}, raw: log };
  } catch (error) {
    return eventError("ES3501", "StrictEventDecodeFailed", "Event log could not be decoded strictly with the supplied ABI.", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export function expectEventName<C extends EvmChain>(event: DecodedEvent<C>, expected: string): DecodedEvent<C> {
  if (event.eventName !== expected) {
    eventError("ES3502", "UnexpectedEvent", "Decoded event name does not match the required event.", {
      expected,
      actual: event.eventName,
    });
  }
  return event;
}

export function assertEventArgs<C extends EvmChain>(event: DecodedEvent<C>, expected: Record<string, unknown>): DecodedEvent<C> {
  if (typeof event.args !== "object" || event.args === null) {
    eventError("ES3503", "MissingEventArguments", "Decoded event does not expose named arguments.");
  }
  const actual = event.args as Record<string, unknown>;
  for (const [key, value] of Object.entries(expected)) {
    const got = actual[key];
    const equal = typeof got === "string" && typeof value === "string"
      ? got.toLowerCase() === value.toLowerCase()
      : got === value;
    if (!equal) {
      eventError("ES3504", "EventInvariantFailed", `Event argument '${key}' does not match the expected value.`, {
        key,
        expected: String(value),
        actual: String(got),
      });
    }
  }
  return event;
}
