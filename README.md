# Markdown Concat Viewer

`markdown-concat-viewer-vs-code` は、ファイルエクスプローラーで選択した Markdown ファイル群を 1 つの Webview に連結表示する VS Code 拡張です。  
ファイル単位の折りたたみ表示と右ペインの TOC（目次）で、大きなドキュメントセットをまとめて閲覧できます。

### 開発の背景：ワーキングメモリの保護
複数のファイルを行き来する際、タブの切り替えに伴う視覚刺激は脳にとって「場面転換」として機能し、保持していた文脈（ワーキングメモリ）をリセット（フラッシュ）させてしまいます。

本拡張機能は、バラバラのファイルを一つの連続した「ストリーム」として再構築することで、視覚的な切り替えを軽減し、位置による情報の認識を補助します。

## 主な機能
* **シームレスな連結表示**: 選択した複数の Markdown ファイル（`.md` / `.markdown`）を一つのキャンバスに統合して、プレビューします。
* **構造の把握**: ファイル単位の折りたたみ機能と、右ペインの動的なTOC（目次）により、全体像を常に把握できます。
* **コンテキストの維持**: タブ切り替えによる認知負荷を排除し、ドキュメントの「流れ」に集中できます。
- **編集への即時遷移**: TOC の各見出し行をホバーすると `edit` ボタンが表示され、対象見出しの行位置で Markdown を編集タブとして直接開けます。
- **保存時の自動反映**: 表示中の対象 Markdown を保存すると、Concat View が自動リロードされて最新内容を反映します。
- フォルダ選択時は「直下」の Markdown ファイルを自動収集（再帰なし）
- ファイル見出し（ファイル名・相対パス）をスクロール時に上部固定
- 見出し（`h1`〜`h6`）を抽出して TOC を生成
- TOC クリックで対象見出しへスムーズスクロール（必要時は該当ファイルを自動展開）
- Markdown 内の生 HTML を無効化（`markdown-it` の `html: false`）

<img src="https://kaworks.com/products/markdown-concat-viewer/sample.png">

## 使い方

1. ファイルエクスプローラーで Markdown ファイルまたはフォルダを選択します。
2. 右クリックして `Markdownを結合して表示` を実行します。
3. 開いたビューで左側に本文、右側に TOC が表示されます。

補足:

- ファイルとフォルダを同時選択した場合は両方から対象を解決します。
- 表示順は選択順ではなく、パスの昇順です。
- 対象が見つからない場合は警告メッセージを表示します。

## コマンド

- `markdownConcatViewer.openView`: Markdown Concat Viewer を開く

## 要件

- VS Code `^1.107.0`

## 拡張設定

現在、ユーザー向け設定（`contributes.configuration`）はありません。

## 既知の制約

- フォルダ選択時の探索は直下のみで、サブフォルダは探索しません。
- エクスプローラーの選択コンテキストに依存するため、選択なし実行では対象を解決できません。
- テストは最小構成で、機能全体の網羅テストは未整備です。

## セキュリティ方針

- Webview に CSP（`default-src 'none'`）を設定
- スクリプトは nonce 付きのみ実行許可
- Markdown の生 HTML 埋め込みを無効化

## サードパーティライセンス

サードパーティライブラリのライセンス情報は `THIRD_PARTY_NOTICES.md` を参照してください。

## リリース

[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Kaworks.markdown-concat-viewer-vs-code)

[OpenVSX](https://open-vsx.org/extension/kaworks/markdown-concat-viewer-vs-code)
