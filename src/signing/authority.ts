import type { Hex } from "viem";
import { EraDiagnosticError } from "../diagnostics.js";
import { immutableSnapshot } from "../internal/snapshot.js";
import { assertExternalRawTransaction } from "../internal/evm-signed-request.js";
import type { ExternalTransactionSigningRequest } from "../web3/external-signer.js";
import type { SigningBackend } from "./backends.js";
import { assertTransferPolicy, identifier, record, signingError, signingRequestHash, validateTransferPolicy, validateTransferRequest, type TransferPolicy } from "./policy.js";
import type { SigningReplayStore } from "./replay-store.js";

export interface SigningGrant {
  readonly id: string;
  readonly callerId: string;
  readonly walletId: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly request: ExternalTransactionSigningRequest;
}
export interface AuthoritySigningRequest {
  readonly version: 1;
  readonly grantId: string;
  readonly requestId: string;
  readonly requestHash: string;
  readonly expectedBackend: SigningBackend["kind"];
}
export interface AuthoritySigningResponse extends AuthoritySigningRequest {
  readonly backend: SigningBackend["kind"];
  readonly rawTransaction: Hex;
}
export interface SigningAuthority {
  /** callerId MUST come from trusted transport authentication, never the request body. */
  sign(callerId: string, request: unknown): Promise<AuthoritySigningResponse>;
}
export interface AuthorityWallet {
  readonly id: string;
  readonly policy: TransferPolicy;
  readonly backend: SigningBackend;
}

export function parseAuthorityRequest(value: unknown): AuthoritySigningRequest {
  const r = record(value, ["version", "grantId", "requestId", "requestHash", "expectedBackend"]);
  if (r.version !== 1 || !identifier(r.grantId) || typeof r.requestId !== "string" || !/^[0-9a-f]{32}$/.test(r.requestId)
    || typeof r.requestHash !== "string" || !/^[0-9a-f]{64}$/.test(r.requestHash)
    || (r.expectedBackend !== "external-service" && r.expectedBackend !== "hardware-wallet")) throw signingError("InvalidRequest");
  return Object.freeze({ version: 1, grantId: r.grantId, requestId: r.requestId, requestHash: r.requestHash, expectedBackend: r.expectedBackend });
}

