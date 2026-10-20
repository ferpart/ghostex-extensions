import { run, shellQuote, waitForBridge } from './shared/bridge.js';

export async function openExternal(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error(`Refused to open ${url}: only http and https links can open.`);
  return run(`open ${shellQuote(url)} 2>/dev/null || xdg-open ${shellQuote(url)}`);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    await run(`printf %s ${shellQuote(text)} | pbcopy`);
  }
}

export function revealInFinder(path) {
  return run(`open -R ${shellQuote(path)}`);
}

export async function switchProject(path) {
  const bridge = await waitForBridge();
  const result = await bridge.cli('switch-project', ['--path', path]);
  if (result.exitCode !== 0) throw new Error((result.stderr || result.stdout || 'switch-project failed').trim());
}
