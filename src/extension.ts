// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import markdownit from 'markdown-it';

type TocItem = {
  fileIndex: number;
  fileName: string;
  fileUriKey: string;
  level: number; // 1..6
  text: string;
  anchorId: string;
  sourceLine: number;
};

type TocFile = {
  fileIndex: number;
  fileName: string;
  fileUriKey: string;
};

export function activate(context: vscode.ExtensionContext) {
  const panels = new Set<vscode.WebviewPanel>();

  const updateContextKey = () => {
    const activePanel = vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputWebview
      ? Array.from(panels).find(p => p.viewType === (vscode.window.tabGroups.activeTabGroup.activeTab?.input as vscode.TabInputWebview).viewType)
      : undefined;

    // TabInputWebview 経由だと viewType が取れる保証がないため、単純に active なパネルが自分たちの管理下にあるかで判定する
    // ただし、vscode.window.activeWebviewPanel は focus があるときしか取れない可能性がある
    // ここではシンプルに「現在フォーカス中のWebviewPanelが管理リストにあるか」を見る
    const isActive = Array.from(panels).some(p => p.active);
    vscode.commands.executeCommand('setContext', 'markdownConcatViewerActive', isActive);
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateContextKey),
    vscode.window.onDidChangeWindowState(updateContextKey),
    vscode.commands.registerCommand(
      "markdownConcatViewer.renameTab",
      async () => {
        const panel = Array.from(panels).find(p => p.active);
        if (!panel) {
          return;
        }
        const newTitle = await vscode.window.showInputBox({
          prompt: "新しいタブ名を入力してください",
          value: panel.title
        });
        if (newTitle) {
          panel.title = newTitle;
        }
      }
    ),
    vscode.commands.registerCommand(

      "markdownConcatViewer.openView",
      async (uri?: vscode.Uri, selectedUris?: vscode.Uri[]) => {
        const uris = normalizeUris(uri, selectedUris);
        if (uris.length === 0) {
          vscode.window.showWarningMessage("ファイルエクスプローラーでMarkdownファイルを選択して実行してください。");
          return;
        }

        const mdUris = await resolveMarkdownUris(uris);

        if (mdUris.length === 0) {
          vscode.window.showWarningMessage("選択したMarkdownファイル、または選択ディレクトリ直下のMarkdownファイル（.md / .markdown）が見つかりません。");
          return;
        }

        // 表示順：パス順（Explorerの選択順は保証されない前提）
        mdUris.sort((a, b) => a.fsPath.localeCompare(b.fsPath));

        const panel = vscode.window.createWebviewPanel(
          "markdownConcatViewerView",
          "Markdown Concat View",
          vscode.ViewColumn.Active,
          {
            enableScripts: true,
            retainContextWhenHidden: true
          }
        );
        panels.add(panel);
        updateContextKey();

        panel.onDidDispose(() => {
          panels.delete(panel);
          updateContextKey();
        });

        panel.onDidChangeViewState(() => {
          if (panel.visible) {
            updateContextKey();
          }
        });

        const markdownPathSet = new Set(mdUris.map((u) => toPathKey(u.fsPath)));
        const markdownUriMap = new Map(mdUris.map((u) => [toUriKey(u), u]));
        const renderView = async () => {
          panel.webview.html = await buildPanelHtml(panel.webview, mdUris);
        };

        panel.webview.onDidReceiveMessage(async (message) => {
          if (!message || message.type !== "openMarkdownForEditAtLine" || typeof message.fileUriKey !== "string") {
            return;
          }
          const targetUri = markdownUriMap.get(message.fileUriKey);
          if (!targetUri) {
            return;
          }
          const line = typeof message.line === "number" && Number.isInteger(message.line) && message.line > 0
            ? message.line
            : 1;
          try {
            const doc = await vscode.workspace.openTextDocument(targetUri);
            const targetLine = Math.min(Math.max(line - 1, 0), Math.max(doc.lineCount - 1, 0));
            const selection = new vscode.Range(targetLine, 0, targetLine, 0);
            await vscode.window.showTextDocument(doc, {
              // 同じグループ内で開く（ユーザーが分割していればそちらで、していなければ同一タブで上書き）
              // viewColumn: vscode.ViewColumn.Beside,
              preview: false,
              selection
            });
          } catch {
            vscode.window.showErrorMessage("Markdownファイルを編集タブで開けませんでした。");
          }
        });

        const saveListener = vscode.workspace.onDidSaveTextDocument(async (doc) => {
          if (!markdownPathSet.has(toPathKey(doc.uri.fsPath))) {
            return;
          }
          await renderView();
        });

        const configListener = vscode.workspace.onDidChangeConfiguration(async (e) => {
          if (e.affectsConfiguration("markdownConcatViewer")) {
            await renderView();
          }
        });

        panel.onDidDispose(() => {
          saveListener.dispose();
          configListener.dispose();
        });

        await renderView();
      }
    )
  );
}

