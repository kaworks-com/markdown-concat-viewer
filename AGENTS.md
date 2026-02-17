# AGENTS.md

このファイルは、`markdown-concat-viewer-vs-code` リポジトリで作業するエージェント向けの運用ルールです。

## 基本方針

- すべての回答は日本語で行う。
- ユーザーに表示するエラーメッセージは日本語で作成する。
- 既存の実装方針（Explorer 選択起点、Markdown 連結表示、TOC、折りたたみ）を尊重し、不要な仕様変更を避ける。

## 実装ガイド

- 対象は VS Code 拡張（TypeScript）で、エントリは `src/extension.ts`。
- Markdown レンダリングでは `markdown-it` の生 HTML 無効化（`html: false`）方針を維持する。
- フォルダ探索は現仕様どおり「直下のみ（再帰なし）」を前提に扱う。
- 変更時はセキュリティ要件（CSP、nonce ベースのスクリプト許可）を壊さない。

## 変更前後の確認

実装後は、必要に応じて次を実行して整合性を確認する。

```bash
yarn run check-types
yarn run lint
yarn run test:wsl
```

## ドキュメント整合

- 仕様を変更した場合は `README.md` と `docs/specs/` 配下も更新する。
- `README.md` は 拡張機能Marketplace の紹介ページとなることを意識した内容にすること（機能の強化を積極的にアピールし、開発者向け情報は記載しなくてよい ）
- 既知の制約や未対応事項を変更した場合は、差分を明示して記録する。

## 用語集

- 画面パーツ名称の正式な用語集は `docs/specs/glossary-ui-parts.md` を参照する。
