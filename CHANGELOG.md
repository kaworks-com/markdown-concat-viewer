# Change Log

All notable changes to the "markdown-concat-viewer-vs-code" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [0.4.0] - 2026-02-17

### Added
- Webview タブのコンテキストメニューから表示中タブ名を変更できる `Rename Tab` コマンドを追加
- TOC の見出し行から、該当 Markdown を見出し行位置で編集タブに開く `edit` 導線を追加
- 対象 Markdown 保存時に Concat View を自動リロードして表示を最新化する仕組みを追加

### Changed
- 複数の Concat View パネル状態を管理し、アクティブ状態に応じたコマンド表示制御を追加
- README を Marketplace 向けの内容に更新し、仕様ドキュメント（`docs/specs/`）を拡充
- コマンド文言のローカライズを更新（`package.nls.json` / `package.nls.ja.json`）

### Fixed
- リリースワークフローの `VSIX_NAME` 生成処理を修正

## [0.3.0] - 2026-02-13

### Changed
- Webview パネル名を「Combined Markdown View」から「Markdown Concat View」へ統一
- Webview の HTML タイトルを「Combined Markdown View」から「Concat Markdown View」へ変更
- 対応 VS Code バージョン要件を `^1.107.0` に調整（antigravity動作バージョンに対応）
- README にサンプル画像を追加

## [0.0.1] - 2026-02-13
### Features
- 複数の Markdown ファイルを連結してプレビューする機能を追加
- エクスプローラーのコンテキストメニューから「Markdown Concat View」を開く機能
- ディレクトリ選択時に直下の Markdown ファイルを一括表示する機能
- サイドバーへの目次 (TOC) 表示とページ内ナビゲーション機能
- 各ファイルごとの折りたたみ表示 (Details/Summary)
