import * as assert from 'assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { __test__ } from '../extension';

suite('Extension Test Suite', () => {
	test('isMarkdownName は .md / .markdown を判定できる', () => {
		assert.strictEqual(__test__.isMarkdownName('a.md'), true);
		assert.strictEqual(__test__.isMarkdownName('b.markdown'), true);
		assert.strictEqual(__test__.isMarkdownName('c.MD'), true);
		assert.strictEqual(__test__.isMarkdownName('d.txt'), false);
	});

	test('normalizeUris は重複 URI を除外する', () => {
		const base = os.tmpdir();
		const sameA = vscode.Uri.file(path.join(base, 'sample.md'));
		const sameB = vscode.Uri.file(path.join(base, 'sample.md'));
		const other = vscode.Uri.file(path.join(base, 'other.md'));
		const result = __test__.normalizeUris(undefined, [sameA, sameB, other]);
		assert.strictEqual(result.length, 2);
		assert.strictEqual(result[0].fsPath, sameA.fsPath);
		assert.strictEqual(result[1].fsPath, other.fsPath);
	});

	test('resolveMarkdownUris はディレクトリ直下の Markdown のみを対象にする', async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmv-test-'));
		try {
			const directMd = path.join(tempDir, 'a.md');
			const directMarkdown = path.join(tempDir, 'b.markdown');
			const directTxt = path.join(tempDir, 'c.txt');
			const nestedDir = path.join(tempDir, 'nested');
			const nestedMd = path.join(nestedDir, 'd.md');

			await fs.writeFile(directMd, '# a', 'utf8');
			await fs.writeFile(directMarkdown, '# b', 'utf8');
			await fs.writeFile(directTxt, 'ignore', 'utf8');
			await fs.mkdir(nestedDir);
			await fs.writeFile(nestedMd, '# d', 'utf8');

			const result = await __test__.resolveMarkdownUris([vscode.Uri.file(tempDir)]);
			const names = result.map((u) => path.basename(u.fsPath)).sort();
			assert.deepStrictEqual(names, ['a.md', 'b.markdown']);
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	test('resolveMarkdownUris はファイル指定とディレクトリ展開の重複を除外する', async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmv-test-'));
		try {
			const directMd = path.join(tempDir, 'a.md');
			const directMarkdown = path.join(tempDir, 'b.markdown');
			await fs.writeFile(directMd, '# a', 'utf8');
			await fs.writeFile(directMarkdown, '# b', 'utf8');

			const result = await __test__.resolveMarkdownUris([
				vscode.Uri.file(directMd),
				vscode.Uri.file(tempDir)
			]);
			const names = result.map((u) => path.basename(u.fsPath)).sort();
			assert.deepStrictEqual(names, ['a.md', 'b.markdown']);
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	test('renderMarkdownWithAnchors は複数ファイルでもアンカーを正しく付与する', () => {
		const md = __test__.createMarkdownIt();
		const first = __test__.renderMarkdownWithAnchors(md, '# First', {
			fileIndex: 0,
			fileName: 'a.md',
			fileUriKey: 'file:///tmp/a.md'
		});
		const second = __test__.renderMarkdownWithAnchors(md, '# Second', {
			fileIndex: 1,
			fileName: 'b.md',
			fileUriKey: 'file:///tmp/b.md'
		});

		assert.ok(first.html.includes('id="cmv-0-0-first"'));
		assert.ok(second.html.includes('id="cmv-1-0-second"'));
		assert.strictEqual(first.tocItemsForFile[0]?.anchorId, 'cmv-0-0-first');
		assert.strictEqual(second.tocItemsForFile[0]?.anchorId, 'cmv-1-0-second');
		assert.strictEqual(first.tocItemsForFile[0]?.sourceLine, 1);
	});

	test('buildWebviewHtml には TOC 遷移時の展開とオフセット制御が含まれる', () => {
		const html = __test__.buildWebviewHtml(
			{ cspSource: 'vscode-webview://test' } as unknown as vscode.Webview,
			{
				files: [{
					fileIndex: 0,
					fileName: 'a.md',
					fileUriKey: 'file:///tmp/a.md'
				}],
				toc: [{
					fileIndex: 0,
					fileName: 'a.md',
					fileUriKey: 'file:///tmp/a.md',
					level: 1,
					text: 'H1',
					anchorId: 'cmv-0-0-h1',
					sourceLine: 1
				}],
				contentHtml: '<details class="file-section"><summary class="file-summary">a.md</summary><h1 id="cmv-0-0-h1">H1</h1></details>'
			}
		);

		assert.ok(html.includes('section.open = true;'));
		assert.ok(html.includes('const summaryHeight'));
		assert.ok(html.includes('offsetTop = summaryHeight + 8'));
	});

	test('buildTocHtml は見出し行に編集ボタンと行番号を含める', () => {
		const html = __test__.buildTocHtml(
			[{
				fileIndex: 0,
				fileName: 'a.md',
				fileUriKey: 'file:///tmp/a.md'
			}],
			[{
				fileIndex: 0,
				fileName: 'a.md',
				fileUriKey: 'file:///tmp/a.md',
				level: 1,
				text: 'H1',
				anchorId: 'cmv-0-0-h1',
				sourceLine: 12
			}]
		);

		assert.ok(html.includes('class="toc-edit-button"'));
		assert.ok(html.includes('data-file-uri-key="file:///tmp/a.md"'));
		assert.ok(html.includes('data-line="12"'));
	});
});
