# Issue #25 — HUMAN_UNDERSTANDING

**Issue:** [#25](https://github.com/Hibiki49aaiii/EraScript/issues/25) · **Base Commit SHA:** `a75e81d5e0e82ee8a0d1f7df946d76a6a1ce0ab7` · **Status:** PROPOSED DESIGN / NO CODE CHANGE.

## What — 何をする設計か

資産救出で `VERIFIED_RECOVERY` を出す前に、「被害者ウォレットが空になった」だけでなく、**指定した安全な受取先が対象トークンと必要数量を実際に受け取った**ことを、ブロックチェーン上の独立した証拠と結び付けて判断する設計です。

ERC-20では、メタデータの送金先だけでなく、送信トランザクションの**実際のABI calldata** と署名済みトランザクションのバイト列が申告内容と一致することも求めます。

## Why — なぜ必要か

現行v0.18では、`expectedRecoveries` の省略値が `[]` です。その場合、被害者側の残高ゼロとNative dust条件だけが成立しても救出完了を示せる余地があります。さらに、ERC-20宛ての外側のトランザクションが正しいトークン契約を指していても、内部の `transfer` 先が安全なウォレットであることは未検証です。

既存テストに出てくる `0x03` は簡略化された模擬raw transactionで、実際に復号可能な署名済みトランザクションの証拠ではありません。テストが成功していても、**署名済みバイト列と意図の一致**は未保証です。

## How — 設計された確認順序

1. 事前に `victim` / `safe` / `chain` / token contract / minimum net received を確定し、欠落・重複・ゼロ額を拒否。
2. signed raw transactionとintentを突合。指定したチェーン・送信者・token contract・nonce・calldata等を検査。
3. 標準ERC-20 `transfer` の送金先と数量をABI復号で検査。 `transferFrom` を扱うかは承認が必要な設計判断。
4. 対象トランザクションの成功、観測元、正しいブロック、関連する結果ログと受取先残高差分を突合。無関係な入金を誤って計上しない。
5. 最終確定は別Issue [#26](https://github.com/Hibiki49aaiii/EraScript/issues/26)のFinality証拠を再利用し、単なる `"finalized"` 文字列では済ませない。
6. 上記がそろわない場合、`RECOVERY_OBSERVED` または `NOT_READY` の適切な弱い結果を出し、`VERIFIED_RECOVERY` にはしない。

## Important Decisions — 重要な設計分岐

**推奨A:** 現行 `verifyCompletedRescue` に十分な証拠を必須化してFail-Closedにする。ただし、既存利用者やテストの移行が必要です。

**代替B:** 新しい厳格APIを作り、旧APIからの `VERIFIED_RECOVERY` 昇格は禁止または明示的に格下げする。単に厳格APIを追加して旧APIが従来の成功を出し続ける案は却下。

**未決定事項:** API移行方法、`transferFrom` の初期サポート、Native-only rescueの着金基準、Issue #26の証拠契約。これらの重要な差異があるため、コード変更前に明示的に承認を取ります。

## Invariants — 守るべき条件

- 失われた残高 ≠ 安全な受取先への回収。
- ERC-20 token contract addressへの送信 ≠ ABI recipientが安全な受取先。
- `intent.data` が正しい ≠ `rawTransaction` の中身が同じ。
- 署名済みトランザクションの解析だけ ≠ 署名主体やチェーンの完全な認証。
- Receipt successと安全ウォレットの増分だけでは、第三者入金を救出分と誤帰属する可能性がある。
- 処理完了 ≠ チェーン最終確定。Issue #26との接続が必要。
- レポートハッシュや署名認証だけでは実際の回収成功を証明できない。

## Failure Modes — 失敗時の扱い

- 不正な受取先・数量・メソッド・データ・トークン契約 → 失敗。
- 対象の残高がゼロで安全な受取先に入金なし → 終端成功は禁止。
- 手数料控除型・Rebase型・特殊token → 推測で補正せず、対象プロトコル用の証拠モデルがない限り高保証の成功を禁止。
- ネットワーク/ブロック/nonce/入金ログの矛盾、失敗Receipt、未確定 → Fail-Closed。
- Native sweep → 安全ウォレットのgas先払いなどを考慮した別設計が必要。
- 独立したRPC/provenanceが不明 → 強い証明と扱わない。

## Change Impact and Current Completion

**このブランチの変更は設計Markdownだけです。** 現行ソース・テスト・秘密鍵・ネットワーク・送金・署名処理には変更なし。実装時は移行に伴う破壊的変更を審査し、別途Unit/Adversarial/CIを実行します。

参照: [Implementation Plan](IMPLEMENTATION_PLAN.md)、[Pre-review](PRE_IMPLEMENTATION_REVIEW.md)、[Decision Gate](DECISIONS.md)、[Test Matrix](TEST_MATRIX.md)、[Trust Model PR #23](https://github.com/Hibiki49aaiii/EraScript/pull/23)。
