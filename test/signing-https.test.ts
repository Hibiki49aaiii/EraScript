import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { createServer, request as httpsRequest, type Server } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import test, { before, after, type TestContext } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { authorityExternalSigner, createSigningAuthority, createSigningAuthorityServer, hardwareWalletSigningBackend, openFileSigningReplayStore, serviceSigningBackend, signingRequestHash, type SigningAuthority, type SigningGrant } from "../src/signing/index.js";
import { serializableTransfer } from "../src/signing/policy.js";
import { Ethereum, address, type ExternalTransactionSigningRequest } from "../src/web3/index.js";

// Ephemeral TLS credentials are generated only for loopback tests, never committed.
let directory: string;
let cert: string;
let key: string;
let fingerprint: string;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "era-signing-tls-"));
  const openssl = process.platform === "win32" ? join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "usr", "bin", "openssl.exe") : "openssl";
  const generated = spawnSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1", "-keyout", join(directory, "key.pem"), "-out", join(directory, "cert.pem")], { encoding: "utf8", windowsHide: true, timeout: 30_000 });
  assert.equal(generated.status, 0, "OpenSSL is required for ephemeral loopback TLS tests");
  cert = await readFile(join(directory, "cert.pem"), "utf8");
  key = await readFile(join(directory, "key.pem"), "utf8");
  fingerprint = new X509Certificate(cert).fingerprint256;
});
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

const token = "offline_test_grant_access_not_a_real_credential";
const account = privateKeyToAccount(`0x${"0".repeat(63)}1`);
const sender = address(account.address, Ethereum);
const destination = address("0x0000000000000000000000000000000000000022", Ethereum);
const tx: ExternalTransactionSigningRequest<typeof Ethereum> = {
  kind: "external-transaction-signing-request", chain: Ethereum, transactionType: "legacy", from: sender, to: destination,
  value: 1n, nonce: 0, gas: 21_000n, fee: { type: "legacy", gasPrice: 1n }, simulation: { status: "success", stateOverrides: false },
};
let index = 0;
async function listening(t: TestContext, server: Server) {
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const addressInfo = server.address(); assert.ok(addressInfo && typeof addressInfo !== "string");
  return `https://127.0.0.1:${addressInfo.port}/v1/sign`;
}
async function fixture(t: TestContext, kind: "external-service" | "hardware-wallet" = "external-service") {
  const replayDirectory = join(directory, `store-${index++}`); await mkdir(replayDirectory);
  const grant: SigningGrant = { id: "local-grant", walletId: "wallet", callerId: "researcher", createdAtMs: Date.now() - 1000, expiresAtMs: Date.now() + 60_000, request: tx };
  let signs = 0;
  const sign = async (r: ExternalTransactionSigningRequest) => { signs++; return account.signTransaction(serializableTransfer(r)); };
  const backend = kind === "external-service"
    ? serviceSigningBackend({ kind: "external-signer", chain: Ethereum, address: sender, signTransaction: sign })
    : hardwareWalletSigningBackend({ signer: sender, chainId: 1, bridge: { async displayAddress() { return sender; }, async signTransaction({ request: r }) { return { approval: "device", rawTransaction: await sign(r) }; } } });
  const authority = createSigningAuthority({
    wallets: [{ id: "wallet", backend, policy: { chainId: 1, signer: sender, recipients: [destination], maxNativeValue: 1n, maxGas: 21_000n, maxTotalFee: 21_000n, tokens: [] } }],
    grants: [grant], replayStore: await openFileSigningReplayStore(replayDirectory), verifySimulation: async () => true,
  });
  const endpoint = await listening(t, createSigningAuthorityServer({ authority, tls: { key, cert }, clients: [{ id: "researcher", token }] }));
  const config = { chain: Ethereum, address: sender, endpoint, serverCertificateSha256: fingerprint, ca: cert, token, grantId: grant.id, backend: kind };
  return { endpoint, grant, config, signs: () => signs };
}
function rawRequest(endpoint: string, body: string, authorization = `Bearer ${token}`, extra: Record<string, string> = {}): Promise<{ status: number | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(endpoint, { method: "POST", ca: cert, agent: false, headers: { "content-type": "application/json", authorization, ...extra } }, (res) => {
      const chunks: Buffer[] = []; res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("error", reject); req.end(body);
  });
}
const wire = (g: SigningGrant) => ({ version: 1, grantId: g.id, requestId: "34".repeat(16), requestHash: signingRequestHash(g.request), expectedBackend: "external-service" as const });

test("both backends work through pinned HTTPS and the existing ExternalSigner interface", async (t) => {
  for (const kind of ["external-service", "hardware-wallet"] as const) {
    const f = await fixture(t, kind);
    const client = authorityExternalSigner(f.config);
    assert.equal(await client.signTransaction(tx), await account.signTransaction(serializableTransfer(tx)));
    assert.equal(client.signTypedData, undefined); assert.equal(client.signEip7702Authorization, undefined);
    await assert.rejects(client.signTransaction(tx)); assert.equal(f.signs(), 1);
  }
});

