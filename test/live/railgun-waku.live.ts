import assert from "node:assert/strict";
const WAKU_PACKAGE = "@railgun-community/waku-broadcaster-client-node";
import { validateRailgunAddress } from "@railgun-community/wallet";
import {
  selectRailgunBroadcaster,
} from "../../src/privacy/index.js";

const ETHEREUM = { type: 0, id: 1 };
const DAI = "0x6b175474e89094c44da98b954eedeac495271d0f" as const;
const POLL_MS = 3_000;
const DISCOVERY_TIMEOUT_MS = Number(
  process.env.RAILGUN_WAKU_DISCOVERY_TIMEOUT_MS || "60000",
);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBroadcaster(WakuBroadcasterClient: any): Promise<unknown> {
  const deadline = Date.now() + DISCOVERY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const selected = WakuBroadcasterClient.findBestBroadcaster(
      ETHEREUM,
      DAI,
      false,
    );
    if (selected) return selected;
    await delay(POLL_MS);
  }
  throw new Error(
    `No live RAILGUN Broadcaster for Ethereum DAI was discovered within ${DISCOVERY_TIMEOUT_MS}ms`,
  );
}

async function main(): Promise<void> {
  const { WakuBroadcasterClient } = await import(WAKU_PACKAGE);
  const statuses: string[] = [];
  const trustedFeeSigner = process.env.RAILGUN_TRUSTED_FEE_SIGNER || "";

  // Empty trustedFeeSigner is permitted only for this read-only discovery smoke.
  // It disables the authorized-fee anchor in the upstream client. No transaction
  // is constructed, proved, signed, or submitted by this test.
  await WakuBroadcasterClient.start(
    ETHEREUM,
    {
      trustedFeeSigner,
      useDNSDiscovery: true,
      peerDiscoveryTimeout: 10_000,
      feeExpirationTimeout: 120_000,
      broadcasterVersionRange: {
        minVersion: "8.0.0",
        maxVersion: "99.999.999",
      },
    },
    (_chain: unknown, status: unknown) => {
      statuses.push(String(status));
    },
  );

  try {
    assert.equal(WakuBroadcasterClient.isStarted(), true);
    assert.ok(WakuBroadcasterClient.getContentTopics().length >= 2);

    await waitForBroadcaster(WakuBroadcasterClient);
    const selection = await selectRailgunBroadcaster({
      client: WakuBroadcasterClient,
      sdkChain: ETHEREUM,
      feeToken: DAI,
      validateRailgunAddress,
      useRelayAdapt: false,
    });

    assert.equal(selection.feeToken, DAI);
    assert.equal(validateRailgunAddress(selection.railgunAddress), true);

    const peerCounts = {
      mesh: WakuBroadcasterClient.getMeshPeerCount(),
      pubsub: WakuBroadcasterClient.getPubSubPeerCount(),
      lightpush: await WakuBroadcasterClient.getLightPushPeerCount(),
      filter: await WakuBroadcasterClient.getFilterPeerCount(),
    };
    assert.ok(
      Object.values(peerCounts).some((count) => count > 0),
      `Waku reported no live peers: ${JSON.stringify(peerCounts)}`,
    );

    console.log(JSON.stringify({
      ok: true,
      network: "ethereum-mainnet",
      broadcaster: selection.railgunAddress,
      feesId: selection.feesId,
      peerCounts,
      statuses: statuses.slice(-10),
      trustedFeeSignerConfigured: trustedFeeSigner.length > 0,
      readOnly: true,
    }));
  } finally {
    await WakuBroadcasterClient.stop();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
