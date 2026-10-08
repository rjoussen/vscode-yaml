/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Red Hat, Inc. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { createMathRenderer } from './math-renderer';
import type { MathSpan } from './markdown-math';
import { parseMarkdownMath } from './markdown-math';

// VS Code truncates MarkdownString values at 100,000 characters, even inside image data URIs.
export const MAX_MARKDOWN_LENGTH = 90_000;
const MAX_EQUATIONS = 64;
const MAX_TEX_LENGTH = 16 * 1024;
const CACHE_CHARACTERS = 1_000_000;
const cache = new Map<string, RenderedMarkdown>();
let cacheCharacters = 0;

export interface RenderedMarkdown {
  value: string;
  /** Enable HTML only when the transformation inserted an HTML image. */
  html: boolean;
}

/** Render math without changing surrounding Markdown or losing prose to VS Code's size limit. */
export async function renderLatexInMarkdown(
  markdown: string,
  color: string,
  allowHtml = false,
  cancelled: () => boolean = () => false
): Promise<RenderedMarkdown> {
  const original = { value: markdown, html: false };
  if (cancelled() || markdown.length > MAX_MARKDOWN_LENGTH || !/\$|\\[([]/.test(markdown)) return original;
  const key = JSON.stringify([markdown, color, allowHtml]);
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return { ...cached };
  }
  const { spans, hasHtml } = await parseMarkdownMath(markdown);
  if (cancelled() || !spans.length) return original;
  const render = createMathRenderer();
  const html = allowHtml && !hasHtml;
  const chunks: string[] = [];
  let offset = 0;
  let size = markdown.length;
  let usedHtml = false;
  for (const [index, span] of spans.slice(0, MAX_EQUATIONS).entries()) {
    // Yield to the extension host so cancellation can be observed between batches of equations.
    if (index % 8 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (cancelled()) return original;
    if (span.tex.length > MAX_TEX_LENGTH) continue;
    let image: string;
    try {
      const svg = render(span.tex, span.display).replace(/currentColor/g, color);
      image = svgToImage(svg, span, html);
    } catch {
      // Invalid/unsupported TeX and MathJax's expansion limits leave the source intact.
      continue;
    }
    const nextSize = size + image.length - (span.end - span.start);
    if (nextSize > MAX_MARKDOWN_LENGTH) continue;
    chunks.push(markdown.slice(offset, span.start), image);
    offset = span.end;
    size = nextSize;
    usedHtml = usedHtml || (html && (!span.display || span.block));
  }
  chunks.push(markdown.slice(offset));
  const result = { value: chunks.join(''), html: usedHtml };
  const cost = key.length + result.value.length;
  while (cache.size && cacheCharacters + cost > CACHE_CHARACTERS) {
    const oldest = cache.keys().next().value as string;
    cacheCharacters -= oldest.length + cache.get(oldest).value.length;
    cache.delete(oldest);
  }
  const previous = cache.get(key);
  if (previous) cacheCharacters -= key.length + previous.value.length;
  cache.set(key, result);
  cacheCharacters += cost;
  return { ...result };
}

function svgToImage(svg: string, span: MathSpan, html: boolean): string {
  const { tex, display, block, prefix } = span;
  const htmlAlt = tex.replace(/\s+/g, ' ').replace(/[&"<>]/g, (char) => `&#${char.charCodeAt(0)};`);
  if (html && !display) {
    return `<img align="middle" alt="${htmlAlt}" src="data:image/svg+xml;base64,${toBase64(centerBaseline(svg))}">`;
  }
  const alt = tex.replace(/\s+/g, ' ').replace(/[\\`*_{}[\]()#+\-.!<>|$]/g, '\\$&');
  const image =
    html && block
      ? `<p align="center"><img alt="${htmlAlt}" src="data:image/svg+xml;base64,${toBase64(svg)}"></p>`
      : `![${alt}](data:image/svg+xml;base64,${toBase64(svg)})`;
  return block ? `\n${prefix}\n${prefix}${image}\n${prefix}\n${prefix}` : image;
}

/**
 * Pads a MathJax SVG vertically so the math baseline is in its middle. An `<img align="middle">` has its middle on the
 * text baseline, so the baselines line up, also for fractions and other math that reaches far below the baseline.
 */
export function centerBaseline(svg: string): string {
  const viewBox = /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/.exec(svg);
  const height = /height="([\d.]+)ex"/.exec(svg);
  if (!viewBox || !height) {
    return svg;
  }
  // MathJax puts the baseline at y = 0, `minY` is minus the height above it
  const [minX, minY, width, boxHeight] = viewBox.slice(1).map(Number);
  const half = Math.max(-minY, boxHeight + minY);
  return svg
    .replace(viewBox[0], `viewBox="${minX} ${-half} ${width} ${2 * half}"`)
    .replace(height[0], `height="${((Number(height[1]) * 2 * half) / boxHeight).toFixed(3)}ex"`);
}

function toBase64(text: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(text, 'utf8').toString('base64');
  }
  // web worker
  let binary = '';
  new TextEncoder().encode(text).forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary);
}
