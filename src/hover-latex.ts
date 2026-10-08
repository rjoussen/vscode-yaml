/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Red Hat, Inc. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { CancellationToken, Hover, Position, TextDocument } from 'vscode';
import { ColorThemeKind, MarkdownString, window, workspace } from 'vscode';
import type { ProvideHoverSignature } from 'vscode-languageclient';

/**
 * Hover middleware that renders LaTeX math in Markdown hover contents when `yaml.hoverLatex` is enabled.
 * The language server stays editor agnostic, the rendering to SVG images is specific to VS Code hovers.
 */
export async function provideLatexHover(
  document: TextDocument,
  position: Position,
  token: CancellationToken,
  next: ProvideHoverSignature
): Promise<Hover | null | undefined> {
  const hover = await next(document, position, token);
  if (
    !hover ||
    token.isCancellationRequested ||
    !workspace.getConfiguration('yaml', document.uri).get<boolean>('hoverLatex', false)
  ) {
    return hover;
  }
  const contents = hover.contents.filter(
    (content): content is MarkdownString => content instanceof MarkdownString && /\$|\\[([]/.test(content.value)
  );
  if (!contents.length) {
    return hover;
  }
  try {
    // Node16 compilation preserves this import so webpack can emit a separate renderer chunk.
    const { renderLatexInMarkdown } = await import(/* webpackChunkName: "latex" */ './latex-markdown.js');
    const color = getEquationColor(window.activeColorTheme.kind);
    // Detect HTML support at runtime; otherwise use ordinary Markdown images.
    const canUseHtml = 'supportHtml' in MarkdownString.prototype;
    const rendered = [];
    for (const content of contents) {
      if (token.isCancellationRequested) return hover;
      rendered.push(await renderLatexInMarkdown(content.value, color, canUseHtml, () => token.isCancellationRequested));
    }
    if (token.isCancellationRequested) return hover;
    contents.forEach((content, index) => {
      content.value = rendered[index].value;
      if (rendered[index].html) content.supportHtml = true;
    });
  } catch {
    // A failed optional renderer must not prevent schema documentation from being shown.
  }
  return hover;
}

/** Extensions cannot read theme colors, so approximate the hover foreground per theme kind. */
function getEquationColor(kind: ColorThemeKind): string {
  switch (kind) {
    case ColorThemeKind.Light:
      return '#333333';
    case ColorThemeKind.HighContrastLight:
      return '#000000';
    case ColorThemeKind.HighContrast:
      return '#ffffff';
    default:
      return '#cccccc';
  }
}
