const ICON_BY_NAME = {
  dockerfile: 'gear',
  makefile: 'terminal',
  license: 'book',
  codeowners: 'book',
  '.gitignore': 'gear',
  '.dockerignore': 'gear',
  '.editorconfig': 'gear',
  'package-lock.json': 'lock',
  'yarn.lock': 'lock',
};

const ICON_BY_EXTENSION = {
  md: 'markdown', mdx: 'markdown',
  json: 'json', jsonc: 'json',
  js: 'file-code', mjs: 'file-code', cjs: 'file-code', jsx: 'file-code', ts: 'file-code', tsx: 'file-code',
  py: 'file-code', go: 'file-code', rs: 'file-code', java: 'file-code', kt: 'file-code', swift: 'file-code',
  rb: 'file-code', php: 'file-code', c: 'file-code', h: 'file-code', cpp: 'file-code', cs: 'file-code',
  css: 'file-code', scss: 'file-code', html: 'file-code', vue: 'file-code', svelte: 'file-code',
  tf: 'file-code', hcl: 'file-code', lua: 'file-code', zig: 'file-code',
  sh: 'terminal', bash: 'terminal', zsh: 'terminal', fish: 'terminal',
  yml: 'gear', yaml: 'gear', toml: 'gear', ini: 'gear', conf: 'gear', xml: 'gear',
  lock: 'lock', pem: 'lock', key: 'lock',
  sql: 'database', db: 'database', sqlite: 'database',
  png: 'file-media', jpg: 'file-media', jpeg: 'file-media', gif: 'file-media', webp: 'file-media', svg: 'file-media', ico: 'file-media',
  mp4: 'file-media', mov: 'file-media', mp3: 'file-media', wav: 'file-media', ttf: 'file-media', woff: 'file-media', woff2: 'file-media',
  zip: 'file-zip', gz: 'file-zip', tgz: 'file-zip', tar: 'file-zip', '7z': 'file-zip',
  pdf: 'file-pdf',
  exe: 'file-binary', bin: 'file-binary', wasm: 'file-binary', so: 'file-binary', dylib: 'file-binary',
  txt: 'file-text', log: 'file-text', csv: 'file-text',
};

export function fileIcon(path) {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  if (ICON_BY_NAME[name]) return ICON_BY_NAME[name];
  if (name === '.env' || name.startsWith('.env.')) return 'lock';
  if (name.startsWith('dockerfile')) return 'gear';
  const dot = name.lastIndexOf('.');
  return (dot > 0 && ICON_BY_EXTENSION[name.slice(dot + 1)]) || 'file';
}

export function Icon({ name, title }) {
  return <i class={`codicon codicon-${name}`} title={title} aria-hidden={title ? undefined : 'true'} />;
}
