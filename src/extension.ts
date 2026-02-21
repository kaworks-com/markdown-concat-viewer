import * as vscode from 'vscode';
import { normalizeUris, resolveMarkdownUris, toUriKey, toPathKey } from './utils';
import { buildPanelHtml } from './webview';

// テスト用エクスポート（後方互換性を維持）
export { __test__ } from './exports-test';

export function activate(context: vscode.ExtensionContext) {
  const panels = new Set<vscode.WebviewPanel>();

  const updateContextKey = () => {
    // TabInputWebview 経由だと viewType が取れる保証がないため、単純に active なパネルが自分たちの管理下にあるかで判定する
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