test("TLS pin, CA validation, caller credential and expected backend cannot be substituted", async (t) => {
  const f = await fixture(t);
  for (const change of [{ serverCertificateSha256: "00".repeat(32) }, { ca: "invalid certificate" }, { token: "unknown_credential_that_is_only_a_test" }]) {
    await assert.rejects(authorityExternalSigner({ ...f.config, ...change }).signTransaction(tx));
  }
  assert.equal(f.signs(), 0);
  await assert.rejects(authorityExternalSigner({ ...f.config, backend: "hardware-wallet" }).signTransaction(tx));
  assert.equal(f.signs(), 0);
});

test("plain HTTP, redirected URLs and ambiguous authority configuration are rejected", async (t) => {
  const f = await fixture(t);
  for (const endpoint of [f.endpoint.replace("https:", "http:"), `${f.endpoint}?redirect=evil`, `${f.endpoint}#fragment`, f.endpoint.replace("/v1/sign", "/other"), f.endpoint.replace("https://", "https://user:password@")]) assert.throws(() => authorityExternalSigner({ ...f.config, endpoint }));
  assert.throws(() => createSigningAuthorityServer({ authority: { async sign() { throw new Error("unused"); } }, tls: { key, cert }, clients: [{ id: "a", token }, { id: "b", token }] }));
});

test("direct HTTPS requests bypassing the library cannot set policies, identities, routes or changed payload hashes", async (t) => {
  const f = await fixture(t);
  const w = wire(f.grant);
  assert.equal((await rawRequest(f.endpoint, JSON.stringify(w), "Bearer invalid")).status, 401);
  for (const body of ["{broken", JSON.stringify({ ...w, callerId: "researcher" }), JSON.stringify({ ...w, policy: { allowAll: true } }), JSON.stringify({ ...w, backend: "hardware-wallet" }), JSON.stringify({ ...w, requestHash: signingRequestHash({ ...tx, value: 2n }) })]) {
    const response = await rawRequest(f.endpoint, body); assert.equal(response.status, 403); assert.equal(response.body, '{"error":"signing_denied"}');
  }
  assert.equal((await rawRequest(f.endpoint, JSON.stringify(w), `Bearer ${token}`, { "content-encoding": "gzip" })).status, 400);
  assert.equal(f.signs(), 0);
});

test("an arbitrary Node client cannot bypass authority policy using direct imports", async (t) => {
  const f = await fixture(t);
  const malicious = JSON.stringify({ ...wire(f.grant), requestHash: signingRequestHash({ ...tx, to: sender }) });
  const source = `import https from 'node:https'; const [url, ca, token, body] = process.argv.slice(1); const req=https.request(url,{method:'POST',ca,agent:false,headers:{'content-type':'application/json',authorization:'Bearer '+token}},res=>{res.resume();res.on('end',()=>{process.exitCode=res.statusCode===403?0:2;});});req.on('error',()=>{process.exitCode=3;});req.end(body);`;
  const code = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", source, f.endpoint, cert, token, malicious], { windowsHide: true, stdio: "ignore", env: { ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) } });
    child.on("error", reject); child.on("exit", resolve);
  });
  assert.equal(code, 0); assert.equal(f.signs(), 0);
});

test("HTTPS response binding and cryptographic payload verification reject compromised service output", async (t) => {
  const base = await fixture(t);
  const changed = await account.signTransaction(serializableTransfer({ ...tx, value: 0n }));
  for (const mode of ["payload", "request", "leak"] as const) {
    const authority: SigningAuthority = { async sign(_caller, value) {
      if (mode === "leak") throw new Error("secret-provider-key-must-not-leak");
      return { ...wire(base.grant), ...(value as ReturnType<typeof wire>), ...(mode === "request" ? { requestId: "00".repeat(16) } : {}), version: 1, backend: "external-service", rawTransaction: changed };
    } };
    const endpoint = await listening(t, createSigningAuthorityServer({ authority, tls: { key, cert }, clients: [{ id: "researcher", token }] }));
    await assert.rejects(authorityExternalSigner({ ...base.config, endpoint }).signTransaction(tx), (e: unknown) => { assert.doesNotMatch(String(e), /secret-provider/); return true; });
  }
});

test("HTTPS client deadline is bounded even when authority never responds", async (t) => {
  const base = await fixture(t);
  const endpoint = await listening(t, createSigningAuthorityServer({ authority: { sign: () => new Promise(() => {}) }, tls: { key, cert }, clients: [{ id: "researcher", token }] }));
  await assert.rejects(authorityExternalSigner({ ...base.config, endpoint, timeoutMs: 50 }).signTransaction(tx));
});

test("request and response limits reject oversized messages, and redirects are never followed", async (t) => {
  const f = await fixture(t);
  const oversized = await rawRequest(f.endpoint, JSON.stringify({ padding: "x".repeat(2048) })).catch(() => ({ status: 0 }));
  assert.ok(oversized.status === 413 || oversized.status === 0);
  assert.equal(f.signs(), 0);
  for (const mode of ["redirect", "oversized"] as const) {
    let requests = 0;
    const server = createServer({ key, cert }, (_req, res) => {
      requests++;
      if (mode === "redirect") { res.writeHead(302, { location: "/other", "content-type": "application/json" }); res.end("{}"); }
      else { res.writeHead(200, { "content-type": "application/json" }); res.end("x".repeat(9000)); }
    });
    const endpoint = await listening(t, server);
    await assert.rejects(authorityExternalSigner({ ...f.config, endpoint }).signTransaction(tx));
    assert.equal(requests, 1);
  }
});
