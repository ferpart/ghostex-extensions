import { getCodiconFontCharacters } from '../../node_modules/monaco-editor/esm/vs/base/common/codiconsUtil.js';

// Monaco adds the codicon glyph CSS only when the first editor mounts.
export function enableCodicons() {
  const style = document.createElement('style');
  style.textContent = Object.entries(getCodiconFontCharacters())
    .map(([id, code]) => `.codicon-${id}::before { content: '\\${code.toString(16)}'; }`)
    .join('\n');
  document.head.append(style);
}
