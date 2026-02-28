# 開発環境ガイド

関連資料:
- ビルドシステム詳細: `docs/dev/build.md`
- プロジェクト概要: `docs/project-overview.md`

---

## 前提条件

| ツール | バージョン要件 | 備考 |
|---|---|---|
| Node.js | 22.x 以上 | `@types/node` が `22.x` を参照 |
| Yarn | 1.x (Classic) | `.yarnrc` に `yarn-path` 設定あり |
| VS Code | 1.107.0 以上 | `engines.vscode` に準拠 |
| Git | 任意の最新版 | |

> WSL2 環境でも動作確認済み（テスト実行には `xvfb-run` が必要）。

---

## セットアップ手順

### 1. リポジトリをクローン

```bash
git clone https://github.com/kaworks-com/markdown-concat-viewer.git
cd markdown-concat-viewer-vs-code
```

### 2. 依存パッケージをインストール

```bash
yarn install
```

インストールされる主な依存パッケージ:

| パッケージ | 用途 |
|---|---|
| `typescript` | TypeScript コンパイラ |
| `esbuild` | バンドラー |
| `esbuild-sass-plugin` | SCSS → CSS バンドル |
| `sass` | SCSS コンパイラ |
| `markdown-it` | Markdown レンダリング |
| `eslint` | Lint |
| `@vscode/test-cli` | VS Code 拡張テストランナー |
| `@vscode/test-electron` | テスト用 VS Code Electron |

---

## 開発ワークフロー

### ウォッチビルド（推奨）

TypeScript の型チェックと esbuild を並列で実行します。

```bash
yarn run watch
```

内部で以下が並列起動します:

- `watch:esbuild` — esbuild のウォッチモード（`src/extension.ts` → `dist/extension.js`）
- `watch:tsc` — TypeScript の型チェックウォッチ（エラー検出のみ、出力なし）

### VS Code 拡張のデバッグ起動

1. VS Code でこのリポジトリを開く
2. `yarn run watch` を実行してウォッチビルドを起動
3. `F5` キー（または **実行 > デバッグの開始**）を押す
4. 「Extension Development Host」ウィンドウが起動する

`.vscode/launch.json` の設定で拡張がロードされます。

---

## 型チェック・Lint

### 型チェック

```bash
yarn run check-types
```

`tsc --noEmit` を実行します。`strict: true` が有効なため、型の不整合はすべてエラーになります。

### Lint

```bash
yarn run lint
```

`eslint src` を実行します。設定は `eslint.config.mjs` を参照してください。

---

## テスト

### テスト実行（通常環境）

```bash
yarn run test
```

内部で以下を順番に実行します:

1. `compile-tests` — テストファイルを `out/` にコンパイル
2. `compile` — 拡張本体をビルド
3. `lint` — Lint チェック
4. `vscode-test` — テストランナーで実行（`out/test/**/*.test.js`）

### テスト実行（WSL2・ヘッドレス環境）

```bash
yarn run test:wsl
```

`xvfb-run -a vscode-test` を実行します。WSL2 など仮想ディスプレイが必要な環境で使用します。

---

## ディレクトリ構成

```
markdown-concat-viewer-vs-code/
├── src/                    # TypeScript ソース
│   ├── extension.ts        # エントリポイント（コマンド登録・Webview生成）
│   ├── markdown.ts         # Markdown パース・アンカー付与
│   ├── webview.ts          # Webview HTML 生成・メッセージハンドリング
│   ├── utils.ts            # URI 正規化・ファイル解決ユーティリティ
│   ├── types.ts            # 型定義
│   ├── exports-test.ts     # テスト用エクスポート
│   ├── styles/
│   │   └── webview.scss    # Webview 用スタイル（SCSS）
│   └── test/               # テストファイル
├── dist/                   # ビルド成果物（esbuild 出力）
│   └── extension.js        # バンドル済み拡張本体
├── out/                    # テストコンパイル出力（tsc）
├── docs/                   # ドキュメント
│   ├── project-overview.md
│   ├── dev/                # 開発者向けドキュメント
│   │   ├── development.md  # 開発環境ガイド（このファイル）
│   │   └── build.md        # ビルドシステム詳細
│   ├── specs/              # 機能仕様書
│   └── reference/          # リファレンス（設定・用語集）
├── package.json
├── tsconfig.json
├── esbuild.js              # ビルドスクリプト
└── eslint.config.mjs       # ESLint 設定
```

---

## コーディング規約

- コメント・docstring はすべて **日本語** で記述する
- 変数名は **英語** で命名する（ローマ字命名禁止）
- セキュリティ要件（CSP・nonce ベーススクリプト許可）を破らない
- Markdown レンダリングの生 HTML 無効化（`html: false`）方針を維持する
- ユーザー設定は `markdownConcatViewer.*` プレフィックスで管理する

詳細は `AGENTS.md` を参照してください。
