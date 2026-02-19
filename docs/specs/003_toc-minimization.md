# TOC最小化機能

## 概要

本文の可読性を維持するため、TOC（目次）を `expanded` / `minimized` / `overlay` の3モードで切り替える。
切り替えは「自動判定」と「ユーザー操作（トグル）」を併用し、ユーザー意図を優先しつつ、本文幅が不足する場合はオーバーレイ表示で保護する。

## 仕様

### 1. 表示モード

- `expanded`: 通常表示（本文 + TOC の2カラム）。
- `minimized`: TOCを狭幅で表示し、本文領域を優先。
- `overlay`: TOCを本文上に重ねて表示し、本文横幅を確保。

### 2. 自動判定

`updateTocMode()` で以下を判定する。

- 最小化判定: `tocWidth / windowWidth > 0.30`
- オーバーレイ判定: `remainingWidth = windowWidth - tocWidth` が `600px` 未満

優先順位は次のとおり。

- `userOverride === 'minimized'` のときは常に `minimized`。
- `userOverride === 'expanded'` のときは `overlay` 条件のみ強制適用（通常は `expanded`）。
- `userOverride === null` のときは自動判定。
  - まず `30%` 超過なら `minimized`
  - それ以外で `remainingWidth < 600` なら `overlay`
  - どちらでもなければ `expanded`

### 3. 手動切り替え（トグル）

- TOC上部にトグルボタンを配置する。
- 現在モードが `expanded` または `overlay` の場合は `minimized` へ切り替える。
- 現在モードが `minimized` の場合は `expanded` へ切り替える。
- 状態は `acquireVsCodeApi().setState()` で `userOverride` として保持する（Webview再読込時に復元）。

補足:
- ボタン表示はモードに応じて切り替える。
  - `expanded` / `overlay`: `▶|`
  - `minimized`: `|◀`

### 4. オーバーレイ表示（本文優先）

- `overlay` では `.layout` を `display: block` にし、TOCを `position: fixed` で右側に重ねる。
- TOCには影（`box-shadow`）を付与し、前面（`z-index: 100`）で表示する。
- 本文領域は `width: 100%` を使い、横幅を確保する。

### 5. 最小化時の表示

- TOCの最小幅は `--toc-minimized-width: 60px`。
- 見出しテキストは非表示（`font-size: 0`）。
- H1〜H3はインジケータ表示、H4〜H6は非表示。
- ファイル見出し（`group-title`）はテキストを消し、区切り線として表示。
- 編集ボタン（`toc-edit-button`）は非表示。
- リンククリックによる見出しジャンプは有効。

## 技術的詳細

- レイアウト状態は `#layout` の `data-toc-mode` 属性（`expanded` / `minimized` / `overlay`）で制御。
- TOC幅は拡張側で `tocWidth = tocFontSize * tocMinWidthChars + 24` として算出し、CSS変数 `--toc-width` に注入。
- 本文スクロールコンテナ（`#content`）は `height: 100vh; overflow: auto;` を持ち、TOCリンク移動時はこの要素をスクロールする。
- 判定処理はWebview内スクリプト `updateTocMode()` で実行。
- 再判定トリガー:
  - 初期描画時
  - トグルクリック時
  - `window.resize` 発生時
