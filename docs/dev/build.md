# ビルドシステム

関連資料:
- 開発環境ガイド: `docs/dev/development.md`
- プロジェクト概要: `docs/project-overview.md`

---

## 概要

このプロジェクトは **esbuild** をバンドラーとして使用します。  
TypeScript ソース（`src/extension.ts`）と SCSS スタイル（`src/styles/webview.scss`）を単一の `dist/extension.js` にバンドルします。

```
src/extension.ts          ┐
src/markdown.ts           │
src/webview.ts            ├─ esbuild ──→ dist/extension.js
src/utils.ts              │
src/styles/webview.scss   ┘ (CSS 文字列としてインライン化)
```

---

## ビルドスクリプト一覧

`package.json` の `scripts` に定義されているスクリプトです。

| スクリプト | コマンド | 用途 |
|---|---|---|
| `compile` | `check-types && lint && node esbuild.js` | 開発用ビルド（ソースマップあり） |
| `package` | `check-types && lint && node esbuild.js --production` | 本番用ビルド（minify・ソースマップなし） |
| `vscode:prepublish` | `yarn run package` | VSIX パッケージング前に自動実行 |
| `watch` | `npm-run-all -p watch:*` | 開発用ウォッチビルド（並列） |
| `watch:esbuild` | `node esbuild.js --watch` | esbuild ウォッチモード |
| `watch:tsc` | `tsc --noEmit --watch` | 型チェックウォッチ（出力なし） |
| `compile-tests` | `tsc -p . --outDir out` | テストファイルのコンパイル |
| `watch-tests` | `tsc -p . -w --outDir out` | テストファイルのウォッチコンパイル |
| `check-types` | `tsc --noEmit` | 型チェックのみ（出力なし） |
| `lint` | `eslint src` | ESLint によるコード検査 |
| `test` | `vscode-test` | テスト実行（要: pretest） |
| `test:wsl` | `xvfb-run -a vscode-test` | WSL2 環境でのテスト実行 |

> `compile` と `package` はどちらも `check-types` と `lint` を先行実行するため、型エラーや Lint エラーがあるとビルドが止まります。

---

## esbuild 設定

ビルドスクリプトのエントリは `esbuild.js` です。

### 主な設定項目

| 設定 | 値 | 説明 |
|---|---|---|
| `entryPoints` | `['src/extension.ts']` | エントリポイント |
| `bundle` | `true` | 依存モジュールを一括バンドル |
| `format` | `'cjs'` | CommonJS 形式で出力（Node.js 互換） |
| `platform` | `'node'` | Node.js 向けビルド |
| `outfile` | `'dist/extension.js'` | 出力先 |
| `external` | `['vscode']` | VS Code API は外部依存として除外 |
| `minify` | `production` フラグ時 `true` | 本番ビルド時のみ minify |
| `sourcemap` | `production` フラグ時 `false` | 本番ビルド時はソースマップを除外 |
| `sourcesContent` | `false` | ソースマップにソース内容を含めない |

### SCSS バンドル

`esbuild-sass-plugin` を使用して SCSS を **CSS 文字列** としてバンドルします。

```js
sassPlugin({ type: 'css-text' })
```

TypeScript 側で CSS 文字列を受け取り、Webview の `<style>` タグに注入します。  
これにより、スタイルを外部ファイルとして配布する必要がなくなります。

---

## TypeScript 設定

`tsconfig.json` の主な設定です。

| 設定 | 値 | 説明 |
|---|---|---|
| `module` | `Node16` | Node.js 16+ の ESM/CJS 混在対応 |
| `target` | `ES2022` | ES2022 互換の出力 |
| `lib` | `['ES2022']` | ES2022 標準ライブラリを使用 |
| `sourceMap` | `true` | ソースマップを生成（esbuild 側で制御） |
| `rootDir` | `src` | ソースルートディレクトリ |
| `strict` | `true` | 全 strict オプションを有効化 |

> `tsconfig.json` は型チェック専用です。実際のトランスパイルと出力は esbuild が担います。

---

## ビルド成果物

| パス | 内容 |
|---|---|
| `dist/extension.js` | バンドル済み拡張本体（本番: minify済み） |
| `dist/extension.js.map` | ソースマップ（開発ビルド時のみ） |
| `out/` | テスト用コンパイル済みファイル（`tsc` 出力） |

---

## VSIX パッケージング

VS Code Marketplace への公開・配布用に `.vsix` ファイルを作成します。

### 前提ツールのインストール

```bash
npm install -g @vscode/vsce
```

### パッケージ作成

```bash
vsce package
```

`vscode:prepublish`（= `yarn run package`）が自動実行された後、  
`package.json` の `files` に列挙されたファイルが `.vsix` に含まれます。

### VSIX に含まれるファイル

`package.json` の `files` フィールドで管理されています。

```json
"files": [
  "dist/**",
  "package.json",
  "package.nls.json",
  "package.nls.ja.json",
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "icon.png"
]
```

> `src/` や `docs/` はパッケージに含まれません。

### ローカルインストール（動作確認）

```bash
code --install-extension markdown-concat-viewer-vs-code-x.x.x.vsix
```

---

## CI / リリースワークフロー

GitHub Actions のワークフロー定義は `.github/workflows/` を参照してください。  
リリース時は Git タグを起点に VSIX が自動ビルド・公開される設定になっています。
