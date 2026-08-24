import assert from "node:assert/strict";
import test from "node:test";
import { EraDiagnosticError } from "../src/diagnostics.js";
import {
  Ethereum,
  address,
  createUserOperationDraft,
  type EntryPointBinding,
  type SignedEip7702Authorization,
} from "../src/web3/index.js";

const sender = address("0x0000000000000000000000000000000000007101", Ethereum);
const other = address("0x0000000000000000000000000000000000007102", Ethereum);
const delegate = address("0x0000000000000000000000000000000000007103", Ethereum);
const factory = address("0x0000000000000000000000000000000000007104", Ethereum);
const entryPoint: EntryPointBinding<typeof Ethereum, "0.9"> = {
  chain: Ethereum,
  address: address("0x0000000000000000000000000000000000007105", Ethereum),
  version: "0.9",
};

function authorization(authority = sender, executor: "self" | "relayer" = "relayer"): SignedEip7702Authorization<typeof Ethereum> {
  return {
    kind: "eip7702-signed-authorization",
    chain: Ethereum,
    authority,
    delegate,
    chainId: 1,
    nonce: 0,
    executor,
    clearsDelegation: false,
    replayable: false,
    yParity: 0,
    r: `0x${"11".repeat(32)}`,
    s: `0x${"22".repeat(32)}`,
  };
}

function baseInput() {
  return {
    entryPoint,
    sender,
    nonce: 5n,
    callData: "0x1234" as const,
    maxFeePerGas: 10n,
    maxPriorityFeePerGas: 1n,
    signatureStub: "0x01" as const,
  };
}

test("ERC-4337 requires EIP-7702 authorization authority to equal UserOperation sender", () => {
  assert.throws(
    () => createUserOperationDraft({ ...baseInput(), eip7702Auth: authorization(other) }),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4308",
  );
});

test("ERC-4337 requires relayer semantics for EIP-7702 authorization", () => {
  assert.throws(
    () => createUserOperationDraft({ ...baseInput(), eip7702Auth: authorization(sender, "self") }),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4309",
  );
});

test("ERC-4337 profile rejects combining account factory and EIP-7702 authorization", () => {
  assert.throws(
    () => createUserOperationDraft({
      ...baseInput(),
      factory,
      factoryData: "0x1234",
      eip7702Auth: authorization(),
    }),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4310",
  );
});

test("valid relayed EIP-7702 authorization is retained in UserOperation draft", () => {
  const draft = createUserOperationDraft({ ...baseInput(), eip7702Auth: authorization() });
  assert.equal(draft.eip7702Auth?.authority, sender);
  assert.equal(draft.eip7702Auth?.delegate, delegate);
  assert.equal(draft.eip7702Auth?.executor, "relayer");
});