export function deactivate() { }

function normalizeUris(uri?: vscode.Uri, selectedUris?: vscode.Uri[]): vscode.Uri[] {
  const list: vscode.Uri[] = [];
  if (Array.isArray(selectedUris) && selectedUris.length > 0) {
    list.push(...selectedUris);
  } else if (uri) {
    list.push(uri);
  }
  return dedupeUris(list);
}

function dedupeUris(uris: vscode.Uri[]): vscode.Uri[] {
  const seen = new Set<string>();
  return uris.filter((u) => {
    const key = u.toString();
    if (seen.has(key)) { return false; }
    seen.add(key);
    return true;
  });
}

async function resolveMarkdownUris(uris: vscode.Uri[]): Promise<vscode.Uri[]> {
  const collected: vscode.Uri[] = [];

  for (const u of uris) {
    const stat = await safeStat(u);
    if (!stat) {
      continue;
    }

    if ((stat.type & vscode.FileType.Directory) !== 0) {
      collected.push(...await listDirectMarkdownFiles(u));
      continue;
    }

    if ((stat.type & vscode.FileType.File) !== 0 && isMarkdownFile(u)) {
      collected.push(u);
    }
  }

  return dedupeUris(collected);
}

async function safeStat(uri: vscode.Uri): Promise<vscode.FileStat | undefined> {
  try {
    return await vscode.workspace.fs.stat(uri);
  } catch {
    return undefined;
  }
}

async function listDirectMarkdownFiles(dir: vscode.Uri): Promise<vscode.Uri[]> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(dir);
    return entries
      .filter(([name, fileType]) =>
        (fileType & vscode.FileType.File) !== 0 && isMarkdownName(name))
      .map(([name]) => vscode.Uri.joinPath(dir, name));
  } catch {
    return [];
  }
}

function isMarkdownFile(u: vscode.Uri): boolean {
  return isMarkdownName(u.fsPath);
}

function isMarkdownName(targetPath: string): boolean {
  const ext = path.extname(targetPath).toLowerCase();
  return ext === ".md" || ext === ".markdown";
}

function toProjectRelativePath(uri: vscode.Uri): string {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) {
    return uri.fsPath;
  }

  const relativePath = path.relative(folder.uri.fsPath, uri.fsPath);
  if (!relativePath || relativePath.startsWith("..")) {
    return uri.fsPath;
  }

  // OS依存の区切り文字は表示上 '/' に統一する
  return relativePath.split(path.sep).join("/");
}

function createMarkdownIt(): markdownit {
  // html:false で生HTMLを無効化（安全側）
  const md = new markdownit({
    html: false,
    linkify: true,
    breaks: false
  });
  return md;
}

