# 001: Markdown編集タブ起動機能 仕様書

## 概要
Markdown Concat Viewer の TOC に、表示中の各 Markdown ファイルを編集用タブで開く導線を追加する。さらに、編集した対象ファイルを保存した際に本ビューを自動リロードし、連結表示を最新状態へ同期する。

## 目的
- 閲覧（Webview）と編集（通常エディタ）を往復する操作コストを下げる。
- 連結閲覧中に、該当ファイルの修正へ即座に遷移できるようにする。
- 編集内容を手動再実行なしでビューへ反映し、確認の往復回数を削減する。

## 対象範囲
- 対象: `markdownConcatViewer.openView` で表示した Webview の TOC UI と、Webview から拡張本体へのメッセージ処理。
- 非対象: フォルダ探索仕様（直下のみ）、Markdown レンダリング仕様（`html: false`）、TOC のスクロール仕様。

## ユースケース
1. ユーザーが TOC 見出し行（`toc-item-row`）にマウスオーバーする。
2. 見出し行の右端に `edit` アイコンボタンが表示される。
3. クリックすると、対応する Markdown ファイルが見出し行の位置で VS Code のエディタ領域に新規タブとして開く。
4. 編集して保存すると、開いている Concat View が自動的に再描画される。

## 機能要件
- TOC 見出し行（`toc-item-row`）ごとに、TOC 編集ボタン（`toc-edit-button`）を配置する。
- 編集ボタンはマウスオーバー時のみ表示する。
- キーボード操作時の到達性を確保するため、フォーカス時にも表示できること（`focus-within` を許容）。
- 編集ボタン押下時、該当見出しの行番号を指定して右側の編集タブで開く。
- 既に同ファイルのタブが開いている場合の再利用可否は VS Code 標準挙動に従う（独自制御しない）。
- Concat View が保持している対象 Markdown のいずれかが保存されたら、自動で再レンダリングする。
- 自動リロードは保存イベントを起点とし、未保存の編集中断階ではリロードしない。
- 失敗時は日本語メッセージを表示する。

## UI仕様
- 追加位置: TOC 見出し行（`toc-item-row`）の右端。
- 表示制御:
  - 通常時: 非表示（`opacity: 0` かつ `pointer-events: none`）
  - ホバー/フォーカス時: 表示（`opacity: 1`）
- 表示文言: 視認上はアイコン（鉛筆）または `edit` テキスト。アクセシビリティ名は「このMarkdownを編集で開く」。
- クリック領域: 最低 24px 四方を確保する。

## 実装方針
### 1. TOCデータ拡張
- `buildTocHtml` で TOC 見出し行（`toc-item-row`）に、編集ボタン用 `data-file-path` と `data-line` を埋め込む。
- `renderMarkdownWithAnchors` で見出しトークンの `map` から開始行を取り出し、TOC項目に保持する。
- TOC項目に実ファイルパス（`fsPath`）を保持し、見出し単位で編集導線を解決する。

### 2. Webviewイベント処理
- Webview script で編集ボタンのクリックイベントを購読。
- `acquireVsCodeApi().postMessage({ type: 'openMarkdownForEditAtLine', filePath, line })` を送信。

### 3. 拡張本体側メッセージ処理
- `panel.webview.onDidReceiveMessage` を追加し、`openMarkdownForEditAtLine` を処理。
- 受信したパスを `vscode.Uri.file(...)` に変換し、`showTextDocument` で `viewColumn: Beside` かつ `selection` に行番号を指定して開く。
- 例外時は `vscode.window.showErrorMessage('Markdownファイルを編集タブで開けませんでした。')` を表示。

### 4. セキュリティ/CSP
- 既存方針を維持し、インラインスクリプトは nonce のみ許可。
- 受信メッセージは `type` を厳密比較し、想定外 payload は無視する。

### 5. 自動リロード
- パネル生成時に対象 Markdown の `fsPath` セットを保持する。
- `vscode.workspace.onDidSaveTextDocument` を購読し、保存ドキュメントが対象セットに含まれる場合のみ再描画する。
- 再描画は既存の Webview HTML 生成処理を再実行して差し替える。
- パネル破棄時は購読を必ず解除し、リークを防ぐ。

## 影響範囲
- `src/extension.ts`
  - TOCモデル定義
  - TOC HTML生成
  - Webview script
  - `onDidReceiveMessage` 追加
  - `onDidSaveTextDocument` による再描画処理追加
- テスト
  - 既存ユニットに TOC HTML 生成の期待値を追加（`data-file-path` と `data-line` を検証）
  - 可能ならメッセージ処理の単体テストを追加
  - 保存イベント発生時の再描画条件（対象ファイルのみ）を検証
- ドキュメント
  - 実装後に `README.md` の機能紹介へ追記

## 副作用・リスク
- TOC 行のDOM構造変更により、既存スタイルが崩れる可能性。
- ファイルパスをDOM属性へ載せるため、エスケープ漏れがあると表示崩れのリスク。
- 行番号をDOM属性へ載せるため、型変換ミスがあると意図しない行へ遷移するリスク。
- Webview 内イベントの追加により、将来のTOC拡張と競合する可能性。
- 保存のたびに再描画が走るため、大量ファイル構成では体感遅延が増える可能性。

## 代替案
- 代替案A: TOC 見出しリンク全体を右クリックで「編集で開く」
  - 利点: DOM追加が少ない
  - 欠点: discoverability が低い
- 代替案B: TOC右上に「現在ファイルを編集」固定ボタン
  - 利点: UIが単純
  - 欠点: ファイル単位で直接開けず要件に不一致
- 代替案C: 自動リロードせず、手動更新ボタンのみ提供
  - 利点: 実装が単純で再描画負荷を制御しやすい
  - 欠点: 保存後の同期が遅れ、要件に不一致

## テスト/検証
- `yarn run check-types`
- `yarn run lint`
- `yarn run test`
- 手動確認
  - TOC 見出し行ホバーで編集ボタンが出る
  - ボタンクリックで対象見出しの行位置で新規タブが開く
  - 対象Markdown保存時に Concat View が自動リロードされる
  - 対象外ファイル保存ではリロードされない
  - TOCスクロール/見出しジャンプ挙動に回帰がない
  - エラー時メッセージが日本語

## 未確定事項
- ボタン表現を「鉛筆アイコン」と「editテキスト」のどちらを正式採用するか。
- `showTextDocument` のオプション（`preview: false` / 右ペイン固定）を将来設定化するか。
- 自動リロード時にスクロール位置を維持するか（初期表示位置へ戻すか）をどちらで統一するか。
