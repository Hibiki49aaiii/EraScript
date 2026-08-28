import assert from "node:assert/strict";
import test from "node:test";
import {
  readJitoTipAccounts,
  type JitoRelayLike,
} from "../../src/chains/index.js";

const JITO_URL =
  process.env.JITO_BLOCK_ENGINE_URL ||
  "https://mainnet.block-engine.jito.wtf/api/v1/bundles";

const relay: JitoRelayLike = {
  url: JITO_URL,
  async request<Result>(method: string, params: readonly unknown[]): Promise<Result> {
    const response = await fetch(JITO_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(response.ok, true, `Jito HTTP ${response.status}`);
    const payload = await response.json() as {
      result?: unknown;
      error?: { code?: number; message?: string };
    };
    if (payload.error) {
      throw new Error(`Jito ${method} failed: ${payload.error.code ?? "?"} ${payload.error.message ?? "unknown error"}`);
    }
    return payload as Result;
  },
};

test("Jito mainnet Block Engine exposes official tip accounts through EraScript", { timeout: 30_000 }, async () => {
  const evidence = await readJitoTipAccounts(relay);
  assert.ok(evidence.accounts.length > 0);
  assert.equal(new Set(evidence.accounts).size, evidence.accounts.length);
  assert.equal(evidence.relay, JITO_URL);
  for (const account of evidence.accounts) {
    assert.match(String(account), /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  }
});