function renderMarkdownWithAnchors(
  md: markdownit,
  markdownText: string,
  file: { fileIndex: number; fileName: string; fileUriKey: string }
): { html: string; tocItemsForFile: TocItem[] } {
  const tocItems: TocItem[] = [];
  let headingSeq = 0;

  // 見出しレンダラーを差し替えてアンカー注入 + TOC収集
  const previousHeadingOpen = md.renderer.rules.heading_open;
  const fallbackHeadingOpen = (tokens: unknown[], idx: number, options: unknown, _env: unknown, self: markdownit.Renderer) =>
    self.renderToken(tokens as never[], idx, options as never);
  const originalHeadingOpen = previousHeadingOpen ?? fallbackHeadingOpen;

  md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const level = parseInt(token.tag.replace("h", ""), 10);

    // 次のtokenが見出しテキスト
    const inline = tokens[idx + 1];
    const text = inline?.type === "inline" ? inline.content : "";

    const anchorId = `cmv-${file.fileIndex}-${headingSeq++}-${slugify(text) || "heading"}`;
    token.attrSet("id", anchorId);
    const sourceLine = Array.isArray(token.map) && typeof token.map[0] === "number"
      ? token.map[0] + 1
      : 1;

    tocItems.push({
      fileIndex: file.fileIndex,
      fileName: file.fileName,
      fileUriKey: file.fileUriKey,
      level,
      text,
      anchorId,
      sourceLine
    });

    return originalHeadingOpen(tokens, idx, options, env, self);
  };

  try {
    const html = md.render(markdownText);
    return { html, tocItemsForFile: tocItems };
  } finally {
    // 次ファイルへの副作用を避けるため、必ず元のルールへ戻す
    md.renderer.rules.heading_open = previousHeadingOpen;
  }
}

