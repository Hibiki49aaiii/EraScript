import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test, { type TestContext } from "node:test";
import { encodeFunctionData, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EraDiagnosticError } from "../src/diagnostics.js";
import { createSigningAuthority, hardwareWalletSigningBackend, openFileSigningReplayStore, serviceSigningBackend, signingRequestHash, type SigningBackend, type SigningGrant, type TransferPolicy } from "../src/signing/index.js";
import { serializableTransfer } from "../src/signing/policy.js";
import { address, Ethereum, type ExternalSigner, type ExternalTransactionSigningRequest } from "../src/web3/index.js";

// Public deterministic test scalar, never a funded account or operational key.
const account = privateKeyToAccount(`0x${"0".repeat(63)}1`);
const recipient = address("0x0000000000000000000000000000000000000022", Ethereum);
const token = address("0x0000000000000000000000000000000000000033", Ethereum);
const signerAddress = address(account.address, Ethereum);
const hasKind = (kind: string) => (e: unknown) => e instanceof EraDiagnosticError && e.diagnostic.kind === `SigningAuthority${kind}`;
const request = (overrides: Partial<ExternalTransactionSigningRequest> = {}): ExternalTransactionSigningRequest => ({
  kind: "external-transaction-signing-request", chain: Ethereum, transactionType: "eip1559", from: signerAddress,
  to: recipient, value: 10n, nonce: 5, gas: 21_000n, fee: { type: "eip1559", maxFeePerGas: 2n, maxPriorityFeePerGas: 1n },
  simulation: { status: "success", stateOverrides: false, blockNumber: 100n, blockHash: `0x${"ab".repeat(32)}`, provider: "trusted-observer" }, ...overrides,
});
const policy: TransferPolicy = { chainId: 1, signer: signerAddress, recipients: [recipient], maxNativeValue: 10n, maxGas: 100_000n, maxTotalFee: 200_000n, tokens: [{ address: token, maxAmount: 100n }] };
function grant(r = request(), overrides: Partial<SigningGrant> = {}): SigningGrant {
  const now = Date.now();
  return { id: "approved-1", callerId: "researcher", walletId: "wallet", createdAtMs: now - 1_000, expiresAtMs: now + 60_000, request: r, ...overrides };
}
const wire = (g: SigningGrant, expectedBackend: SigningBackend["kind"] = "external-service") => ({ version: 1, grantId: g.id, requestId: "12".repeat(16), requestHash: signingRequestHash(g.request), expectedBackend });
const signRaw = (r: ExternalTransactionSigningRequest) => account.signTransaction(serializableTransfer(r));
const external: ExternalSigner = { kind: "external-signer", address: signerAddress, chain: Ethereum, signTransaction: signRaw };
async function fixture(t: TestContext, backend: SigningBackend = serviceSigningBackend(external), grants = [grant()]) {
  const directory = await mkdtemp(join(tmpdir(), "era-authority-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const replayStore = await openFileSigningReplayStore(directory);
  const input = { wallets: [{ id: "wallet", policy, backend }], grants, replayStore, verifySimulation: async () => true };
  return { directory, input, authority: createSigningAuthority(input) };
}

test("both service and hardware routes sign the exact transaction and never broadcast", async (t) => {
  let displays = 0;
  let deviceSigns = 0;
  const hardware = hardwareWalletSigningBackend({ signer: signerAddress, chainId: 1, bridge: {
    async displayAddress() { displays++; return signerAddress; },
    async signTransaction(input) {
      deviceSigns++;
      assert.equal(input.requireClearSigning, true);
      assert.ok(input.unsignedTransaction.startsWith("0x02"));
      assert.ok(Object.isFrozen(input.request.simulation));
      return { approval: "device", rawTransaction: await signRaw(input.request) };
    },
  } });
  for (const backend of [serviceSigningBackend(external), hardware]) {
    const g = grant();
    const f = await fixture(t, backend, [g]);
    const result = await f.authority.sign("researcher", wire(g, backend.kind));
    assert.equal(result.backend, backend.kind);
    assert.equal(result.rawTransaction, await signRaw(g.request));
    await assert.rejects(f.authority.sign("researcher", wire(g, backend.kind)), hasKind("Consumed"));
  }
  assert.equal(displays, 1); assert.equal(deviceSigns, 1);
});

test("canonical ERC20 recipient/amount and legacy native transfers are supported", async (t) => {
  const data = encodeFunctionData({ abi: parseAbi(["function transfer(address to, uint256 amount)"]), functionName: "transfer", args: [recipient, 100n] });
  for (const r of [request({ to: token, value: 0n, data }), request({ transactionType: "legacy", fee: { type: "legacy", gasPrice: 2n } })]) {
    const g = grant(r);
    const { authority } = await fixture(t, undefined, [g]);
    assert.equal((await authority.sign("researcher", wire(g))).rawTransaction, await signRaw(r));
  }
});

test("operator policy rejects wrong chain, sender, recipient, amount, fees and unsafe formats before signing", async (t) => {
  const f = await fixture(t);
  const abi = parseAbi(["function transfer(address to, uint256 amount)"]);
  const cases: Partial<ExternalTransactionSigningRequest>[] = [
    { chain: { name: "wrong", id: 10 } }, { from: recipient }, { to: token }, { value: 11n }, { gas: 100_001n },
    { fee: { type: "eip1559", maxFeePerGas: 20n, maxPriorityFeePerGas: 1n } },
    { fee: { type: "eip1559", maxFeePerGas: 1n, maxPriorityFeePerGas: 2n } },
    { transactionType: "eip7702" }, { authorizationList: [] }, { nonce: -1 }, { data: "0xdeadbeef" },
    { simulation: { status: "success", stateOverrides: true } }, { value: -1n },
    { value: 0n, to: token, data: encodeFunctionData({ abi, functionName: "transfer", args: [recipient, 101n] }) },
    { value: 0n, to: token, data: encodeFunctionData({ abi, functionName: "transfer", args: [signerAddress, 100n] }) },
    { value: 0n, to: token, data: `${encodeFunctionData({ abi, functionName: "transfer", args: [recipient, 100n] })}00` },
  ];
  for (const change of cases) assert.throws(() => createSigningAuthority({ ...f.input, grants: [grant(request(change))] }));
  assert.throws(() => createSigningAuthority({ ...f.input, grants: [grant({ ...request(), to: undefined } as unknown as ExternalTransactionSigningRequest)] }));
  assert.equal((await readdir(f.directory)).length, 0);
  assert.throws(() => createSigningAuthority({ ...f.input, wallets: [f.input.wallets[0]!, { ...f.input.wallets[0]!, id: "alias" }] }), hasKind("Denied"));
});

test("raw bypass requests cannot install policy, alter context, choose backend or impersonate caller", async (t) => {
  let calls = 0;
  const backend = serviceSigningBackend({ ...external, async signTransaction(r) { calls++; return signRaw(r); } });
  const g = grant();
  const { authority } = await fixture(t, backend, [g]);
  for (const value of [null, [], {}, { ...wire(g), backend: "hardware-wallet" }, { ...wire(g), policy }, { ...wire(g), callerId: "researcher" }, { ...wire(g), version: 2 }, { ...wire(g), requestHash: "ff".repeat(32) }, { ...wire(g), grantId: "unknown" }, { ...wire(g), requestId: "x".repeat(1_000) }]) {
    await assert.rejects(authority.sign("researcher", value));
  }
  await assert.rejects(authority.sign("other", wire(g)), hasKind("Denied"));
  assert.equal(calls, 0);
  await authority.sign("researcher", wire(g));
  assert.equal(calls, 1);
});

test("consumption survives authority/store restart and conflicts across backend and grant IDs", async (t) => {
  const g = grant();
  const f = await fixture(t, undefined, [g]);
  await f.authority.sign("researcher", wire(g));
  const restart = createSigningAuthority({ ...f.input, replayStore: await openFileSigningReplayStore(f.directory) });
  await assert.rejects(restart.sign("researcher", wire(g)), hasKind("Consumed"));
  const otherGrant = { ...g, id: "approved-2" };
  const other = createSigningAuthority({ ...f.input, grants: [otherGrant], wallets: [{ ...f.input.wallets[0]!, backend: { ...f.input.wallets[0]!.backend, kind: "hardware-wallet" } }] });
  await assert.rejects(other.sign("researcher", wire(otherGrant, "hardware-wallet")), hasKind("Consumed"));
});

test("exclusive replay reservations permit only one of concurrent authorities", async (t) => {
  let calls = 0;
  const g = grant();
  const f = await fixture(t, serviceSigningBackend({ ...external, async signTransaction(r) { calls++; await delay(20); return signRaw(r); } }), [g]);
  const other = createSigningAuthority({ ...f.input, replayStore: await openFileSigningReplayStore(f.directory) });
  const results = await Promise.allSettled([f.authority.sign("researcher", wire(g)), other.sign("researcher", wire(g))]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(calls, 1);
});

test("replay reservation also excludes a separate Node process", async (t) => {
  const f = await fixture(t);
  const moduleUrl = new URL("../src/signing/replay-store.js", import.meta.url).href;
  const run = () => new Promise<number | null>((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", `import {openFileSigningReplayStore} from ${JSON.stringify(moduleUrl)}; try { await (await openFileSigningReplayStore(process.argv[1])).consume(['offline-cross-process']); process.exitCode=0; } catch {process.exitCode=3;}`, f.directory], { stdio: "ignore", windowsHide: true });
    child.on("error", reject); child.on("exit", resolve);
  });
  assert.deepEqual((await Promise.all([run(), run()])).sort(), [0, 3]);
});

test("simulation rejection, callback failure and bad signatures consume approval without leaking provider details", async (t) => {
  for (const mode of ["simulation", "provider", "signature"] as const) {
    let calls = 0;
    const g = grant();
    const f = await fixture(t, serviceSigningBackend({ ...external, async signTransaction(r) { calls++; if (mode === "provider") throw new Error("provider-secret-do-not-expose"); return signRaw({ ...r, value: 9n }); } }), [g]);
    const authority = createSigningAuthority({ ...f.input, verifySimulation: async () => mode !== "simulation" });
    await assert.rejects(authority.sign("researcher", wire(g)), (error: unknown) => {
      assert.ok(error instanceof EraDiagnosticError); assert.doesNotMatch(JSON.stringify(error), /provider-secret/); return true;
    });
    await assert.rejects(createSigningAuthority(f.input).sign("researcher", wire(g)), hasKind("Consumed"));
    assert.equal(calls, mode === "simulation" ? 0 : 1);
  }
});

test("hardware rejection, address substitution and missing device approval never fall back", async (t) => {
  for (const mode of ["reject", "address", "approval"] as const) {
    let signs = 0;
    const backend = hardwareWalletSigningBackend({ signer: signerAddress, chainId: 1, bridge: {
      async displayAddress() { return mode === "address" ? recipient : signerAddress; },
      async signTransaction({ request: r }) { signs++; if (mode === "reject") throw new Error("device refused"); return { approval: "host" as "device", rawTransaction: await signRaw(r) }; },
    } });
    const g = grant(); const f = await fixture(t, backend, [g]);
    await assert.rejects(f.authority.sign("researcher", wire(g, "hardware-wallet")));
    assert.equal(signs, mode === "address" ? 0 : 1);
    await assert.rejects(createSigningAuthority(f.input).sign("researcher", wire(g, "hardware-wallet")), hasKind("Consumed"));
  }
});

test("snapshots bind grants, policies and callback references despite caller mutation", async (t) => {
  const r = request(); const g = grant(r);
  const recipients = [recipient];
  const f = await fixture(t, undefined, [g]);
  const configuration = { ...f.input, wallets: [{ ...f.input.wallets[0]!, policy: { ...policy, recipients } }] };
  const authority = createSigningAuthority(configuration);
  const w = wire(g);
  recipients[0] = signerAddress;
  (r as { value: bigint }).value = 999n;
  configuration.verifySimulation = async () => { throw new Error("substituted callback"); };
  assert.equal((await authority.sign("researcher", w)).rawTransaction, await signRaw(request()));
});

test("deadline after simulation prevents backend signing; late device completion remains consumed", async (t) => {
  let signCalls = 0;
  const backend = serviceSigningBackend({ ...external, async signTransaction(r) { signCalls++; return signRaw(r); } });
  const g = grant(request(), { createdAtMs: Date.now() - 1_000, expiresAtMs: Date.now() + 1_000 });
  const f = await fixture(t, backend, [g]);
  let finish!: (value: boolean) => void;
  const authority = createSigningAuthority({ ...f.input, verifySimulation: () => new Promise<boolean>((resolve) => { finish = resolve; }) });
  await assert.rejects(authority.sign("researcher", wire(g)), hasKind("Expired"));
  finish(true); await delay(10); assert.equal(signCalls, 0);
});

test("timed-out backend stays busy until its underlying operation settles", async (t) => {
  let release!: (raw: Hex) => void;
  let calls = 0;
  const backend = serviceSigningBackend({ ...external, signTransaction() { calls++; return new Promise<Hex>((resolve) => { release = resolve; }); } });
  const g = grant(request(), { createdAtMs: Date.now() - 1_000, expiresAtMs: Date.now() + 1_000 });
  const next = grant(request({ nonce: 6 }), { id: "next" });
  const f = await fixture(t, backend, [g, next]);
  await assert.rejects(f.authority.sign("researcher", wire(g)), hasKind("Expired"));
  await assert.rejects(f.authority.sign("researcher", wire(next)), hasKind("Unavailable"));
  assert.equal(calls, 1);
  release(await signRaw(g.request)); await delay(10);
});

test("missing replay directory and store failure fail closed before provider access", async (t) => {
  const g = grant(); const f = await fixture(t);
  await assert.rejects(openFileSigningReplayStore(join(f.directory, "missing")), hasKind("Unavailable"));
  let calls = 0;
  const authority = createSigningAuthority({ ...f.input, replayStore: { async consume() { throw new Error("store failure path secret"); } }, verifySimulation: async () => { calls++; return true; } });
  await assert.rejects(authority.sign("researcher", wire(g)), hasKind("Unavailable"));
  await assert.rejects(authority.sign("researcher", wire(g)), hasKind("Consumed"));
  assert.equal(calls, 0);
});

test("trusted grant revocation persists across restart and prevents signing after async verification", async (t) => {
  let calls = 0;
  const g = grant();
  const f = await fixture(t, serviceSigningBackend({ ...external, async signTransaction(r) { calls++; return signRaw(r); } }), [g]);
  await f.authority.revokeGrant(g.id);
  await assert.rejects(f.authority.sign("researcher", wire(g)), hasKind("Denied"));
  await assert.rejects(createSigningAuthority(f.input).sign("researcher", wire(g)), hasKind("Consumed"));
  const next = grant(request({ nonce: 6 }), { id: "revoke-during-check" });
  let release!: (yes: boolean) => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const authority = createSigningAuthority({ ...f.input, grants: [next], verifySimulation: () => { started(); return new Promise<boolean>((resolve) => { release = resolve; }); } });
  const pending = authority.sign("researcher", wire(next));
  await ready; await authority.revokeGrant(next.id); release(true);
  await assert.rejects(pending, hasKind("Denied"));
  assert.equal(calls, 0);
});

test("replay directory accepts Windows short names but rejects linked path components", async (t) => {
  const f = await fixture(t);
  if (process.platform === "win32") {
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:ERA_REPLAY_TEST_DIR).ShortPath"], { encoding: "utf8", windowsHide: true, timeout: 15_000, env: { ...process.env, ERA_REPLAY_TEST_DIR: f.directory } });
    assert.equal(result.status, 0);
    const short = result.stdout.trim(); assert.ok(short.length > 0);
    await (await openFileSigningReplayStore(short)).consume(["short-name-reservation"]);
    await assert.rejects((await openFileSigningReplayStore(f.directory)).consume(["short-name-reservation"]), hasKind("Consumed"));
  }
  const actual = join(f.directory, "actual"); const linked = join(f.directory, "linked");
  await mkdir(actual); await mkdir(join(actual, "nested"));
  await symlink(actual, linked, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(openFileSigningReplayStore(linked), hasKind("Unavailable"));
  await assert.rejects(openFileSigningReplayStore(join(linked, "nested")), hasKind("Unavailable"));
});
