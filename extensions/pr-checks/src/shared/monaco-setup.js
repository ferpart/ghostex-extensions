import * as monaco from './monaco.js';

let initialized = false;

function initialize() {
  if (initialized) return;
  initialized = true;
  self.MonacoEnvironment = {
    getWorker: () => new Worker(new URL('./editor.worker.js', import.meta.url), { type: 'module' }),
  };
  monaco.editor.defineTheme('ghostex-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: { 'editor.background': '#181818', 'editorGutter.background': '#181818' },
  });
}

const prefersLight = () => window.matchMedia('(prefers-color-scheme: light)').matches;

export function languageFor(path) {
  const name = path.split('/').pop().toLowerCase();
  const extension = name.includes('.') ? `.${name.split('.').pop()}` : '';
  const match = monaco.languages
    .getLanguages()
    .find(
      (language) =>
        language.filenames?.some((candidate) => candidate.toLowerCase() === name) ||
        (extension && language.extensions?.includes(extension))
    );
  return match?.id ?? 'plaintext';
}

const baseOptions = () => ({
  theme: prefersLight() ? 'vs' : 'ghostex-dark',
  automaticLayout: true,
  glyphMargin: true,
  fontSize: 12,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  renderLineHighlight: 'line',
});

export function createFileEditor(element, { path, value, readOnly = false }) {
  initialize();
  const model = monaco.editor.createModel(value, languageFor(path));
  return monaco.editor.create(element, { ...baseOptions(), model, readOnly });
}

export function createDiffEditor(element, { path, original, modified }) {
  initialize();
  const language = languageFor(path);
  const editor = monaco.editor.createDiffEditor(element, {
    ...baseOptions(),
    readOnly: true,
    originalEditable: false,
    renderSideBySide: false,
    useInlineViewWhenSpaceIsLimited: true,
  });
  editor.setModel({
    original: monaco.editor.createModel(original, language),
    modified: monaco.editor.createModel(modified, language),
  });
  return editor;
}

export function disposeEditor(editor) {
  if (!editor) return;
  const model = editor.getModel();
  editor.dispose();
  if (model?.original) {
    model.original.dispose();
    model.modified.dispose();
  } else {
    model?.dispose();
  }
}

export { monaco };