export function createSigningAuthority(input: {
  readonly wallets: readonly AuthorityWallet[];
  readonly grants: readonly SigningGrant[];
  readonly replayStore: SigningReplayStore;
  /** Trusted-host observer; must verify the exact transaction/context independently of the caller. */
  readonly verifySimulation: (request: ExternalTransactionSigningRequest, signal: AbortSignal) => Promise<boolean>;
}): SigningAuthority & { revokeGrant(grantId: string): Promise<void> } {
  if (!Array.isArray(input.wallets) || input.wallets.length < 1 || input.wallets.length > 100 || !Array.isArray(input.grants) || input.grants.length > 10_000) throw signingError("Denied");
  const consume = input.replayStore.consume.bind(input.replayStore);
  const verifySimulation = input.verifySimulation;
  const wallets = new Map(input.wallets.map((wallet: AuthorityWallet) => {
    if (!identifier(wallet.id) || !["external-service", "hardware-wallet"].includes(wallet.backend.kind)) throw signingError("Denied");
    const policy = validateTransferPolicy(wallet.policy);
    if (wallet.backend.chainId !== policy.chainId || wallet.backend.signer.toLowerCase() !== policy.signer.toLowerCase()) throw signingError("Denied");
    return [wallet.id, Object.freeze({ policy, kind: wallet.backend.kind, sign: wallet.backend.sign.bind(wallet.backend) })] as const;
  }));
  if (wallets.size !== input.wallets.length) throw signingError("Denied");
  // One custody route per signing identity, even across chains. This also avoids
  // simultaneous device prompts through aliases of the same wallet.
  const routes = new Set([...wallets.values()].map((wallet) => wallet.policy.signer.toLowerCase()));
  if (routes.size !== wallets.size) throw signingError("Denied");
  const grants = new Map(input.grants.map((value: SigningGrant) => {
    const grant = immutableSnapshot(value);
    record(grant, ["id", "callerId", "walletId", "createdAtMs", "expiresAtMs", "request"]);
    if (![grant.id, grant.callerId, grant.walletId].every(identifier) || !Number.isSafeInteger(grant.createdAtMs) || grant.createdAtMs < 0
      || !Number.isSafeInteger(grant.expiresAtMs) || grant.expiresAtMs <= grant.createdAtMs || grant.expiresAtMs - grant.createdAtMs > 600_000) throw signingError("Denied");
    const wallet = wallets.get(grant.walletId);
    if (!wallet) throw signingError("Denied");
    validateTransferRequest(grant.request);
    assertTransferPolicy(grant.request, wallet.policy);
    return [grant.id, Object.freeze({ ...grant, hash: signingRequestHash(grant.request) })] as const;
  }));
  if (grants.size !== input.grants.length) throw signingError("Denied");
  const busy = new Set<string>();
  // Store failure may occur after a claim was written; never retry a reservation
  // in this process, even if a custom store fails before persisting it.
  const attempted = new Set<string>();
  const revoked = new Set<string>();
  return Object.freeze({
    async revokeGrant(grantId: string): Promise<void> {
      if (!grants.has(grantId)) throw signingError("Denied");
      revoked.add(grantId);
      try { await consume([`grant:${grantId}`]); }
      catch (error) {
        if (!(error instanceof EraDiagnosticError) || error.diagnostic.kind !== "SigningAuthorityConsumed") throw signingError("Unavailable");
      }
    },
    async sign(callerId: string, value: unknown): Promise<AuthoritySigningResponse> {
      const wire = parseAuthorityRequest(value);
      const grant = grants.get(wire.grantId);
      if (!grant || grant.callerId !== callerId || wire.requestHash !== grant.hash) throw signingError("Denied");
      const wallet = wallets.get(grant.walletId)!;
      if (wire.expectedBackend !== wallet.kind || revoked.has(grant.id)) throw signingError("Denied");
      const wallStart = Date.now();
      const monoStart = performance.now();
      const now = () => Math.max(Date.now(), wallStart + performance.now() - monoStart);
      const assertLive = () => {
        if (revoked.has(grant.id)) throw signingError("Denied");
        if (Date.now() < wallStart || now() < grant.createdAtMs || now() >= grant.expiresAtMs) throw signingError("Expired");
      };
      assertLive();
      if (busy.has(grant.walletId)) throw signingError("Unavailable");
      if (attempted.has(grant.id)) throw signingError("Consumed");
      attempted.add(grant.id);
      busy.add(grant.walletId);
      const controller = new AbortController();
      const operation = (async () => {
        try {
          await consume([`grant:${grant.id}`, `nonce:${grant.request.chain.id}:${grant.request.from.toLowerCase()}:${grant.request.nonce}`]);
          assertLive();
          if (await verifySimulation(grant.request, controller.signal) !== true) throw signingError("Denied");
          assertLive();
          assertTransferPolicy(grant.request, wallet.policy);
          const raw = await wallet.sign(grant.request, controller.signal);
          assertLive();
          if (typeof raw !== "string" || raw.length > 4096 || !/^0x(?:[0-9a-fA-F]{2})+$/.test(raw)) throw signingError("InvalidSignature");
          try { await assertExternalRawTransaction(grant.request, raw); } catch { throw signingError("InvalidSignature"); }
          assertLive();
          return Object.freeze({ ...wire, backend: wallet.kind, rawTransaction: raw });
        } finally { busy.delete(grant.walletId); }
      })();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(signingError("Expired")); }, Math.max(1, Math.ceil(grant.expiresAtMs - now())));
        })]);
      } catch (error) {
        // Only fixed local diagnostics cross the boundary, never provider causes.
        if (error instanceof EraDiagnosticError) {
          const d = error.diagnostic;
          if (d.code === "ES4910" && ["Consumed", "Expired", "Denied", "InvalidSignature"].some((k) => d.kind === `SigningAuthority${k}`)) throw signingError(d.kind!.slice(16) as "Consumed" | "Expired" | "Denied" | "InvalidSignature");
        }
        throw signingError("Unavailable");
      } finally { if (timer !== undefined) clearTimeout(timer); }
    },
  });
}
