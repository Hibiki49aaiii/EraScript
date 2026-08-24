import assert from "node:assert/strict";
import test from "node:test";
import {
  captureSuiPostState,
  captureSuiStateSnapshot,
  createSuiCoreStateReader,
  suiAddress,
  suiObjectId,
  verifySuiStateInvariants,
  type SuiCheckpointEvidence,
} from "../src/chains/index.js";

const OWNER = suiAddress(`0x${"11".repeat(32)}`);
const RECIPIENT = suiAddress(`0x${"22".repeat(32)}`);
const OBJECT_ID = suiObjectId(`0x${"33".repeat(32)}`);
const COIN_TYPE = "0x2::sui::SUI";
const OBJECT_DIGEST = "1".repeat(32);
const TX_DIGEST = "2".repeat(32);

function checkpointEvidence(): SuiCheckpointEvidence {
  return {
    state: "sui-checkpointed",
    checkpoint: 77n,
    observedThrough: "waitForTransaction",
    transaction: { digest: TX_DIGEST } as SuiCheckpointEvidence["transaction"],
  };
}

test("Sui post-state verification checks indexed balance delta and object ownership/version", async () => {
  let balance = 100n;
  let objectOwner = OWNER;
  let objectVersion = 1n;
  const client = {
    core: {
      async getBalance() {
        return { balance: { coinType: COIN_TYPE, balance: balance.toString(), coinBalance: balance.toString(), addressBalance: "0" } };
      },
      async getObject() {
        return {
          object: {
            objectId: OBJECT_ID,
            version: objectVersion.toString(),
            digest: OBJECT_DIGEST,
            owner: { $kind: "AddressOwner", AddressOwner: objectOwner },
            type: "0x2::example::Asset",
          },
        };
      },
    },
  };
  const reader = createSuiCoreStateReader(client);
  const before = await captureSuiStateSnapshot({
    reader,
    balanceQueries: [{ owner: RECIPIENT, coinType: COIN_TYPE }],
    objectIds: [OBJECT_ID],
    capturedAtMs: 1_000,
  });

  balance = 150n;
  objectOwner = RECIPIENT;
  objectVersion = 2n;
  const after = await captureSuiPostState({
    reader,
    checkpoint: checkpointEvidence(),
    balanceQueries: [{ owner: RECIPIENT, coinType: COIN_TYPE }],
    objectIds: [OBJECT_ID],
    capturedAtMs: 2_000,
  });

  const evidence = verifySuiStateInvariants({
    before,
    after,
    balanceExpectations: [{ id: "recipient.balance", owner: RECIPIENT, coinType: COIN_TYPE, minimumDelta: 50n, maximumDelta: 50n, expectedFinalBalance: 150n }],
    objectExpectations: [{ id: "asset.owner", objectId: OBJECT_ID, expectedExists: true, expectedOwner: { kind: "address", address: RECIPIENT }, minimumVersion: 2n }],
  });
  assert.equal(evidence.passed, true);
  assert.equal(evidence.assertions.length, 2);
  assert.equal(evidence.assertions.every((entry) => entry.passed), true);
  assert.equal(evidence.checkpoint, 77n);
  assert.equal(evidence.beforeSnapshotHash, before.evidenceHash);
  assert.equal(evidence.afterSnapshotHash, after.snapshotHash);
});

test("Sui post-state invariant fails when recipient balance or object owner differs", async () => {
  const client = {
    async getBalance() {
      return { balance: { coinType: COIN_TYPE, balance: "10", coinBalance: "10", addressBalance: "0" } };
    },
    async getObject() {
      return {
        object: {
          objectId: OBJECT_ID,
          version: "1",
          digest: OBJECT_DIGEST,
          owner: { $kind: "AddressOwner", AddressOwner: OWNER },
          type: "0x2::example::Asset",
        },
      };
    },
  };
  const reader = createSuiCoreStateReader(client, "test-sui-state");
  const after = await captureSuiPostState({ reader, checkpoint: checkpointEvidence(), balanceQueries: [{ owner: RECIPIENT, coinType: COIN_TYPE }], objectIds: [OBJECT_ID] });
  const evidence = verifySuiStateInvariants({
    after,
    balanceExpectations: [{ id: "recipient.final", owner: RECIPIENT, coinType: COIN_TYPE, expectedFinalBalance: 20n }],
    objectExpectations: [{ id: "owner.final", objectId: OBJECT_ID, expectedOwner: { kind: "address", address: RECIPIENT } }],
  });
  assert.equal(evidence.passed, false);
  assert.equal(evidence.assertions.filter((entry) => !entry.passed).length, 2);
});
