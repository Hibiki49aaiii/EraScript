# Issue #1 Human Understanding

## What

EraScriptの今後の開発を、チャット依存ではなくGitHub Issueを中心に追跡できる開発方式へ変更する。

## Why

v0.6まではコード・テスト・設計docsは残っている一方、Issueが0件だったため「なぜ変更したか」「開始時点のSHA」「何を完成条件にしたか」を1つの作業単位で追跡しにくかった。

## How

今後は以下を標準フローにする。

```text
Repository確認
 -> Issue作成
 -> Base SHA固定
 -> 設計/Plan
 -> 実装前レビュー
 -> 実装
 -> tests/typecheck/CI
 -> 実装後レビュー
 -> Issue更新
```

恒久ルールはroot `AGENTS.md`、詳細仕様はIssue、中規模以上の設計は `docs/ai/issues/<N>/` に置く。

## Important Decisions

- Issueを作業状態の中心にする。
- `AGENTS.md`を長大な設計書にはしない。
- Planは中規模以上のみ。
- コード/tests/CIを機械的なSource of Truthとして維持する。
- lockfile/Lint導入は今回行わない。

## Invariants

絶対に壊してはいけない条件:

1. 実装前に現在のリポジトリを読む。
2. 実装前に専用Issueを作る。
3. Base Commit SHAを記録する。
4. テストしていないものを「PASS」と書かない。
5. SecretをIssue/docs/sourceへ残さない。
6. 高リスク不可逆操作は確認なしで実行しない。
7. Issue外へ無制限にScopeを広げない。
8. 仕様ドリフトが判明したらIssue/Planを先に更新する。

## Failure Modes

- AGENTSが長すぎて読まれない
- IssueとPlanが二重管理になり矛盾する
- チェックボックスだけ更新して実CIを見ない
- 小変更でも巨大Planを作り速度を落とす
- SDK仕様を記憶だけで実装する

## Change Impact

この規約を変更すると、今後の全EraScript Issueで:
- 調査手順
- 設計記録
- 自律実行範囲
- Verification報告
- 完了判定

に影響する。

そのため、規約変更は通常の機能変更より慎重にIssueで理由を残す。
