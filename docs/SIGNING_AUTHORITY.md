# 外部署名サービスとハードウェアウォレット

`erascript-lang/signing` は、信頼済みホスト側で承認内容を強制する追加APIです。ウォレットごとに `external-service` または `hardware-wallet` を明示して使います。失敗時の自動切替、複数方式による共同署名、送信処理はありません。

同一authority内で同じ署名アドレスを複数wallet IDに登録することも拒否します。別名で方式を切り替えたり、同じデバイスへの要求を重ねたりしないためです。現在は同じアドレスの複数チェーン登録も同一authorityでは扱わず、設定切替時に全処理の終了を確認します。複数ホストで同じ鍵を同時運用しないでください。

現在の実装範囲は EVM の legacy / EIP-1559 による通常送金と、正確にエンコードされた ERC-20 `transfer(address,uint256)` です。EIP-712、EIP-7702、コントラクト作成、その他の関数、Solana/Sui用のauthority経路は未対応として拒否します。既存APIの互換性は維持します。

## 最初に確認する境界

`era run` は通常のNodeプロセスです。署名ゲートを同一ユーザーの別プロセスとして起動するだけでは、秘密鍵・provider認証情報・USB・設定ファイルへのアクセスを隔離できません。信頼済みホストを分離し、スクリプト側から署名provider・デバイス・grant設定・使用済み記録に直接アクセスできない構成が必要です。

サーバー証明書のCA検証・ホスト名検証・SHA256 pinで接続先を確認します。クライアントのtokenは承認済みgrantへのアクセス専用で、providerの署名権限を持つ認証情報を渡してはいけません。tokenを持つコードは、期限内のgrantを要求できます。grantは「実行してよい具体的取引」の承認であり、承認後の呼出時刻を人間に再確認する仕組みではありません。

実機はまだ選定・検証していません。ハードウェアAPIは信頼するデバイスドライバーとの接続契約です。模擬bridgeの `approval: "device"` は実機の認証や画面表示の証拠になりません。端末、ファームウェア、アプリ、SDK、表示内容を個別に検証するまで実機対応完了とは扱いません。

## 鍵を使わない動作確認

ビルド後のcheckout、またはインストールしたパッケージで実行します。

```sh
node examples/signing-authority-offline.mjs
# installed package:
node node_modules/erascript-lang/examples/signing-authority-offline.mjs
```

公開テストfixtureの固定署名（chainId=1337）を使い、両方式の共通検証と再利用拒否を確認します。RPC・サーバー起動・実鍵・実機・送信は使いません。出力の `realDeviceUsed` / `executionVerified` / `recoveryVerified` はすべてfalseです。fixtureのsimulation verifierやdevice bridgeを本番設定に転用しないでください。

## 信頼済みホストの組み立て

使用するAPI:

```ts
import {
  createSigningAuthority, createSigningAuthorityServer,
  openFileSigningReplayStore, serviceSigningBackend,
  hardwareWalletSigningBackend,
} from "erascript-lang/signing";
```

1. `serviceSigningBackend(providerSigner)` に既存の `ExternalSigner` と互換のproviderアダプターを渡します。providerのSDK・認証情報はこのホスト内だけで管理します。
2. `hardwareWalletSigningBackend({ signer, chainId, bridge })` にデバイスbridgeを渡します。bridgeは `displayAddress(signal)` で端末にアドレスを表示して確認し、`signTransaction({ request, unsignedTransaction, requireClearSigning: true, signal })` で取引内容を表示して人間の承認を得ます。キャンセル・clear signing未対応・切断は拒否します。承認時だけ `{ approval: "device", rawTransaction }` を返します。blind signingへの自動切替は禁止です。
3. `TransferPolicy` にchainId、署名者、送金先、最大ネイティブ額、gas上限、最大総手数料、許可tokenと最大数量を設定します。総手数料は `gas × gasPrice` または `gas × maxFeePerGas` で検査します。token数量は小数点換算前の整数です。
4. `SigningGrant` にid、callerId、walletId、createdAtMs、expiresAtMs、正確な `ExternalTransactionSigningRequest` を設定します。最長10分です。nonce・金額・宛先・calldata・手数料・simulation contextの変更は別の承認が必要です。grantのHTTP作成・更新APIはありません。
5. 事前に作成・保護した運用ディレクトリを `openFileSigningReplayStore(path)` で開きます。初回は空でも構いません。以後、使用済み記録を保持します。任意のscriptから書込み・削除できないACL/所有権を設定してください。
6. `createSigningAuthority({ wallets, grants, replayStore, verifySimulation })` を作ります。`verifySimulation(request, signal)` はauthority自身が選んだ観測先で、正確な取引とブロックcontextを検査します。callerが渡したsuccessフラグだけでtrueを返してはいけません。接続失敗・古い状態・nonce競合・不一致はfalseまたは例外にします。
7. `createSigningAuthorityServer({ authority, tls: { key, cert }, clients: [{ id, token }] })` でTLSサーバーを作り、明示した管理下のinterfaceで `listen` します。TLS証明書・十分なランダム性を持つ32～256文字のURL-safe tokenは既存の安全な運用経路から渡します。このAPIは発行や保管を代行しません。

