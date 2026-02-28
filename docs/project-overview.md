# プロジェクト概要（markdown-concat-viewer-vs-code）

関連資料:
- 画面パーツ用語集: `docs/reference/glossary-ui-parts.md`
- 設定仕様書: `docs/reference/configuration.md`
- 開発環境ガイド: `docs/dev/development.md`
- ビルドシステム: `docs/dev/build.md`

## 目的
VS Code拡張として、ファイルエクスプローラーで選択したMarkdownファイル、または選択ディレクトリ直下のMarkdownファイルを1つのビューで連結表示し、ファイル単位の折りたたみと目次（TOC）で素早く閲覧できるようにする。

## 現在のスコープ（srcの実装から確認できる範囲）
- コマンド `markdownConcatViewer.openView` により、ファイルエクスプローラーで選択されたファイル/ディレクトリをもとにWebviewを表示する。
- 対象はコマンド引数の `selectedUris`（複数選択）または `uri`（単一選択）から決定する。
- 選択項目がMarkdownファイル（`*.md` / `*.markdown`）の場合は、そのファイルを対象にする。
- 選択項目がディレクトリの場合は、ディレクトリ直下のMarkdownファイル（`*.md` / `*.markdown`）を対象にする（再帰なし）。
- ファイルとディレクトリを同時に選択した場合は、両者から解決されたMarkdownファイルを対象にし、重複パスは1件にまとめる。
- 解決後のMarkdownファイルが0件の場合は警告メッセージを表示して終了する。
- 対象ファイルはパス順でソートして表示する（Explorerの選択順に依存しない）。
- 各ファイルはファイルセクション（`details.file-section`）として分割され、ファイルタイトルとファイルパスを表示する。
- スクロール中は、現在表示中（画面上端にかかっている）ファイルヘッダー（`summary.file-summary`）を上端に固定表示する。
- 見出し（h1〜h6）にアンカーIDを付与し、TOCから該当見出しへスクロールできる。
- TOC操作時、対象見出しを含むファイルセクションが折りたたまれている場合は自動で展開し、ファイルヘッダー（`summary.file-summary`）高さ分のオフセットを考慮して遷移する。
- TOC 見出し行（`toc-item-row`）の編集ボタンから、対象見出しの行位置でMarkdownを編集タブに開ける。
- 表示対象Markdownの保存時、Concat View を自動再描画して内容を同期する。
- Webview側でTOC表示モード（`expanded` / `minimized` / `overlay`）を動的制御する。
- Markdownのレンダリングは `markdown-it` を利用し、HTML生埋め込みは無効化（`html: false`）。

## 主な処理フロー
1. ファイルエクスプローラーから渡された `selectedUris` / `uri` を `normalizeUris` で正規化し、重複排除する。
2. 各URIを `stat` で判定し、ファイルはMarkdown拡張子でフィルタ、ディレクトリは `readDirectory` で直下のMarkdownファイルのみ抽出する（再帰なし）。
3. 抽出結果を重複排除し、0件なら警告を表示して処理を終了する。
4. 対象ファイルをパス順でソートする。
5. Webviewを生成する。
6. 各ファイルを読み込み、`renderMarkdownWithAnchors` でHTMLとTOC情報を生成する。
7. TOCと本文を合成してWebviewへ描画する。

## 画面構成（Webview）
- 本文ペイン（`content`）: 連結された Markdown 内容（`height: 100vh; overflow: auto;`）
- TOC ペイン（`toc`）: 目次と編集導線
- 各ファイルはファイルセクション（`details.file-section`）単位で折りたたみ可能

## セキュリティ方針（実装に基づく）
- CSPを設定し、`default-src 'none'`。
- スクリプトはnonceのみ許可。
- Markdown内の生HTMLは無効化。

## 既知の制約・未整備ポイント（srcから推測）
- ディレクトリ展開は直下のみで、サブディレクトリ配下のMarkdownは対象外。
- `markdownConcatViewer.openView` はファイルエクスプローラー経由で渡されたURIに依存しているため、選択コンテキストなしでの起動時は対象ファイルが解決できない。
- テストはサンプルのみで、実機能のテストは未実装。
- 表示スタイルは最小限で、VS Codeテーマとの同期やハイライト拡張は未対応。

## 期待される利用シナリオ
- ファイルエクスプローラーで複数の仕様書/設計書Markdownを選択し、まとめて閲覧したい場合。
- ファイルエクスプローラーでディレクトリを選択し、直下のMarkdown群をまとめて閲覧したい場合。
- 同一テーマの分割MarkdownをTOCから素早く参照したい場合。