function buildWebviewHtml(
  webview: vscode.Webview,
  payload: {
    files: TocFile[];
    toc: TocItem[];
    contentHtml: string;
    config: {
      previewFontSize: number;
      previewLineHeight: number;
      previewMaxWidth: number;
      tocFontSize: number;
      tocMinWidthChars: number;
    };
  }
): string {
  const nonce = getNonce();

  // TOCはHTMLを自前生成（安全のため text は escape）
  const tocHtml = buildTocHtml(payload.files, payload.toc);

  // 最低限のCSP。styleは埋め込み、scriptはnonceで許可。
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} https: data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`
  ].join("; ");

  // TOC幅の計算: 文字サイズ * 文字数 + パディング等の概算
  // 20px は左右padding(10px*2)分、スクロールバー等も考慮して少し余裕を持たせるなら調整
  const tocWidth = (payload.config.tocFontSize * payload.config.tocMinWidthChars) + 24;

  // エディタのフォントサイズを取得（デフォルト14px）
  const editorFontSize = vscode.workspace.getConfiguration("editor").get<number>("fontSize", 14);
  // 設定値は％なので、エディタフォントサイズに対する割合で計算
  const previewFontSizePx = editorFontSize * (payload.config.previewFontSize / 100);

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Concat Markdown View</title>
<style>
  :root {
    --border: rgba(127,127,127,0.25);
    --muted: rgba(127,127,127,0.8);
    --preview-font-size: ${previewFontSizePx}px;
    --preview-line-height: ${payload.config.previewLineHeight / 100};
    --content-max-width: ${payload.config.previewMaxWidth}ch;
    --toc-font-size: ${payload.config.tocFontSize}px;
    --toc-width: ${tocWidth}px;
    --toc-minimized-width: 60px;
    --toc-bg: var(--vscode-editor-background);
  }
  body {
    margin: 0;
    padding: 0;
    font-family: -apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;
    background-color: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
  }
  .layout {
    display: grid;
    grid-template-columns: 1fr var(--toc-width);
    height: 100vh;
    transition: grid-template-columns 0.2s ease-out;
  }
  /* 最小化モード時のレイアウト */
  .layout[data-toc-mode="minimized"] {
    display: block;
    margin-right: var(--toc-minimized-width);
  }
  /* オーバーレイモード時のレイアウト */
  .layout[data-toc-mode="overlay"] {
    display: block; /* grid解除してフロー配置にする */
    position: relative;
  }
  .layout[data-toc-mode="overlay"] .content {
    width: 100%; /* 全幅使う */
    box-sizing: border-box;
  }

  .toc {
    position: fixed;
    top: 0;
    right: 0;
    height: 100vh;
    border-left: 1px solid var(--border);
    overflow: auto;
    padding: 12px 10px;
    font-size: var(--toc-font-size);
    background-color: var(--toc-bg);
    transition: padding 0.2s, box-shadow 0.2s, transform 0.2s;
    z-index: 10;
  }
  .layout[data-toc-mode="minimized"] .toc {
    box-sizing: border-box;
    width: var(--toc-minimized-width);
    padding: 12px 4px;
    overflow-x: hidden;
  }
  .layout[data-toc-mode="overlay"] .toc {
    position: fixed;
    width: var(--toc-width);
    box-shadow: -2px 0 12px rgba(0,0,0,0.3);
    border-left: 1px solid var(--border);
    z-index: 100; /* 最前面へ */
  }

  /* トグルボタン */
  .toc-toggle-btn {
    position: sticky;
    top: 0;
    right: 0;
    margin-left: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    font-size: 10px;
    cursor: pointer;
    z-index: 20;
    margin-bottom: 8px;
    opacity: 0.6;
  }
  .toc-toggle-btn:hover {
    opacity: 1;
    background: var(--vscode-button-secondaryHoverBackground);
  }
  .layout[data-toc-mode="minimized"] .toc-toggle-btn {
    width: 100%;
    margin-bottom: 12px;
  }

  .toc .group-title {
    font-size: 1em;
    color: var(--muted);
    margin: 14px 0 6px;
    word-break: break-all;
    font-weight: bold;
  }
  /* 最小化時はファイル名を細い線にする */
  .layout[data-toc-mode="minimized"] .group-title {
    font-size: 0;
    margin: 8px 0;
    height: 1px;
    background: var(--border);
    width: 80%;
    margin-left: auto;
    margin-right: auto;
  }
  .layout[data-toc-mode="minimized"] .group-row {
    padding: 0;
    margin-bottom: 8px;
  }

  .toc .group-row {
    padding: 0 6px;
  }
  .toc .toc-item-row {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 8px;
  }
  .toc .toc-item-row .toc-link {
    display: block;
    text-decoration: none;
    padding: 4px 6px;
    border-radius: 6px;
    color: inherit;
    word-break: break-all;
  }
  .toc .toc-item-row .toc-link:hover {
    background: rgba(127,127,127,0.15);
  }
  .toc .toc-edit-button {
    width: 24px;
    height: 24px;
    border: 1px solid var(--border);
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: inherit;
    cursor: pointer;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.12s ease-out;
  }
  .toc .toc-item-row:hover .toc-edit-button,
  .toc .toc-item-row:focus-within .toc-edit-button {
    opacity: 1;
    pointer-events: auto;
  }
  .toc .toc-edit-button:hover {
    background: rgba(127,127,127,0.2);
  }

  /* 最小化モードのスタイル変更 */
  .layout[data-toc-mode="minimized"] .toc-edit-button {
    display: none;
  }
  .layout[data-toc-mode="minimized"] .toc-item-row {
    display: block; /* grid解除 */
    margin-bottom: 2px;
  }
  .layout[data-toc-mode="minimized"] .toc-link {
    font-size: 0; /* 文字隠し */
    padding: 2px;
    text-align: center;
    height: 2px;
    border-radius: 0;
    background: transparent;
    position: relative;
    background: transparent;
  }
  /* H1-H3レベルのみインジケータ表示 */
  .layout[data-toc-mode="minimized"] .toc-item-row.lvl-1 .toc-link,
  .layout[data-toc-mode="minimized"] .toc-item-row.lvl-2 .toc-link,
  .layout[data-toc-mode="minimized"] .toc-item-row.lvl-3 .toc-link {
    width: 100%;
  }
  .layout[data-toc-mode="minimized"] .toc-item-row.lvl-1 .toc-link::after,
  .layout[data-toc-mode="minimized"] .toc-item-row.lvl-2 .toc-link::after,
  .layout[data-toc-mode="minimized"] .toc-item-row.lvl-3 .toc-link::after {
    content: "";
    display: block;
    height: 0;
    border: 2px solid var(--muted);
  }
  .layout[data-toc-mode="minimized"] .toc-item-row.lvl-1 .toc-link::after{
    background: var(--vscode-textLink-foreground);
  }
  /* レベルごとのインジケータ表現 */
  .layout[data-toc-mode="minimized"] .toc-item-row.lvl-1 .toc-link {
    // background: var(--vscode-textLink-foreground);
    opacity: 0.8;
    width: 80%;
    margin: 0 auto;
  }
  .layout[data-toc-mode="minimized"] .toc-item-row.lvl-2 .toc-link {
    // background: var(--muted);
    opacity: 0.6;
    width: 60%;
    margin-left: 20%;
  }
  .layout[data-toc-mode="minimized"] .toc-item-row.lvl-3 .toc-link {
    // background: var(--muted);
    opacity: 0.4;
    width: 40%;
    margin-left: 30%;
  }

  /* H4以下は非表示 */
  .layout[data-toc-mode="minimized"] .toc-item-row.lvl-4,
  .layout[data-toc-mode="minimized"] .toc-item-row.lvl-5,
  .layout[data-toc-mode="minimized"] .toc-item-row.lvl-6 {
    display: none;
  }

  .toc .toc-item-row.lvl-1 { padding-left: 6px; }
  .toc .toc-item-row.lvl-2 { padding-left: 18px; }
  .toc .toc-item-row.lvl-3 { padding-left: 30px; }
  .toc .toc-item-row.lvl-4 { padding-left: 42px; }
  .toc .toc-item-row.lvl-5 { padding-left: 54px; }
  .toc .toc-item-row.lvl-6 { padding-left: 66px; }
  .toc .toc-item-row.lvl-1 .toc-link { font-weight: 600; }
  
  /* 最小化時はpaddingリセット */
  .layout[data-toc-mode="minimized"] .toc-item-row { padding-left: 0 !important; }

  .content {
    overflow: auto;
    padding: 0;
    height: 100vh;
    font-size: var(--preview-font-size);
    line-height: var(--preview-line-height);
  }
  .file-section {
    border-top: 2px solid var(--border);
    margin-bottom: 2rem;
    overflow: visible;
  }

  .file-summary {
    display: grid;
    grid-template-columns: auto 1rem;
    list-style: none; /* marker を自前で */
    cursor: pointer;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
    background: var(--vscode-editor-background); /* 透過防止 */
    padding-left: 2em;
    padding-right: 2em;
    user-select: none;
    position: sticky;
    top: 0;
    left: 0;
    right: 0;
    z-index: 2;
  }
  .file-summary::-webkit-details-marker { display: none; }

  /* 簡易の開閉マーカー */
  .file-summary::after {
    content: "▼";
    grid-column: 2;
    grid-row: 1;
    display: inline-block;
    width: 1.2em;
    margin-right: 2px;
    transform: translateY(-1px);
  }
  details:not([open]) > .file-summary::after {
    content: "◀";
  }

  .file-title {
    grid-column: 1;
    grid-row: 1;
    font-weight: 700;
    font-size: 1em;
    word-break: break-all;
  }
  .file-path {
    grid-column: 1 / 3;
    grid-row: 2;
    font-size: 0.8em;
    color: var(--muted);
    word-break: break-all;
    margin-top: 4px;
  }
  .file-body {
    padding: 12px 1rem 12px 2rem;
    max-width: var(--content-max-width);
    box-sizing: content-box; /* paddingを含めずにmax-widthを適用 */
    margin-left: auto;
    margin-right: auto;
  }
  /* 最低限のMarkdown表示（必要に応じて拡張） */
  .markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6 { margin-top: 1.2em; line-height: 1.3; }
  .markdown-body pre { overflow:auto; padding: 10px; border-radius: 8px; border: 1px solid var(--border); }
  .markdown-body code { font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; }
  .markdown-body table { border-collapse: collapse; }
  .markdown-body th, .markdown-body td { border: 1px solid var(--border); padding: 6px 8px; }
  .markdown-body blockquote { border-left: 3px solid var(--border); margin-left: 0; padding-left: 10px; color: var(--muted); }
</style>
</head>
<body>
<div class="layout" id="layout" data-toc-mode="expanded">
  <main class="content" id="content">
    ${payload.contentHtml}
  </main>
  <nav class="toc" aria-label="目次">
    <button id="toc-toggle" class="toc-toggle-btn" title="目次の表示切り替え" aria-label="目次の表示切り替え">▶</button>
    ${tocHtml}
  </nav>
</div>

<script nonce="${nonce}">
  const vscodeApi = acquireVsCodeApi();
  
  // 状態管理
  let tocState = vscodeApi.getState() || { userOverride: null };
  const layout = document.getElementById('layout');
  const toggleBtn = document.getElementById('toc-toggle');
  
  // TOC幅定義 (CSS変数と連動させるのが理想だが、ここでは簡易的にJS側でも持つ)
  // tocWidthはCSS変数 var(--toc-width) だが、初期計算値はサーバーサイド（Extension）から来ている
  // 30% ルールのしきい値を判定するために、現在のウィンドウ幅との比率を見る
  
  function updateTocMode() {
    const windowWidth = document.body.clientWidth;
    // CSS変数の値を取得（単位 'px' を除去）
    const tocWidthStyle = getComputedStyle(document.documentElement).getPropertyValue('--toc-width');
    const tocWidth = parseInt(tocWidthStyle, 10);
    const fontSize = parseFloat(getComputedStyle(document.body).fontSize); // px単位
    
    // Config値の取得 (CSS変数から)
    // --content-max-width: 40ch
    const contentMaxWidthChStyle = getComputedStyle(document.documentElement).getPropertyValue('--content-max-width');
    const contentMaxWidthCh = parseInt(contentMaxWidthChStyle, 10) || 40;
    
    // 30% ルール（最小化判定）
    const isNarrowForToc = (tocWidth / windowWidth) > 0.30;
    
    // 本文幅確保ルール（オーバーレイ判定）
    // 本文領域として確保したい幅の目安を計算 (ch -> px概算 + padding)
    // ch単位は概ね 0.5em ~ 1em の間だが、安全側に倒して 1ch = 1emと仮定するか、ブラウザ依存に任せるのも手だが、
    // ここでは「残りの幅」が「設定された maxWidth」よりも著しく狭くなる場合を検出したい。
    // 「著しく狭い」の定義: 例えば maxWidth の 80% も確保できない、または固定で 400px 切るなど。
    // ここではシンプルに「ウィンドウ幅 - TOC幅」が「最小限必要な本文幅」を下回る場合とする。
    // 最小限必要な本文幅 = 400px (スマホ幅程度) と仮置きするか、あるいは設定値に基づくか。
    // ユーザー要望: "TOCを展開した際本文表示幅が確保できくなる場合に...文字列の回り込みで視覚と認知の影響が出ることを防ぎたい"
    // これは content-max-width (例えば40文字) が維持できない場合を指していると解釈できる。
    // つまり (WindowWidth - TOCWidth) < (ContentMaxWidthPx + Padding)
    
    // 1ch の幅を概算 (monospaceなら1ch=1文字幅だが、システムフォントだと可変)
    // 簡易的に 1ch = 0.6em 程度と仮定してもよいが、安全策で 10px 程度と見積もるか、あるいは「表示可能領域」で判断。
    // ここでは、ウィンドウ幅からTOC幅を引いた残りが 600px を切る場合はオーバーレイにする、という安全策を取る。
    // または、設定された max-width より狭くなる場合。
    
    // 簡易実装として「残り幅 < 600px」を閾値とする
    const remainingWidth = windowWidth - tocWidth;
    const isContentSqueezed = remainingWidth < 600; // 600px未満なら苦しいと判定

    // 決定優先順位: 1. ユーザーの手動設定, 2. 自動判定
    let mode = 'expanded';
    
    if (tocState.userOverride === 'minimized') {
      mode = 'minimized';
    } else {
      // ユーザーが 'expanded' (表示) を望んでいる、または未設定の場合
      // まず自動判定でモード候補を決める
      let autoMode = 'expanded';
      if (!tocState.userOverride && isNarrowForToc) {
        autoMode = 'minimized';
      } else if (isContentSqueezed) {
        autoMode = 'overlay';
      } else {
        autoMode = 'expanded';
      }

      // ユーザー設定が 'expanded' の場合でも、物理的に無理(overlay条件)なら overlay にする
      // ただし、「最小化」はユーザーが明示しない限り勝手にはしない（ 'minimized' にはならない）
      if (tocState.userOverride === 'expanded') {
         if (isContentSqueezed) {
             mode = 'overlay';
         } else {
             mode = 'expanded';
         }
      } else {
         // userOverrideなし -> 完全自動
         mode = autoMode;
      }
    }
    
    layout.setAttribute('data-toc-mode', mode);

    // トグルボタンの表示制御
    if (mode === 'expanded' || mode === 'overlay') {
        toggleBtn.textContent = '▶|'; // 閉じるイメージ
    } else {
        toggleBtn.textContent = '|◀'; // 開くイメージ
    }
  }

  // 初期化
  updateTocMode();

  // イベントリスナー: トグルボタン
  toggleBtn.addEventListener('click', () => {
    const currentMode = layout.getAttribute('data-toc-mode');
    
    // expanded/overlay <-> minimized のトグル
    // 現在が表示系(expanded/overlay)ならminimizedへ、そうでなければexpandedへ
    const newMode = (currentMode === 'minimized') ? 'expanded' : 'minimized';
    
    // ユーザー設定として保存
    // 'overlay' は自動算出結果なので、ユーザー設定としては 'expanded' (表示する意志) を保存する
    tocState.userOverride = newMode;
    vscodeApi.setState(tocState);
    
    updateTocMode();
  });

  // イベントリスナー: リサイズ監視
  // ResizeObserverを使うとより正確だが、window.resizeでも十分
  window.addEventListener('resize', () => {
    // ユーザーが手動操作していない場合のみ自動追従させたいならここでのupdateTocModeが効く
    // すでに手動操作済みの場合は updateTocMode 内で userOverride が優先されるのでOK
    updateTocMode();
  });


  document.querySelectorAll('.toc .toc-edit-button[data-file-uri-key][data-line]').forEach(button => {
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const fileUriKey = button.getAttribute('data-file-uri-key');
      const lineText = button.getAttribute('data-line');
      const line = lineText ? Number.parseInt(lineText, 10) : NaN;
      if (!fileUriKey || !Number.isInteger(line) || line <= 0) return;
      vscodeApi.postMessage({
        type: 'openMarkdownForEditAtLine',
        fileUriKey,
        line
      });
    });
  });

  // TOCクリックで該当idへスクロール（本文ペイン内）
  document.querySelectorAll('.toc a[data-anchor]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const id = a.getAttribute('data-anchor');
      const el = document.getElementById(id);
      if (!el) return;
      const section = el.closest('details.file-section');
      if (section instanceof HTMLDetailsElement && !section.open) {
        section.open = true;
      }
      requestAnimationFrame(() => {
        const content = document.getElementById('content');
        if (!(content instanceof HTMLElement)) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }

        const summary = section instanceof HTMLElement
          ? section.querySelector('summary.file-summary')
          : null;
        const summaryHeight = summary instanceof HTMLElement
          ? summary.getBoundingClientRect().height
          : 0;

        const contentRect = content.getBoundingClientRect();
        const headingRect = el.getBoundingClientRect();
        const offsetTop = summaryHeight + 8;
        const nextScrollTop =
          content.scrollTop + (headingRect.top - contentRect.top) - offsetTop;

        content.scrollTo({
          top: Math.max(nextScrollTop, 0),
          behavior: 'smooth'
        });
      });
    });
  });
</script>
</body>
</html>`;
}

