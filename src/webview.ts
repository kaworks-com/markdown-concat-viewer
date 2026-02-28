import * as path from 'path';
import * as vscode from 'vscode';
import type { TocFile, TocItem } from './types';
import { createMarkdownIt, renderMarkdownWithAnchors } from './markdown';
import { toProjectRelativePath, toUriKey, escapeHtml, getNonce } from './utils';

// SCSS からビルドされた CSS 文字列（esbuild-sass-plugin によるバンドル時に展開される）
import webviewCss from './styles/webview.scss';

/**
 * Webview HTML 生成に必要な設定値
 */
type WebviewConfig = {
  previewFontSize: number;
  previewLineHeight: number;
  previewMaxWidth: number;
  tocFontSize: number;
  tocMinWidthChars: number;
};

/**
 * Webview のメイン HTML を生成する
 */
export function buildWebviewHtml(
  webview: vscode.Webview,
  payload: {
    files: TocFile[];
    toc: TocItem[];
    contentHtml: string;
    config: WebviewConfig;
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
  ${webviewCss}
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
  
  function updateTocMode() {
    const windowWidth = document.body.clientWidth;
    // CSS変数の値を取得（単位 'px' を除去）
    const tocWidthStyle = getComputedStyle(document.documentElement).getPropertyValue('--toc-width');
    const tocWidth = parseInt(tocWidthStyle, 10);
    
    // 30% ルール（最小化判定）
    const isNarrowForToc = (tocWidth / windowWidth) > 0.30;
    
    // 本文幅確保ルール（オーバーレイ判定）
    // ウィンドウ幅からTOC幅を引いた残りが 600px 未満の場合はオーバーレイにする
    const remainingWidth = windowWidth - tocWidth;
    const isContentSqueezed = remainingWidth < 600;

    // 決定優先順位: 1. ユーザーの手動設定, 2. 自動判定
    let mode = 'expanded';
    
    if (tocState.userOverride === 'minimized') {
      mode = 'minimized';
    } else {
      // ユーザーが 'expanded' (表示) を望んでいる、または未設定の場合
      let autoMode = 'expanded';
      if (!tocState.userOverride && isNarrowForToc) {
        autoMode = 'minimized';
      } else if (isContentSqueezed) {
        autoMode = 'overlay';
      } else {
        autoMode = 'expanded';
      }

      // ユーザー設定が 'expanded' の場合でも、物理的に無理(overlay条件)なら overlay にする
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
        toggleBtn.textContent = '▶|';
    } else {
        toggleBtn.textContent = '|◀';
    }
  }

  // 初期化
  updateTocMode();

  // イベントリスナー: トグルボタン
  toggleBtn.addEventListener('click', () => {
    const currentMode = layout.getAttribute('data-toc-mode');
    const newMode = (currentMode === 'minimized') ? 'expanded' : 'minimized';
    tocState.userOverride = newMode;
    vscodeApi.setState(tocState);
    updateTocMode();
  });

  // イベントリスナー: リサイズ監視
  window.addEventListener('resize', () => {
    updateTocMode();
  });

  // 更新ボタン: クリックで Markdown を再読み込みする
  const refreshBtn = document.getElementById('toc-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      vscodeApi.postMessage({ type: 'refreshMarkdown' });
    });
  }

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

/**
 * TOC の HTML を生成する（ファイルグループ + 見出しリンク）
 */
export function buildTocHtml(files: TocFile[], items: TocItem[]): string {
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
  // TOC最下部に再読み込みボタンを追加
  html += `<div class="toc-refresh-row">
  <button id="toc-refresh-btn" class="toc-refresh-btn" type="button" title="Markdownを再読み込みする" aria-label="Markdownを再読み込みする">↺ 再読み込み</button>
</div>`;
  return html;
}

/**
 * Webview パネル用の HTML を構築する（ファイル読み込み + レンダリング + HTML 生成）
 */
export async function buildPanelHtml(webview: vscode.Webview, mdUris: vscode.Uri[]): Promise<string> {
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
