import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, request as httpsRequest, type Server } from "node:https";
import { checkServerIdentity } from "node:tls";
import type { Hex } from "viem";
import { immutableSnapshot } from "../internal/snapshot.js";
import { assertExternalRawTransaction } from "../internal/evm-signed-request.js";
import type { ExternalSigner, ExternalTransactionSigningRequest } from "../web3/external-signer.js";
import type { Address, EvmChain } from "../web3/types.js";
import type { AuthoritySigningResponse, SigningAuthority } from "./authority.js";
import { identifier, record, signingError, signingRequestHash, validateTransferRequest } from "./policy.js";

function credential(value: string): void {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{32,256}$/.test(value)) throw signingError("Denied");
}
const tokenHash = (s: string) => createHash("sha256").update(s).digest();

/** Creates an unbound TLS server. Caller supplies existing TLS material on the trusted host. */
export function createSigningAuthorityServer(input: {
  readonly authority: SigningAuthority;
  readonly tls: { readonly key: string; readonly cert: string };
  readonly clients: readonly { readonly id: string; readonly token: string }[];
  readonly maxConnections?: number;
}): Server {
  if (!Array.isArray(input.clients) || input.clients.length < 1 || input.clients.length > 100) throw signingError("Denied");
  const clients = input.clients.map(({ id, token }) => {
    if (!identifier(id)) throw signingError("Denied");
    credential(token);
    return { id, digest: tokenHash(token) };
  });
  if (new Set(clients.map((c) => c.id)).size !== clients.length || new Set(clients.map((c) => c.digest.toString("hex"))).size !== clients.length) throw signingError("Denied");
  const sign = input.authority.sign.bind(input.authority);
  const maxConnections = input.maxConnections ?? 32;
  if (!Number.isSafeInteger(maxConnections) || maxConnections < 1 || maxConnections > 256) throw signingError("Denied");
  let active = 0;
  const server = createServer({ key: input.tls.key, cert: input.tls.cert, minVersion: "TLSv1.3", maxHeaderSize: 4096 }, (req, res) => {
    const reply = (status: number, value: unknown) => {
      if (!res.destroyed && !res.writableEnded) {
        const encoded = JSON.stringify(value);
        res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "connection": "close" });
        res.end(encoded);
      }
    };
    req.on("error", () => res.destroy());
    res.on("error", () => res.destroy());
    if (active >= maxConnections) { reply(503, { error: "unavailable" }); return; }
    if (req.method !== "POST" || req.url !== "/v1/sign" || req.headers["content-type"] !== "application/json" || req.headers["content-encoding"] !== undefined) {
      reply(400, { error: "invalid_request" }); return;
    }
    const authorization = req.headers.authorization;
    const presented = typeof authorization === "string" && /^Bearer [A-Za-z0-9_-]{32,256}$/.test(authorization) ? authorization.slice(7) : "";
    const digest = tokenHash(presented);
    const caller = clients.find((c) => timingSafeEqual(c.digest, digest));
    if (!caller) { reply(401, { error: "unauthorized" }); return; }
    active++;
    let size = 0;
    const chunks: Buffer[] = [];
    const bodyTimer = setTimeout(() => { reply(408, { error: "timeout" }); req.destroy(); }, 5_000);
    let complete = false;
    const release = () => { if (!complete) { complete = true; active--; } clearTimeout(bodyTimer); };
    res.once("close", release);
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1024) { reply(413, { error: "invalid_request" }); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      clearTimeout(bodyTimer);
      if (res.writableEnded || res.destroyed) return;
      void (async () => {
        try {
          const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const result = await sign(caller.id, parsed);
          reply(200, result);
        } catch { reply(403, { error: "signing_denied" }); }
        finally { release(); }
      })();
    });
  });
  server.headersTimeout = 5_000;
  server.requestTimeout = 5_000;
  server.keepAliveTimeout = 1_000;
  server.maxConnections = maxConnections;
  server.maxHeadersCount = 16;
  server.on("clientError", (_error, socket) => socket.destroy());
  return server;
}

