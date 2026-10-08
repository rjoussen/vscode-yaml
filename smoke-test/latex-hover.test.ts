/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Red Hat, Inc. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { assert } from 'chai';
import * as vscode from 'vscode';

// This suite runs against the packaged desktop and web extension, including its lazy chunks.
describe('LaTeX schema hover integration', function () {
  this.timeout(20_000);
  let document: vscode.TextDocument;
  let configuration: vscode.WorkspaceConfiguration;
  let previous: boolean | undefined;

  before(async () => {
    const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'latex-hover.yaml');
    configuration = vscode.workspace.getConfiguration('yaml', uri);
    previous = configuration.inspect<boolean>('hoverLatex').workspaceValue;
    document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    await vscode.extensions.getExtension('redhat.vscode-yaml').activate();
  });

  after(async () => {
    await configuration.update('hoverLatex', previous, vscode.ConfigurationTarget.Workspace);
  });

  async function hover(line = 1, marker = 'Following prose.'): Promise<string> {
    for (let attempt = 0; attempt < 40; attempt++) {
      const results = await vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider',
        document.uri,
        new vscode.Position(line, 2)
      );
      const value = results
        .map((result) => result.contents.map((content) => (typeof content === 'string' ? content : content.value)).join('\n'))
        .join('\n');
      if (value.includes(marker)) return value;
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    assert.fail('Schema hover did not become available');
  }

  it('preserves ordinary hover content while disabled', async () => {
    await configuration.update('hoverLatex', false, vscode.ConfigurationTarget.Workspace);
    const value = await hover();
    assert.include(value, '$E = mc^2$');
    assert.notInclude(value, 'data:image/svg+xml');
  });

  it('renders equations offline and preserves surrounding Markdown on repeated hovers', async () => {
    await configuration.update('hoverLatex', true, vscode.ConfigurationTarget.Workspace);
    for (let attempt = 0; attempt < 2; attempt++) {
      const value = await hover();
      assert.equal((value.match(/data:image\/svg\+xml;base64,/g) || []).length, 4);
      assert.include(value, '`$HOME$`');
      assert.include(value, '[reference](https://example.com/$x$)');
      assert.include(value, 'Following prose.');
    }
  });

  it('renders equations but not parentheses or brackets in plain descriptions', async () => {
    await configuration.update('hoverLatex', true, vscode.ConfigurationTarget.Workspace);
    const value = await hover(2, 'Following plain prose');
    assert.equal((value.match(/data:image\/svg\+xml;base64,/g) || []).length, 1);
    assert.include(value, '\\(exact\\) \\[unitless\\]');
  });

  it('takes effect without restarting the language server', async () => {
    await configuration.update('hoverLatex', false, vscode.ConfigurationTarget.Workspace);
    assert.notInclude(await hover(), 'data:image/svg+xml');
  });
});
