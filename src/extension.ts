// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import markdownit from 'markdown-it';

type TocItem = {
	fileIndex: number;
	fileName: string;
	fileFsPath: string;
	level: number; // 1..6
	text: string;
	anchorId: string;
	sourceLine: number;
};

type TocFile = {
	fileIndex: number;
	fileName: string;
	fileFsPath: string;
};

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
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

				const markdownPathSet = new Set(mdUris.map((u) => toPathKey(u.fsPath)));
				const renderView = async () => {
					panel.webview.html = await buildPanelHtml(panel.webview, mdUris);
				};

				panel.webview.onDidReceiveMessage(async (message) => {
					if (!message || message.type !== "openMarkdownForEditAtLine" || typeof message.filePath !== "string") {
						return;
					}
					if (!markdownPathSet.has(toPathKey(message.filePath))) {
						return;
					}
					const line = typeof message.line === "number" && Number.isInteger(message.line) && message.line > 0
						? message.line
						: 1;
					try {
						const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(message.filePath));
						const targetLine = Math.min(Math.max(line - 1, 0), Math.max(doc.lineCount - 1, 0));
						const selection = new vscode.Range(targetLine, 0, targetLine, 0);
						await vscode.window.showTextDocument(doc, {
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

				panel.onDidDispose(() => {
					saveListener.dispose();
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
	file: { fileIndex: number; fileName: string; fileFsPath: string }
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
			fileFsPath: file.fileFsPath,
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
	payload: { files: TocFile[]; toc: TocItem[]; contentHtml: string }
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
  }
  body {
    margin: 0;
    padding: 0;
    font-family: -apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;
  }
  .layout {
    display: grid;
    grid-template-columns: 1fr 320px;
    height: 100vh;
  }
  .toc {
    border-left: 1px solid var(--border);
    overflow: auto;
    padding: 12px 10px;
  }
  .toc .group-title {
    font-size: 1rem;
    color: var(--muted);
    margin: 14px 0 6px;
    word-break: break-all;
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
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
  .toc .toc-item-row.lvl-1 { padding-left: 6px; }
  .toc .toc-item-row.lvl-2 { padding-left: 18px; }
  .toc .toc-item-row.lvl-3 { padding-left: 30px; }
  .toc .toc-item-row.lvl-4 { padding-left: 42px; }
  .toc .toc-item-row.lvl-5 { padding-left: 54px; }
  .toc .toc-item-row.lvl-6 { padding-left: 66px; }
  .toc .toc-item-row.lvl-1 .toc-link { font-weight: 600; }

  .content {
    overflow: auto;
    padding: 0 22px 40px;
  }
    .file-section {
    border: 1px solid var(--border);
    border-radius: 10px;
    margin-bottom: 18px;
    overflow: visible;
    }

    .file-summary {
	display: grid;
	grid-template-columns: auto 1rem;
    list-style: none; /* marker を自前で */
    cursor: pointer;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    background: rgba(33,33,33,0.98);
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
    font-size: 1rem;
    word-break: break-all;
    }
    .file-path {
	grid-column: 1 / 3;
	grid-row: 2;
    font-size: 0.8rem;
    color: var(--muted);
    word-break: break-all;
    margin-top: 4px;
    }
  .file-body {
    padding: 12px 14px;
  }
  /* 最低限のMarkdown表示（必要に応じて拡張） */
  .markdown-body h1, .markdown-body h2, .markdown-body h3 { margin-top: 1.2em; }
  .markdown-body pre { overflow:auto; padding: 10px; border-radius: 8px; border: 1px solid var(--border); }
  .markdown-body code { font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; }
  .markdown-body table { border-collapse: collapse; }
  .markdown-body th, .markdown-body td { border: 1px solid var(--border); padding: 6px 8px; }
  .markdown-body blockquote { border-left: 3px solid var(--border); margin-left: 0; padding-left: 10px; color: var(--muted); }
</style>
</head>
<body>
<div class="layout">
  <main class="content" id="content">
    ${payload.contentHtml}
  </main>
  <nav class="toc" aria-label="目次">
    ${tocHtml}
  </nav>
</div>

<script nonce="${nonce}">
  const vscodeApi = acquireVsCodeApi();

  document.querySelectorAll('.toc .toc-edit-button[data-file-path][data-line]').forEach(button => {
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const filePath = button.getAttribute('data-file-path');
      const lineText = button.getAttribute('data-line');
      const line = lineText ? Number.parseInt(lineText, 10) : NaN;
      if (!filePath || !Number.isInteger(line) || line <= 0) return;
      vscodeApi.postMessage({
        type: 'openMarkdownForEditAtLine',
        filePath,
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
			fileFsPath: u.fsPath
		});

		toc.push(...tocItemsForFile);
		files.push({
			fileIndex: i,
			fileName,
			fileFsPath: u.fsPath
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
		contentHtml: sectionsHtml.join("\n")
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
  <a href="#" class="toc-link" data-anchor="${escapeHtml(it.anchorId)}" title="${escapeHtml(it.text)}">${escapeHtml(it.text || "(no title)")}</a>
  <button class="toc-edit-button" type="button" title="この見出しを編集で開く" aria-label="この見出しを編集で開く" data-file-path="${escapeHtml(it.fileFsPath)}" data-line="${it.sourceLine}">✎</button>
</div>`;
		}
	}
	return html;
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
