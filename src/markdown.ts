import markdownit from 'markdown-it';
import type { TocItem } from './types';
import { slugify } from './utils';

/**
 * markdown-it インスタンスを生成する
 * html: false で生 HTML を無効化（安全側）
 */
export function createMarkdownIt(): markdownit {
    const md = new markdownit({
        html: false,
        linkify: true,
        breaks: false
    });
    return md;
}

/**
 * Markdown テキストを HTML にレンダリングし、見出しにアンカーを付与する
 * 同時に TOC アイテムリストも収集して返す
 */
export function renderMarkdownWithAnchors(
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
