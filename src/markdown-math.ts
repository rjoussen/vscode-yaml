/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Red Hat, Inc. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// The subset of micromark's tokenizer API used by the delimiter extension below.
type Code = number | null;
type State = (code: Code) => State | undefined;
type MathToken = 'mathText' | 'mathTextSequence' | 'mathTextData' | 'lineEnding';
interface Effects {
  enter(type: MathToken): unknown;
  exit(type: MathToken): unknown;
  consume(code: Code): void;
}

export interface MathSpan {
  start: number;
  end: number;
  tex: string;
  display: boolean;
  /** Continuation prefix for display equations inside lists and blockquotes. */
  prefix: string;
  block: boolean;
}

// The subset of micromark's events read by `findMath` below.
interface Token {
  type: string;
  start: { offset: number };
  end: { offset: number };
}
type Event = ['enter' | 'exit', Token, { sliceSerialize(token: Pick<Token, 'start' | 'end'>): string }];

interface Paragraph {
  start: number;
  end: number;
  /** Whether the text is escaped like a plain `description`, see `isEscapedPlainText`. */
  plain: boolean;
}

/** Use CommonMark tokens and their original offsets; never serialize the surrounding Markdown. */
export async function parseMarkdownMath(markdown: string): Promise<{ spans: MathSpan[]; hasHtml: boolean }> {
  const [{ parse, preprocess, postprocess }, { math }, { gfm }] = await Promise.all([
    import(/* webpackMode: "eager", webpackExports: ["parse", "preprocess", "postprocess"] */ 'micromark'),
    import(/* webpackMode: "eager", webpackExports: ["math"] */ 'micromark-extension-math'),
    import(/* webpackMode: "eager", webpackExports: ["gfm"] */ 'micromark-extension-gfm'),
  ]);
  const tokenize = (brackets: boolean): Event[] => {
    const extension = math();
    // Failed delimiter matches rewind the tokenizer. Bound the total lookahead so repeated
    // unclosed equations cannot make parsing quadratic in the description's length.
    const budget = { remaining: markdown.length * 4 };
    const construct = { tokenize: (effects: Effects, ok: State, nok: State): State => tokenizeMath(effects, ok, nok, budget) };
    // Retain the library's container-aware display fences, but use Pandoc dollar rules for inline math.
    extension.text = brackets ? { 36: construct, 92: construct } : { 36: construct };
    return postprocess(
      parse({ extensions: [gfm(), extension] })
        .document()
        .write(preprocess()(markdown, undefined, true))
    );
  };
  const result = findMath(markdown, tokenize(true));
  // Plain `description` text escapes every parenthesis and bracket, so `\(` and `\[` cannot open math there.
  const plain = result.paragraphs.filter((paragraph) => paragraph.plain);
  const inPlain = (span: MathSpan): boolean => plain.some(({ start, end }) => span.start >= start && span.end <= end);
  if (!result.spans.some((span) => inPlain(span) && markdown[span.start] === '\\')) {
    return { spans: result.spans, hasHtml: result.hasHtml };
  }
  const dollars = findMath(markdown, tokenize(false));
  const spans = [...result.spans.filter((span) => !inPlain(span)), ...dollars.spans.filter(inPlain)];
  return { spans: spans.sort((a, b) => a.start - b.start), hasHtml: result.hasHtml };
}

function findMath(markdown: string, events: Event[]): { spans: MathSpan[]; hasHtml: boolean; paragraphs: Paragraph[] } {
  const spans: MathSpan[] = [];
  const paragraphs: Paragraph[] = [];
  const code: { start: number; end: number }[] = [];
  let hasHtml = false;
  let inImage = 0;
  for (let i = 0; i < events.length; i++) {
    const [kind, token, context] = events[i];
    if (token.type === 'image') inImage += kind === 'enter' ? 1 : -1;
    if (kind !== 'enter') continue;
    if (/^(paragraph|atxHeadingText|setextHeadingText)$/.test(token.type)) {
      paragraphs.push({ start: token.start.offset, end: token.end.offset, plain: false });
    }
    if (token.type === 'codeText') code.push({ start: token.start.offset, end: token.end.offset });
    if (inImage) continue;
    if (token.type === 'htmlText' || token.type === 'htmlFlow') hasHtml = true;
    if (token.type !== 'mathText' && token.type !== 'mathFlow') continue;
    const start = token.start.offset;
    const end = token.end.offset;
    const source = context.sliceSerialize(token);
    let tex: string;
    let display: boolean;
    if (token.type === 'mathFlow') {
      const values: string[] = [];
      let fences = 0;
      for (let j = i + 1; j < events.length && events[j][1] !== token; j++) {
        const [action, child, childContext] = events[j];
        if (action !== 'enter') continue;
        if (child.type === 'mathFlowFenceSequence') fences++;
        if (child.type === 'mathFlowValue') values.push(childContext.sliceSerialize(child));
      }
      // Unclosed fences and fence metadata are not equations.
      if (fences !== 2 || !/^\${2,}[ \t]*\r?\n/.test(source)) continue;
      tex = values.join('\n');
      display = true;
    } else {
      display = source.startsWith('$$') || source.startsWith('\\[');
      const delimiter = source.startsWith('$') && !display ? 1 : 2;
      tex = source.slice(delimiter, -delimiter);
    }
    if (!tex.trim()) continue;
    const before = markdown.slice(markdown.lastIndexOf('\n', start - 1) + 1, start);
    const prefix = /^(?:[ \t]*>[ \t]?)*[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?/.exec(before)[0];
    const after = markdown.slice(end, markdown.indexOf('\n', end) < 0 ? markdown.length : markdown.indexOf('\n', end));
    spans.push({
      start,
      end,
      tex: unescapePlainTex(tex.trim()),
      display,
      block: display && before === prefix && !after.trim(),
      prefix: prefix.replace(/[-+*]|\d+[.)]/g, (marker) => ' '.repeat(marker.length)),
    });
  }
  for (const paragraph of paragraphs) {
    let text = '';
    let offset = paragraph.start;
    for (const span of code.filter(({ start, end }) => start >= paragraph.start && end <= paragraph.end)) {
      text += markdown.slice(offset, span.start);
      offset = span.end;
    }
    paragraph.plain = isEscapedPlainText(text + markdown.slice(offset, paragraph.end));
  }
  return { spans, hasHtml, paragraphs };
}

