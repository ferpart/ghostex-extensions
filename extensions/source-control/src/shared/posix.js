export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function toBase64(text) {
  const bytes = typeof text === 'string' ? new TextEncoder().encode(text) : text;
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// Ghostex runs exec through the login shell (fish, zsh, ...): only base64 and quote-free text reach it.
export function posixCommand(script) {
  return `env GX_POSIX_SCRIPT=${toBase64(script)} /bin/sh -c 's=$(printf %s "$GX_POSIX_SCRIPT" | base64 -d); unset GX_POSIX_SCRIPT; eval "$s"'`;
}

const WRITE_CHUNK_BYTES = 192 * 1024;

export function writeFileCommands(path, content) {
  const bytes = new TextEncoder().encode(content);
  const temp = shellQuote(`${path}.gx-write`);
  const commands = [`: > ${temp}`];
  for (let i = 0; i < bytes.length; i += WRITE_CHUNK_BYTES) {
    commands.push(`printf %s ${toBase64(bytes.subarray(i, i + WRITE_CHUNK_BYTES))} | base64 -d >> ${temp}`);
  }
  commands.push(`cat ${temp} > ${shellQuote(path)} && rm -f ${temp}`);
  return commands;
}