async function buildPanelHtml(webview: vscode.Webview, mdUris: vscode.Uri[]): Promise<string> {
  const md = createMarkdownIt();
  const toc: TocItem[] = [];
  const files: TocFile[] = [];
  const sectionsHtml: string[] = [];

  for (let i = 0; i < mdUris.length; i++) {
    const u = mdUris[i];
    const buf = await vscode.workspace.fs.readFile(u);
    const text = new TextDecoder().decode(buf);
    const displayPath = toProjectRelativePath(u);
    const fileName = path.basename(u.fsPath);

    const { html, tocItemsForFile } = renderMarkdownWithAnchors(md, text, {
      fileIndex: i,
      fileName,
      fileUriKey: toUriKey(u)
    });

    toc.push(...tocItemsForFile);
    files.push({
      fileIndex: i,
      fileName,
      fileUriKey: toUriKey(u)
    });

    sectionsHtml.push(`
  <details class="file-section" data-file-index="${i}" open>
    <summary class="file-summary">
      <div class="file-title">${escapeHtml(fileName)}</div>
      <div class="file-path">${escapeHtml(displayPath)}</div>
    </summary>
    <div class="file-body markdown-body">
      ${html}
    </div>
  </details>
`);
  }

  return buildWebviewHtml(webview, {
    files,
    toc,
    contentHtml: sectionsHtml.join("\n"),
    config: {
      previewFontSize: vscode.workspace.getConfiguration("markdownConcatViewer").get<number>("preview.fontSize", 100),
      previewLineHeight: vscode.workspace.getConfiguration("markdownConcatViewer").get<number>("preview.lineHeight", 175),
      previewMaxWidth: vscode.workspace.getConfiguration("markdownConcatViewer").get<number>("preview.maxWidth", 40),
      tocFontSize: vscode.workspace.getConfiguration("markdownConcatViewer").get<number>("toc.fontSize", 12),
      tocMinWidthChars: vscode.workspace.getConfiguration("markdownConcatViewer").get<number>("toc.minWidthChars", 20)
    }
  });
}