// The characters that the YAML language server escapes when it converts a plain `description` to Markdown.
const PLAIN_ESCAPES = '\\`*_{}[]()#+-.!';

/** Whether the text could have been produced by escaping plain text, i.e. all its Markdown punctuation is escaped. */
export function isEscapedPlainText(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') {
      if (!PLAIN_ESCAPES.includes(text[++i] ?? 'x')) return false;
    } else if (PLAIN_ESCAPES.includes(text[i])) {
      return false;
    }
  }
  return true;
}

/**
 * Recovers the TeX of an equation in an escaped plain `description`. Escaped braces alone stay as they are,
 * since `\\{1, 2\\}` is also the TeX for a set.
 */
export function unescapePlainTex(tex: string): string {
  const unescaped = tex.replace(/&emsp;/g, ' ');
  if (!isEscapedPlainText(unescaped) || !/\\[^{}]/.test(unescaped)) return unescaped;
  return unescaped.replace(/\\(.)/g, '$1');
}

/** Consume TeX before Markdown can interpret its underscores, brackets, or asterisks. */
function tokenizeMath(effects: Effects, ok: State, nok: State, budget: { remaining: number }): State {
  let dollar = false;
  let display = false;
  let escaped = false;
  let braces = 0;
  let length = 0;
  let last: Code;
  let inData = false;
  return start;

  function endData(): void {
    if (inData) effects.exit('mathTextData');
    inData = false;
  }
  function start(code: Code): State | undefined {
    dollar = code === 36;
    effects.enter('mathText');
    effects.enter('mathTextSequence');
    effects.consume(code);
    return opening;
  }
  function opening(code: Code): State | undefined {
    if (dollar && code !== 36) {
      if (space(code)) return nok(code);
      effects.exit('mathTextSequence');
      return content(code);
    }
    if (!dollar && code !== 40 && code !== 91) return nok(code);
    display = dollar || code === 91;
    effects.consume(code);
    effects.exit('mathTextSequence');
    return content;
  }
  function content(code: Code): State | undefined {
    if (--budget.remaining < 0 || code === null || (!display && code < -2) || ++length > 16 * 1024) return nok(code);
    if (code < -2) {
      endData();
      effects.enter('lineEnding');
      effects.consume(code);
      effects.exit('lineEnding');
      last = code;
      return content;
    }
    if (!escaped) {
      if (dollar && code === 36 && braces === 0) {
        // A dollar after whitespace cannot close inline math; retry it as a later opener.
        if (!display && space(last)) return nok(code);
        endData();
        effects.enter('mathTextSequence');
        effects.consume(code);
        return display ? closingDollar : after;
      }
      if (!dollar && code === 92) {
        endData();
        effects.enter('mathTextSequence');
        effects.consume(code);
        return closingBracket;
      }
      if (code === 123) braces++;
      if (code === 125) braces = Math.max(0, braces - 1);
    }
    escaped = !escaped && code === 92;
    last = code;
    if (!inData) effects.enter('mathTextData');
    inData = true;
    effects.consume(code);
    return content;
  }
  function closingDollar(code: Code): State | undefined {
    if (code !== 36) {
      effects.exit('mathTextSequence');
      return content(code);
    }
    effects.consume(code);
    return after;
  }
  function closingBracket(code: Code): State | undefined {
    if (code === (display ? 93 : 41) && braces === 0) {
      effects.consume(code);
      return after;
    }
    effects.exit('mathTextSequence');
    escaped = true;
    return content(code);
  }
  function after(code: Code): State | undefined {
    if (dollar && !display && code !== null && code >= 48 && code <= 57) return nok(code);
    effects.exit('mathTextSequence');
    effects.exit('mathText');
    return ok(code);
  }
}

function space(code: Code): boolean {
  return code === null || code < 0 || code === 32;
}
