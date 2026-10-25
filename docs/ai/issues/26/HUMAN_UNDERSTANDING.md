# Issue #26 — HUMAN_UNDERSTANDING

**Issue:** [#26](https://github.com/Hibiki49aaiii/EraScript/issues/26) · **Base Commit SHA:** `a75e81d5e0e82ee8a0d1f7df946d76a6a1ce0ab7` · **Status:** PROPOSED DESIGN, NOT IMPLEMENTED.

## What — 何をするか

EraScriptの `VERIFIED_FINALITY` を、「アプリが取引オブジェクトの状態を `finalized` に設定した」ことではなく、**対象のチェーンと正確な取引、ブロック、最終確定根拠を検証した結果**に限定する設計です。資産救出では、このFinality証拠を[Issue #25](https://github.com/Hibiki49aaiii/EraScript/issues/25)へ渡し、救出先への着金確認と組み合わせて初めて `VERIFIED_RECOVERY` を成立させます。

## Why — なぜ必要か

現行 `src/web3/tx.ts` の `markFinalized` は、チェーンを照会せず `state:"finalized"` に変更できます。一部の直接アダプターはその状態や呼出し元から渡されたRPCステータスを見て高保証の終了状態を報告します。一方、EVM/Solana/SuiのQuorum経路にはより厳しい検証がありますが、証拠の出所や事業者間の独立性まで必ず保証できるわけではありません。

**報告ハッシュが正しいこと ≠ 発行者の認証 ≠ RPC証拠が真実 ≠ Finality確定 ≠ 救出先への着金**です。

## How — 予定するデータフロー

```text
取引IDやステータス（入力は未信頼）
       ↓
信頼境界を定義した観測器：RPC/SDK → 照会元・時刻・対象・ネットワークの結合
       ↓
チェーン別検証：成功Receipt/Effects, canonical block, quorum, finality scope
       ↓
必要な場合 Rollup L1 settlement / 全Jito署名確定
       ↓
証拠に紐付いたFinality判定 F（単なるオブジェクト/ハッシュではない）
       ├→ Multichain VERIFIED_FINALITY（F条件）
       └→ Issue #25: F と独立の受取先資産増分 P
                           ↓
                     VERIFIED_RECOVERY
```

Fに含めるべき情報は `chainId/profileId`, exact transaction hash, canonical receipt block/hash, evidence source/policy, finalized head or settlement, observation freshnessです。ただし **TypeScript型・ブランド・ハッシュを付けただけでは観測元を認証できません**。そのため、Finality判定の生成権限・証拠再検証・呼出し元権限の設計が必須です。

## Important Decisions — 重要な選択

- **推奨A:** 既存の直接アダプターから、客観的証拠のない `VERIFIED_FINALITY` 昇格を禁止する。セキュリティ上一貫しますが、既存APIの挙動変更になります。
- **代替B:** 厳格な新APIを作り、旧APIは未検証の終端成功を返さず観測段階へ格下げする。段階的移行は可能ですがAPIが増えます。
- **拒否:** 構造化オブジェクト、自己生成hashまたは任意の `"finalized"` 文字列を信頼済みFinality証拠として認める。
- **保留:** 検証者を同一プロセスに置くか独立サービスにするか（外部npmコードを含むNode実行環境は信頼境界になりません）。
- Solanaのblock identityとSuiのeffects identityは現状構成可能なオプションで、すべてのQuorumで必須という意味ではありません。

## Invariants — 守るべき条件

1. 取引の送信 ≠ execution success ≠ chain finality。
2. QuorumプロバイダーIDの重複排除 ≠ オペレーターの独立性。
3. EVMの `confirmed` Quorum（既定で `requireFinalized=false`） ≠ finalized-headによる確定。
4. RollupのL2確定 ≠ 必要なL1 settlement。
5. Jitoバンドルのlanded ≠ 全署名の確定。
6. RAILGUNのbase EVM確定 ≠ プライベート残高の期待どおりの変化。
7. Issue #25の資産受取証拠 P はFinality Fとは独立して必要。
8. signed attestationは発行者の主張を認証するが、元のRPCを独立に検証しません。

## Failure Modes — 失敗時

ブロック再編成、古い観測、取引ハッシュ/チェーン/ブロック不一致、RPC同士の不整合、失敗Receipt、Rollup L1根拠不足、Solana署名不一致、Sui効果不一致、Jito部分確定、RAILGUNプライベート検証失敗、署名済レポートの虚偽内容 → 高保証の最終状態に昇格させない。

## Change Impact / 未完了項目

**今回の変更は設計Markdownのみです。** 実行コード、既存テスト、秘密鍵、署名、チェーン送信、依存関係や本番環境には変更しません。40件のテストケースは **計画であり未実行** です。

重要なAPI移行方式と検証者の信頼境界は未決定です。実装前には[決定ゲート](DECISIONS.md)および[事前レビュー](PRE_IMPLEMENTATION_REVIEW.md)を承認し、実装後に実行CIと独立レビューを別途記録します。

関連：[実装計画](IMPLEMENTATION_PLAN.md)、[テスト計画](TEST_MATRIX.md)、[Issue #25設計PR #28](https://github.com/Hibiki49aaiii/EraScript/pull/28)。
