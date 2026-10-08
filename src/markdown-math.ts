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

/** Use CommonMark tokens and their original offsets; never serialize the surrounding Markdown. */
export async function parseMarkdownMath(markdown: string): Promise<{ spans: MathSpan[]; hasHtml: boolean }> {
  const [{ parse, preprocess, postprocess }, { math }, { gfm }] = await Promise.all([
    import(/* webpackMode: "eager", webpackExports: ["parse", "preprocess", "postprocess"] */ 'micromark'),
    import(/* webpackMode: "eager", webpackExports: ["math"] */ 'micromark-extension-math'),
    import(/* webpackMode: "eager", webpackExports: ["gfm"] */ 'micromark-extension-gfm'),
  ]);
  const extension = math();
  // Failed delimiter matches rewind the tokenizer. Bound the total lookahead so repeated
  // unclosed equations cannot make parsing quadratic in the description's length.
  const budget = { remaining: markdown.length * 4 };
  const tokenize = (effects: Effects, ok: State, nok: State): State => tokenizeMath(effects, ok, nok, budget);
  // Retain the library's container-aware display fences, but use Pandoc dollar rules for inline math.
  extension.text = { 36: { tokenize }, 92: { tokenize } };
  const events = postprocess(
    parse({ extensions: [gfm(), extension] })
      .document()
      .write(preprocess()(markdown, undefined, true))
  );
  const spans: MathSpan[] = [];
  let hasHtml = false;
  let inImage = 0;
  for (let i = 0; i < events.length; i++) {
    const [kind, token, context] = events[i];
    if (token.type === 'image') inImage += kind === 'enter' ? 1 : -1;
    if (kind !== 'enter' || inImage) continue;
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
      tex: tex.trim(),
      display,
      block: display && before === prefix && !after.trim(),
      prefix: prefix.replace(/[-+*]|\d+[.)]/g, (marker) => ' '.repeat(marker.length)),
    });
  }
  return { spans, hasHtml };
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
