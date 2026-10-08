/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Red Hat, Inc. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { mathjax } from '@mathjax/src/js/mathjax.js';
import { TeX } from '@mathjax/src/js/input/tex.js';
import { SVG } from '@mathjax/src/js/output/svg.js';
import { MathJaxMhchemFontExtension } from '@mathjax/mathjax-mhchem-font-extension/js/svg.js';
import { MathJaxTexFont } from '@mathjax/mathjax-tex-font/js/svg.js';
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js';
import '@mathjax/src/js/input/tex/base/BaseConfiguration.js';
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js';
import '@mathjax/src/js/input/tex/amscd/AmsCdConfiguration.js';
import '@mathjax/src/js/input/tex/boldsymbol/BoldsymbolConfiguration.js';
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js';
import '@mathjax/src/js/input/tex/configmacros/ConfigMacrosConfiguration.js';
import '@mathjax/src/js/input/tex/mathtools/MathtoolsConfiguration.js';
import '@mathjax/src/js/input/tex/cases/CasesConfiguration.js';
import '@mathjax/src/js/input/tex/empheq/EmpheqConfiguration.js';
import '@mathjax/src/js/input/tex/cancel/CancelConfiguration.js';
import '@mathjax/src/js/input/tex/color/ColorConfiguration.js';
import '@mathjax/src/js/input/tex/bbox/BboxConfiguration.js';
import '@mathjax/src/js/input/tex/enclose/EncloseConfiguration.js';
import '@mathjax/src/js/input/tex/extpfeil/ExtpfeilConfiguration.js';
import '@mathjax/src/js/input/tex/unicode/UnicodeConfiguration.js';
import '@mathjax/src/js/input/tex/upgreek/UpgreekConfiguration.js';
import '@mathjax/src/js/input/tex/textmacros/TextMacrosConfiguration.js';
import '@mathjax/src/js/input/tex/textcomp/TextcompConfiguration.js';
import '@mathjax/src/js/input/tex/gensymb/GensymbConfiguration.js';
import '@mathjax/src/js/input/tex/physics/PhysicsConfiguration.js';
import '@mathjax/src/js/input/tex/mhchem/MhchemConfiguration.js';

const PACKAGES = [
  'base',
  'ams',
  'amscd',
  'boldsymbol',
  'newcommand',
  'configmacros',
  'mathtools',
  'cases',
  'empheq',
  'cancel',
  'color',
  'bbox',
  'enclose',
  'extpfeil',
  'unicode',
  'upgreek',
  'textmacros',
  'textcomp',
  'gensymb',
  'physics',
  'mhchem',
];

MathJaxTexFont.addExtension(MathJaxMhchemFontExtension);

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

/** A session belongs to one description: labels and user macros never cross hover boundaries. */
export function createMathRenderer(): (tex: string, display: boolean) => string {
  const document = mathjax.document('', {
    InputJax: new TeX({
      // An explicit, offline package set. Autoload and require need MathJax's component loader.
      packages: PACKAGES,
      maxMacros: 1000,
      maxBuffer: 16 * 1024,
      formatError: (_jax: unknown, error: Error) => {
        throw error;
      },
    }),
    OutputJax: new SVG({
      fontData: MathJaxTexFont,
      // Each SVG contains its own glyph definitions, including those reused by <use> elements.
      fontCache: 'local',
      localID: 'hover',
    }),
  });
  return (tex, display) => adaptor.innerHTML(document.convert(tex, { display }));
}
