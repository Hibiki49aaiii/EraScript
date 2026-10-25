# ホワイトハット向けローカル検証ガイド

0.19.0-rc.1 の用途は、許可を得たソースの検査、ABI/calldataの確認、証拠レポートの整合性・署名者確認です。実資金の管理・救済を承認したリリースではありません。実行成功、チェーン確定、資産回復をそれぞれ別に評価します。

## 1. インストールと最初の確認

Node.js 22 または24を使用します。配布候補はリポジトリで `npm run release:prepare` により作成し、`release-artifacts/` の `candidate.json` と `SHA256SUMS` を確認します。レジストリへは公開しません。

新しい作業ディレクトリで、実在する候補tarballへのパスを指定してください。

```sh
npm init -y
npm install --ignore-scripts /path/to/erascript-lang-0.19.0-rc.1.tgz
npx --no-install era --version
npx --no-install era init audit-demo
cd audit-demo
npx --no-install era check --json
npx --no-install era build
npx --no-install era run
```

最後のコマンドは生成した既知の挨拶プログラムを実行します。`init` は既存の `era.json` / `src/main.era` があれば終了コード2で停止し、上書きしません。`build` はプロジェクト内の出力先を使用します。

## 2. 鍵・ネットワークを使わないcalldata確認

インストール先の `node_modules/erascript-lang/examples/whitehat-offline.era` を作業ディレクトリにコピーし、内容を読んでから実行します。

```sh
npx --no-install era check whitehat-offline.era --json
npx --no-install era run whitehat-offline.era
```

サンプルはダミーアドレスに対する ERC-20 `transfer(address,uint256)` をエンコードし、宛先と数量をデコードして照合します。出力は selector=`0xa9059cbb`、rawAmount=`100`、executionVerified=`false`、recoveryVerified=`false` です。署名、RPC、送信は行いません。実際の調査では、対象の正しいABI・チェーン・トークン小数点・権限・宛先を個別に照合してください。calldataだけで送金や回復は証明できません。

## 3. 未知のソースはまず検査

```sh
npx --no-install era check target.era --json
```

不正な固定長16進数、秘密鍵の直書き、一部の秘密環境変数参照、明示的unsafe境界等を診断します。ファイル内のimport別名、変数別名、単純な代入・分割代入にも追従します。全プログラムの安全性を保証する検査ではありません。`era run` は通常のNode権限でコードを実行するため、不明なソースは実鍵・認証情報のない隔離環境で扱ってください。

## 4. レポートの検証

整合性だけを見る場合:

```sh
npx --no-install era verify report.json --integrity-only --json
```

`integrity=true` はハッシュ整合性、`authenticated=false` は発行者未認証を示します。`ok=true` だけを業務上の成功条件にしてはいけません。

組織の検証者から、レポートと分離署名を取得し、別の信頼できる経路で公開鍵を固定した場合:

```sh
npx --no-install era verify report.json --attestation report.attestation.json --trusted-key verifier-public.pem --require VERIFIED_FINALITY --json
```

救済レポートでは `--require VERIFIED_RECOVERY` を使います。要求状態に達しない場合は終了コード1です。現行の直接入力経路は独立した最終証拠を持たないため、終端状態に昇格しません。署名認証済みの状態宣言でも、信頼した検証者が実際に原始証拠を確認したかは運用上の別条件です。相手が添付した鍵をそのまま信頼済みに指定してはいけません。

引数/ファイル/JSON入力エラーは終了コード2、検証要件不一致は1、要求された検査に合格した場合は0です。`--json` で診断を取得できます。`--integrity-only` と `--require` の併用、未知・重複オプションは拒否されます。入力上限はソース/レポート10MiB、attestation64KiB、公開鍵16KiBです。

## 5. 調査記録と終了

使用コミット・候補SHA256・Nodeバージョン・コマンド・終了コード・信頼鍵ID・採用した公開証拠を残します。秘密鍵、環境変数の実値、顧客データをレポートやGitへ保存しないでください。再現は最小の合成fixtureで行い、脆弱性は [SECURITY.md](../SECURITY.md) の経路で連絡します。残る実運用条件は [RELEASE.md](RELEASE.md) で管理します。
