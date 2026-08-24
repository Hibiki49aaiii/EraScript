import assert from "node:assert/strict";
import test from "node:test";
import {
  createSolanaKitEraInspectors,
  createSuiSdkTransactionInspector,
} from "../src/chains/index.js";

const SOL_BLOCKHASH = "1".repeat(32);
const SOL_FEE_PAYER = "11111111111111111111111111111111";
const SOL_SECOND_SIGNER = "So11111111111111111111111111111111111111112";
const SUI_SENDER = `0x${"11".repeat(32)}`;
const SUI_SPONSOR = `0x${"22".repeat(32)}`;

test("Solana Kit codec bridge derives runtime and signing inspection from the same decoded message", async () => {
  const messageBytes = Uint8Array.from([9, 8, 7]);
  const bridge = createSolanaKitEraInspectors({
    transactionDecoder: {
      decode(bytes) {
        assert.deepEqual([...bytes], [1, 2, 3]);
        return { messageBytes };
      },
    },
    messageDecoder: {
      decode(bytes) {
        assert.deepEqual([...bytes], [9, 8, 7]);
        return {
          version: 0,
          lifetimeToken: SOL_BLOCKHASH,
          header: { numSignerAccounts: 2 },
          staticAccounts: [SOL_FEE_PAYER, SOL_SECOND_SIGNER, "11111111111111111111111111111111"],
        };
      },
    },
  });
  const runtime = await bridge.transactionInspector(Uint8Array.from([1, 2, 3]));
  assert.equal(runtime.version, 0);
  assert.equal(runtime.recentBlockhash, SOL_BLOCKHASH);
  assert.equal(runtime.signerCount, 2);
  const signing = await bridge.signingInspector(Uint8Array.from([1, 2, 3]));
  assert.equal(signing.signingPayloadBase64, Buffer.from(messageBytes).toString("base64"));
  assert.deepEqual(signing.requiredSigners, [SOL_FEE_PAYER, SOL_SECOND_SIGNER]);
  assert.equal(signing.feePayer, SOL_FEE_PAYER);
});

test("Sui SDK bridge derives sender, gas owner and gas metadata from Transaction.from(bytes).getData()", async () => {
  const inspector = createSuiSdkTransactionInspector({
    from(serialized) {
      assert.ok(serialized instanceof Uint8Array);
      return {
        getData() {
          return {
            sender: SUI_SENDER,
            gasData: { owner: SUI_SPONSOR, budget: "1000", price: "2" },
            commands: [{}, {}],
          };
        },
      };
    },
  });
  const inspection = await inspector(Uint8Array.from([1, 2, 3]));
  assert.equal(inspection.sender, SUI_SENDER);
  assert.equal(inspection.gasOwner, SUI_SPONSOR);
  assert.equal(inspection.gasBudget, "1000");
  assert.equal(inspection.gasPrice, "2");
  assert.equal(inspection.commandCount, 2);
});
