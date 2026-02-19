# 設定仕様書

`markdownConcatViewer` 拡張機能で利用可能な設定項目（`contributes.configuration`）と、その挙動について記述する。

## 設定一覧

| 設定ID | 型 | デフォルト値 | 説明 |
| :--- | :--- | :--- | :--- |
| `markdownConcatViewer.preview.fontSize` | number | 100 | 本文プレビューの基本フォントサイズ。<br>VS Codeの **エディタフォントサイズ (`editor.fontSize`) に対するパーセンテージ** で指定する。<br>例: `100` = エディタと同じサイズ、`120` = エディタの1.2倍 |
| `markdownConcatViewer.preview.lineHeight` | number | 175 | 本文プレビューの行間。<br>パーセンテージで指定する。<br>例: `175` = 行間 1.75 |
| `markdownConcatViewer.toc.fontSize` | number | 12 | TOC（目次）ペインの基本フォントサイズ (px)。<br>固定ピクセル値で指定する。 |
| `markdownConcatViewer.toc.minWidthChars` | number | 20 | TOCペインの最小幅。<br>「TOCのフォントサイズ」で何文字分入るかを基準に幅を計算する。<br>計算式: `(toc.fontSize * toc.minWidthChars) + 24px` |

## 挙動詳細

### フォントサイズと行間の適用

- **Webview起動時**: 設定値を読み込み、CSS変数としてWebview内の `:root` に注入する。
  - `--preview-font-size`: `editor.fontSize` * (`preview.fontSize` / 100) px
  - `--preview-line-height`: `preview.lineHeight` / 100
  - `--toc-font-size`: `toc.fontSize` px
- **設定変更時**: `vscode.workspace.onDidChangeConfiguration` イベントを監視し、設定値が変更された場合はWebviewを即座に再描画（リロード）して新しいスタイルを適用する。

### 本文ペインの見出しスタイル

本文ペインの各見出し (`h1`〜`h6`) は、視認性を確保するため以下のルールでスタイルが適用される。

- `margin-top`: `1.2em`
- `line-height`: `1.3` (固定)
  - `preview.lineHeight` の設定値にかかわらず、見出しの行間はタイトに保たれる。

### TOCペインのレイアウト

- **幅の計算**: `toc.fontSize` と `toc.minWidthChars` に基づいて固定幅（ピクセル）が計算され、Webviewのグリッドレイアウト (`grid-template-columns`) に適用される。
- **テキストの折り返し**: TOC内のリンクテキストが計算された幅を超える場合、省略 (`...`) せずに折り返して表示する (`word-break: break-all`)。