サーバーはTLS1.3、POST `/v1/sign` のみです。本文1KiB、header4KiB、本文受信5秒、同時接続既定32。設定や署名providerの例外内容はHTTP応答に含めません。ファイアウォール・接続元制限・監視・可用性対策は運用ホストで設定します。例外と応答を無差別に記録せず、認証header、秘密値、署名済み取引をログへ保存しないでください。

## EraScript側の接続

```ts
import { authorityExternalSigner } from "erascript-lang/signing";
import { externalSignerCapability, signSimulatedWithExternalSigner } from "erascript-lang/web3";

// Values come from the operator through a trusted channel.
const signer = authorityExternalSigner({
  chain, address: approvedSender,
  endpoint: "https://authority.example/v1/sign",
  serverCertificateSha256: approvedCertificateFingerprint,
  token: grantServiceAccessToken,
  grantId: approvedGrantId,
  backend: "hardware-wallet", // or "external-service"; must match installed grant
  timeoutMs: 60_000,
});
const capability = externalSignerCapability(signer, localPolicy);
const signed = await signSimulatedWithExternalSigner(capability, approvedSimulation);
```

上記は組込みの骨組みです。変数は既存の型付き設定・承認済みsimulationから渡します。private CAを使う場合は公開CA証明書を `ca` に渡します。HTTPS以外、認証情報付きURL、query/hash、redirectは拒否します。接続ごとにCA/hostname/pinを検証し、応答のrequestId/hash/方式と署名済み取引の内容・送信者を照合します。通信失敗は自動再試行しません。

## 再利用防止、取消、障害復旧

署名前にgrantIdと `(chainId, signer, nonce)` をexclusive-createで消費し、file syncします。別方式・別grantで同じnonceを要求しても拒否します。取消・失敗・切断・期限切れでも記録を戻しません。途中まで記録して失敗した場合も拒否側に倒します。未知の要求で無制限にファイルを作らず、承認済みgrantだけを記録します。

管理側の `await authority.revokeGrant(id)` はgrantを消費し、同一authority内の処理中要求も各非同期境界で拒否します。HTTPからは呼べません。取消したgrantは設定からも削除し、複数authorityを動かす場合は全インスタンスを停止・更新してください。他プロセスで既に実行中の署名を取り消す分散機能はありません。

ファイルstoreは単一ホストのローカルfilesystem向けです。共有NFS、複数ホストの分散排他、バックアップ巻戻し、停電時の永続性を保証しません。POSIXでは親directoryもsyncし、Windowsのdirectory metadataとストレージ書込み保証は実ホスト検証が必要です。再起動時の排他はテストしますが、停電試験の代用ではありません。

署名処理が時間切れになっても、provider/deviceが署名を完了している可能性があります。同じwalletは実処理が終了するまでbusyを維持します。署名済み取引そのものにgrantの期限は入りません。EVMではnonceが消費されるまで有効な場合があります。復旧ではprovider/device状態とチェーンnonceを確認し、旧grant/claimを削除して再実行しないでください。現在は結果取得・自動冪等再送のAPIを設けていません。

## 検証と残る条件

Coreテストは公開テストscalar・固定fixtureと一時TLS証明書のみを使います。HTTPSテストではOpenSSLが必要です（Windows CIではGit for Windows付属版、LinuxではPATHのopenssl）。既存の外部署名検証、直接HTTPSの不正要求、別Nodeプロセス、同時消費、再起動、期限切れ、偽の署名、デバイス拒否、取消を検査します。

独立したセキュリティレビュー、選定機種の実機ドライバー、実ホストのACL/ネットワーク/USB分離、trusted simulationの実接続、停電時のstore復旧、監査と認証情報失効運用は未検証です。Issue #27を完了や正式リリース可能とは扱いません。実行・finality・回復の検証は #25/#26 の別条件です。

実装根拠: [Node22 filesystem flags](https://nodejs.org/docs/latest-v22.x/api/fs.html#file-system-flags)、[Node HTTPS](https://nodejs.org/docs/latest-v22.x/api/https.html)、インストール済みviem 2.56.0のserialize/parse/recover API。機種選定時は [Ledger Ethereum Signer Kit](https://developers.ledger.com/docs/device-interaction/dmk-ts/references/signers/eth) 等の現行公式SDKを確認します。旧LedgerJSの採用を前提にしません。
