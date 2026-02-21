/**
 * テストコードが extension.ts の __test__ を import できるよう、
 * 各モジュールから関数を再エクスポートするブリッジファイル
 */
import {
    normalizeUris,
    resolveMarkdownUris,
    isMarkdownName,
    toProjectRelativePath
} from './utils';
import { createMarkdownIt, renderMarkdownWithAnchors } from './markdown';
import { buildTocHtml, buildWebviewHtml } from './webview';

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
