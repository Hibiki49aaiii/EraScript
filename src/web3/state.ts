import type { Abi, Hex } from "viem";
import { EraDiagnosticError } from "../diagnostics.js";
import { assertRpcChain, type ViemClientLike } from "./rpc.js";
import { tokenAmountRaw, type TokenDefinition } from "./token.js";
import { blockHash, type Address, type EvmChain } from "./types.js";
import { wei } from "./values.js";
import { balanceSnapshot, type BalanceSnapshot } from "./workflow.js";

const ERC20_BALANCE_OF_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
] as const satisfies Abi;

type RpcBlock = { readonly number: bigint | null; readonly hash: Hex | null };

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

function action<A, R>(client: ViemClientLike, name: string): (args: A) => Promise<R> {
  const value = (client as unknown as Record<string, unknown>)[name];
  if (typeof value !== "function") fail("ES4030", "MissingStateRpcAction", `The supplied viem client does not expose '${name}'.`, { action: name });
  return value.bind(client) as (args: A) => Promise<R>;
}

export async function captureBalanceSnapshotFromRpc<C extends EvmChain>(client: ViemClientLike, input: {
  chain: C;
  accounts: readonly Address<C>[];
  tokens?: readonly TokenDefinition<string, C, number>[];
  blockNumber?: bigint;
}): Promise<BalanceSnapshot<C>> {
  assertRpcChain(client, input.chain);
  if (input.accounts.length === 0) fail("ES4031", "EmptySnapshotQuery", "Balance snapshot requires at least one account.");
  for (const token of input.tokens ?? []) {
    if (token.chain.id !== input.chain.id) fail("ES3104", "ChainMismatch", "Snapshot token belongs to another chain.", { token: token.symbol, tokenChain: token.chain.id, snapshotChain: input.chain.id });
  }

  const getBlock = action<{ blockNumber?: bigint; blockTag?: "latest" }, RpcBlock>(client, "getBlock");
  const anchor = input.blockNumber !== undefined
    ? await getBlock({ blockNumber: input.blockNumber })
    : await getBlock({ blockTag: "latest" });
  if (anchor.number === null || anchor.hash === null) fail("ES4032", "UnanchoredStateSnapshot", "RPC state snapshot could not be anchored to a concrete block number and hash.");

  const getBalance = action<{ address: Hex; blockNumber: bigint }, bigint>(client, "getBalance");
  const readContract = action<{ address: Hex; abi: Abi; functionName: string; args: readonly unknown[]; blockNumber: bigint }, bigint>(client, "readContract");

  const native = await Promise.all(input.accounts.map(async (account) => ({
    account,
    balance: wei(await getBalance({ address: account, blockNumber: anchor.number! })),
  })));

  const tokens = (await Promise.all((input.tokens ?? []).flatMap((token) => input.accounts.map(async (account) => ({
    account,
    token,
    balance: tokenAmountRaw(token, await readContract({
      address: token.address,
      abi: ERC20_BALANCE_OF_ABI,
      functionName: "balanceOf",
      args: [account],
      blockNumber: anchor.number!,
    })),
  })))));

  return balanceSnapshot({
    chain: input.chain,
    blockNumber: anchor.number,
    blockHash: blockHash(anchor.hash, input.chain),
    native,
    tokens,
  });
}
