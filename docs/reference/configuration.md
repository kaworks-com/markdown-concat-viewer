# 設定仕様書

`markdownConcatViewer` 拡張機能で利用可能な設定項目（`contributes.configuration`）と、その挙動を記述する。

## 設定一覧

| 設定ID | 型 | デフォルト値 | 説明 |
| :--- | :--- | :--- | :--- |
| `markdownConcatViewer.preview.fontSize` | number | 100 | 本文プレビューの基本フォントサイズ。<br>VS Codeの **エディタフォントサイズ (`editor.fontSize`) に対するパーセンテージ** で指定する。<br>例: `100` = エディタと同じサイズ、`120` = エディタの1.2倍 |
| `markdownConcatViewer.preview.lineHeight` | number | 175 | 本文プレビューの行間。<br>パーセンテージで指定する。<br>例: `175` = 行間 1.75 |
| `markdownConcatViewer.preview.maxWidth` | number | 40 | 本文の最大表示幅（`ch` 単位換算）。 |
| `markdownConcatViewer.toc.fontSize` | number | 12 | TOC（目次）ペインの基本フォントサイズ（px）。 |
| `markdownConcatViewer.toc.minWidthChars` | number | 20 | TOCペインの基準幅（文字数換算）。<br>計算式: `(toc.fontSize * toc.minWidthChars) + 24px` |

## 挙動詳細

### フォントサイズと行間の適用

- Webview起動時に設定値を読み込み、CSS変数として `:root` に注入する。
  - `--preview-font-size`: `editor.fontSize * (preview.fontSize / 100)` px
  - `--preview-line-height`: `preview.lineHeight / 100`
  - `--content-max-width`: `preview.maxWidth` ch
  - `--toc-font-size`: `toc.fontSize` px
  - `--toc-width`: `(toc.fontSize * toc.minWidthChars) + 24` px
- 設定変更時は `vscode.workspace.onDidChangeConfiguration` で `markdownConcatViewer` 配下の変更を監視し、Webviewを再描画して即時反映する。

### TOCペインのレイアウト制御

- TOCは `expanded` / `minimized` / `overlay` の3モードで表示される。
- 自動判定のしきい値:
  - TOC最小化: `tocWidth / windowWidth > 0.30`
  - オーバーレイ: `windowWidth - tocWidth < 600`
- 最小化時のTOC幅は `--toc-minimized-width: 60px`。

### 本文ペインの見出しスタイル

本文ペインの見出し（`h1`〜`h6`）は、視認性確保のため以下で固定される。

- `margin-top`: `1.2em`
- `line-height`: `1.3`
