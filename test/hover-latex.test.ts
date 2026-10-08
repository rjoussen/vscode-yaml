/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Red Hat, Inc. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { provideLatexHover } from '../src/hover-latex';

describe('LaTeX hover middleware', () => {
  const sandbox = sinon.createSandbox();
  const document = { uri: vscode.Uri.file('/test.yaml') } as vscode.TextDocument;
  const position = new vscode.Position(0, 0);
  const token = new vscode.CancellationTokenSource().token;

  function setEnabled(enabled: boolean | undefined): void {
    sandbox.stub(vscode.workspace, 'getConfiguration').returns({
      get: (key: string, defaultValue: boolean) => (key === 'hoverLatex' && enabled !== undefined ? enabled : defaultValue),
    } as vscode.WorkspaceConfiguration);
  }

  function hover(...contents: vscode.MarkdownString[]): vscode.ProviderResult<vscode.Hover> {
    return new vscode.Hover(contents);
  }

  afterEach(() => {
    sandbox.restore();
  });

  it('leaves hover contents unchanged when disabled', async () => {
    for (const enabled of [false, undefined]) {
      setEnabled(enabled);
      const result = await provideLatexHover(document, position, token, () => hover(new vscode.MarkdownString('$x$')));

      assert.strictEqual((result.contents[0] as vscode.MarkdownString).value, '$x$');
      sandbox.restore();
    }
  });

  it('renders math in Markdown hover contents when enabled', async () => {
    setEnabled(true);
    const trusted = new vscode.MarkdownString('$x$ and `$y$`');
    trusted.isTrusted = true;
    const range = new vscode.Range(0, 0, 0, 3);

    const result = await provideLatexHover(document, position, token, () => new vscode.Hover([trusted, 'plain $x$'], range));

    const markdown = result.contents[0] as vscode.MarkdownString;
    if ('supportHtml' in vscode.MarkdownString.prototype) {
      assert.match(
        markdown.value,
        /^<img align="middle" alt="x" src="data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+"> and `\$y\$`$/
      );
      assert.strictEqual(markdown.supportHtml, true);
    } else {
      assert.match(markdown.value, /^!\[x\]\(data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+\) and `\$y\$`$/);
    }
    assert.strictEqual(markdown.isTrusted, true);
    assert.strictEqual(result.contents[1], 'plain $x$');
    assert.strictEqual(result.range, range);
  });

  it('passes through an empty hover', async () => {
    setEnabled(true);

    assert.strictEqual(await provideLatexHover(document, position, token, () => null), null);
  });

  it('does not transform cancelled requests', async () => {
    setEnabled(true);
    const source = new vscode.CancellationTokenSource();
    const original = new vscode.Hover(new vscode.MarkdownString('$cancelled$'));
    source.cancel();
    assert.strictEqual(await provideLatexHover(document, position, source.token, () => original), original);
    assert.strictEqual((original.contents[0] as vscode.MarkdownString).value, '$cancelled$');
    source.dispose();
  });

  it('leaves non-mathematical Markdown and its flags unchanged', async () => {
    setEnabled(true);
    const content = new vscode.MarkdownString('Plain **documentation**');
    content.baseUri = vscode.Uri.parse('https://example.com');
    content.supportThemeIcons = true;
    await provideLatexHover(document, position, token, () => hover(content));
    assert.strictEqual(content.value, 'Plain **documentation**');
    assert.notStrictEqual(content.supportHtml, true);
    assert.strictEqual(content.supportThemeIcons, true);
    assert.strictEqual(content.baseUri.toString(), 'https://example.com/');
  });
});