/** Client access is limited to installed grants; this token is never a provider credential. */
export function authorityExternalSigner<C extends EvmChain>(input: {
  readonly chain: C;
  readonly address: Address<C>;
  readonly endpoint: string;
  readonly serverCertificateSha256: string;
  readonly ca?: string;
  readonly token: string;
  readonly grantId: string;
  readonly backend: "external-service" | "hardware-wallet";
  readonly timeoutMs?: number;
}): ExternalSigner<C> {
  const config = immutableSnapshot(input);
  let endpoint: URL;
  try { endpoint = new URL(config.endpoint); } catch { throw signingError("Denied"); }
  const fingerprint = config.serverCertificateSha256.replaceAll(":", "").toLowerCase();
  const timeoutMs = config.timeoutMs ?? 60_000;
  credential(config.token);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hash || endpoint.search || endpoint.pathname !== "/v1/sign"
    || !/^[0-9a-f]{64}$/.test(fingerprint) || !identifier(config.grantId) || !["external-service", "hardware-wallet"].includes(config.backend)
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) throw signingError("Denied");
  return Object.freeze({
    kind: "external-signer", chain: config.chain, address: config.address, id: `authority:${config.grantId}`,
    async signTransaction(value: ExternalTransactionSigningRequest<C>) {
      const started = performance.now();
      const approved = validateTransferRequest(value);
      if (approved.chain.id !== config.chain.id || approved.from.toLowerCase() !== config.address.toLowerCase()) throw signingError("Denied");
      const wire = Object.freeze({ version: 1, grantId: config.grantId, requestId: randomBytes(16).toString("hex"), requestHash: signingRequestHash(approved), expectedBackend: config.backend });
      const body = JSON.stringify(wire);
      let result: AuthoritySigningResponse;
      try {
        result = await new Promise<AuthoritySigningResponse>((resolve, reject) => {
          const abort = new AbortController();
          const timer = setTimeout(() => abort.abort(), timeoutMs);
          const finish = (error?: Error, response?: AuthoritySigningResponse) => {
            clearTimeout(timer);
            if (error) reject(error); else resolve(response!);
          };
          let req: ReturnType<typeof httpsRequest>;
          try { req = httpsRequest(endpoint, {
            method: "POST", agent: false, minVersion: "TLSv1.3", rejectUnauthorized: true,
            ...(config.ca ? { ca: config.ca } : {}), signal: abort.signal,
            headers: { "authorization": `Bearer ${config.token}`, "content-type": "application/json", "content-length": Buffer.byteLength(body) },
            checkServerIdentity(host, cert) {
              const error = checkServerIdentity(host, cert);
              if (error) return error;
              if (cert.fingerprint256?.replaceAll(":", "").toLowerCase() !== fingerprint) return signingError("Denied");
              return undefined;
            },
          }, (res) => {
            let size = 0;
            const chunks: Buffer[] = [];
            if (res.statusCode !== 200 || res.headers["content-type"] !== "application/json" || res.headers["content-encoding"] !== undefined) {
              res.destroy(); finish(signingError("Denied")); return;
            }
            res.on("data", (chunk: Buffer) => {
              size += chunk.length;
              if (size > 8192) { res.destroy(); finish(signingError("InvalidRequest")); return; }
              chunks.push(chunk);
            });
            res.on("error", () => finish(signingError("Unavailable")));
            res.on("aborted", () => finish(signingError("Unavailable")));
            res.on("end", () => {
              try {
                const r = record(JSON.parse(Buffer.concat(chunks).toString("utf8")), ["version", "grantId", "requestId", "requestHash", "expectedBackend", "backend", "rawTransaction"]);
                if (r.version !== 1 || r.grantId !== wire.grantId || r.requestId !== wire.requestId || r.requestHash !== wire.requestHash || r.backend !== config.backend
                  || r.expectedBackend !== config.backend || typeof r.rawTransaction !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(r.rawTransaction) || r.rawTransaction.length > 4096) throw signingError("InvalidRequest");
                finish(undefined, r as unknown as AuthoritySigningResponse);
              } catch { finish(signingError("InvalidRequest")); }
            });
          }); } catch { finish(signingError("Unavailable")); return; }
          req.on("error", () => finish(signingError("Unavailable")));
          req.end(body);
        });
        await assertExternalRawTransaction(approved, result.rawTransaction as Hex);
        if (performance.now() - started >= timeoutMs) throw signingError("Expired");
      } catch { throw signingError("Unavailable"); }
      return result.rawTransaction;
    },
  });
}
