import { useEffect, useState } from 'preact/hooks';

const BRIDGE_POLL_MS = 25;
const BRIDGE_TIMEOUT_MS = 8000;

export function waitForBridge() {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (window.ghostex?.__bridgeVersion === 1) return resolve(window.ghostex);
      if (Date.now() - started > BRIDGE_TIMEOUT_MS) {
        return reject(new Error('The Ghostex extension bridge is unavailable. Open this page inside Ghostex.'));
      }
      setTimeout(poll, BRIDGE_POLL_MS);
    };
    poll();
  });
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function projectPathOf(context) {
  return context?.project?.path || null;
}

export async function run(command, { cwd, allowedExitCodes = [0] } = {}) {
  const bridge = await waitForBridge();
  const result = await bridge.exec(command, { cwd });
  if (!allowedExitCodes.includes(result.exitCode)) {
    const details = (result.stderr || result.stdout || 'no output').trim();
    throw new Error(`${command.split('\n')[0]} failed (exit ${result.exitCode}): ${details}`);
  }
  return result.stdout;
}

export async function runJson(command, options) {
  return JSON.parse(await run(command, options));
}

export async function writeFile(path, content, { cwd } = {}) {
  const bytes = new TextEncoder().encode(content);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const encoded = btoa(binary);
  await run(`printf %s ${shellQuote(encoded)} | base64 -d > ${shellQuote(path)}`, { cwd });
}

export async function toast(message) {
  const bridge = await waitForBridge();
  await bridge.ui.toast(String(message));
}

export function useGhostexContext() {
  const [state, setState] = useState({ bridge: null, context: null, error: null });
  useEffect(() => {
    let unsubscribe = () => {};
    waitForBridge()
      .then(async (bridge) => {
        setState({ bridge, context: await bridge.context(), error: null });
        unsubscribe = bridge.onContextChange((context) => setState((prev) => ({ ...prev, context })));
      })
      .catch((error) => setState({ bridge: null, context: null, error }));
    return () => unsubscribe();
  }, []);
  return state;
}