function buildTocHtml(files: TocFile[], items: TocItem[]): string {
  const fileMap = new Map<number, TocFile>();
  for (const file of files) {
    fileMap.set(file.fileIndex, file);
  }

  const byFile = new Map<number, TocItem[]>();
  for (const it of items) {
    const arr = byFile.get(it.fileIndex) ?? [];
    arr.push(it);
    byFile.set(it.fileIndex, arr);
  }

  let html = "";
  for (const file of files) {
    const arr = byFile.get(file.fileIndex) ?? [];
    const fileName = fileMap.get(file.fileIndex)?.fileName ?? `file-${file.fileIndex}`;
    html += `<div class="group-row"><div class="group-title">${escapeHtml(fileName)}</div></div>`;
    for (const it of arr) {
      html += `<div class="toc-item-row lvl-${it.level}">
  <a href="#" class="toc-link" data-anchor="${escapeHtml(it.anchorId)}" title="${escapeHtml(fileName + " - " + it.text)}">${escapeHtml(it.text || "(no title)")}</a>
  <button class="toc-edit-button" type="button" title="この見出しを編集で開く" aria-label="この見出しを編集で開く" data-file-uri-key="${escapeHtml(it.fileUriKey)}" data-line="${it.sourceLine}">✎</button>
</div>`;
    }
  }
  return html;
}

function toUriKey(uri: vscode.Uri): string {
  return uri.toString();
}

function toPathKey(fsPath: string): string {
  if (process.platform === "win32") {
    return fsPath.toLowerCase();
  }
  return fsPath;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    // 日本語等は残しつつ、スペース類をハイフンに
    .replace(/[\s]+/g, "-")
    // URL的に危ない記号は除去
    .replace(/[<>"'`]/g, "")
    .slice(0, 80);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getNonce(): string {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) { text += possible.charAt(Math.floor(Math.random() * possible.length)); }
  return text;
}

export const __test__ = {
  normalizeUris,
  resolveMarkdownUris,
  isMarkdownName,
  toProjectRelativePath,
  createMarkdownIt,
  renderMarkdownWithAnchors,
  buildTocHtml,
  buildWebviewHtml
};
