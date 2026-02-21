import * as path from 'path';
import * as vscode from 'vscode';

/**
 * uri と selectedUris を受け取り、重複除去した URI リストを返す
 */
export function normalizeUris(uri?: vscode.Uri, selectedUris?: vscode.Uri[]): vscode.Uri[] {
    const list: vscode.Uri[] = [];
    if (Array.isArray(selectedUris) && selectedUris.length > 0) {
        list.push(...selectedUris);
    } else if (uri) {
        list.push(uri);
    }
    return dedupeUris(list);
}

/**
 * URI リストから重複を除外する
 */
export function dedupeUris(uris: vscode.Uri[]): vscode.Uri[] {
    const seen = new Set<string>();
    return uris.filter((u) => {
        const key = u.toString();
        if (seen.has(key)) { return false; }
        seen.add(key);
        return true;
    });
}

/**
 * URI リストからディレクトリ展開・Markdown ファイル絞り込みを行い URI リストを返す
 */
export async function resolveMarkdownUris(uris: vscode.Uri[]): Promise<vscode.Uri[]> {
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

/**
 * ファイルステータスを安全に取得する（存在しない場合は undefined を返す）
 */
export async function safeStat(uri: vscode.Uri): Promise<vscode.FileStat | undefined> {
    try {
        return await vscode.workspace.fs.stat(uri);
    } catch {
        return undefined;
    }
}

/**
 * ディレクトリ直下の Markdown ファイル URI リストを返す
 */
export async function listDirectMarkdownFiles(dir: vscode.Uri): Promise<vscode.Uri[]> {
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

/**
 * URI が Markdown ファイルかどうかを判定する
 */
export function isMarkdownFile(u: vscode.Uri): boolean {
    return isMarkdownName(u.fsPath);
}

/**
 * ファイル名のみで Markdown ファイルかどうかを判定する（大文字小文字非依存）
 */
export function isMarkdownName(targetPath: string): boolean {
    const ext = path.extname(targetPath).toLowerCase();
    return ext === ".md" || ext === ".markdown";
}

/**
 * ワークスペース相対パスを返す（ワークスペース外の場合は絶対パスを返す）
 */
export function toProjectRelativePath(uri: vscode.Uri): string {
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

/**
 * URI を文字列キーに変換する
 */
export function toUriKey(uri: vscode.Uri): string {
    return uri.toString();
}

/**
 * ファイルパスを比較用のキーに変換する（Windows では小文字化）
 */
export function toPathKey(fsPath: string): string {
    if (process.platform === "win32") {
        return fsPath.toLowerCase();
    }
    return fsPath;
}

/**
 * 文字列をアンカー ID 用にスラッグ化する
 */
export function slugify(s: string): string {
    return s
        .toLowerCase()
        .trim()
        // 日本語等は残しつつ、スペース類をハイフンに
        .replace(/[\s]+/g, "-")
        // URL的に危ない記号は除去
        .replace(/[<>"'`]/g, "")
        .slice(0, 80);
}

/**
 * HTML 特殊文字をエスケープする
 */
export function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * ランダムな nonce 文字列を生成する（CSP 用）
 */
export function getNonce(): string {
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let text = "";
    for (let i = 0; i < 32; i++) { text += possible.charAt(Math.floor(Math.random() * possible.length)); }
    return text;
}
