# 004 TOC 手動更新ボタン

## 概要

TOC（目次）ペインの最下部に、Markdown を手動で再読み込みするボタンを設置する機能。  
ファイル保存以外のタイミングでも、ユーザーの意図でプレビューを最新化できる。

---

## UI 仕様

### ボタン配置

| 項目 | 内容 |
|------|------|
| 配置場所 | TOC ペイン最下部（`position: fixed`、画面下端固定） |
| 通常モード表示 | `↺ 再読み込み` （アイコン＋テキスト、全幅ボタン） |
| 最小化モード表示 | `↺` アイコンのみ |
| スタイル | TOC トグルボタンと同系統のセカンダリボタン配色 |

### 固定配置の詳細

- `position: fixed; bottom: 0; right: 0` で常に画面下端 / TOC 右端に配置
- 幅は通常モード: `var(--toc-width)`、最小化モード: `var(--toc-minimized-width)` に追従
- `background: var(--toc-bg)` によりスクロールコンテンツと重なっても背景が透けない
- `z-index: 20`（TOC の `z-index: 10` より前面）

---

## 動作仕様

1. ユーザーがボタンをクリックする
2. Webview → Extension に `{ type: "refreshMarkdown" }` メッセージを postMessage
3. Extension 側が受信し `renderView()` を呼び出す
4. 対象 Markdown ファイルを再読み込みし、Webview HTML を再生成・更新する

### 保存トリガーとの関係

ファイル保存時の自動リロード（`onDidSaveTextDocument`）と独立して動作する。  
手動ボタンは保存の有無に関わらずいつでも再読み込みを実行できる。

---

## 実装ファイル

| ファイル | 変更内容 |
|---------|---------|
| `src/webview.ts` | `buildTocHtml()` の末尾にボタン HTML を追加 / スクリプト部にクリックイベントを追加 |
| `src/extension.ts` | `onDidReceiveMessage` 内に `refreshMarkdown` ハンドラーを追加 |
| `src/styles/webview.scss` | `.toc-refresh-row` / `.toc-refresh-btn` スタイルを追加 |
