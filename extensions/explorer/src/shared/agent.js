import { waitForBridge } from './bridge.js';

export function agentSessionOf(context) {
  const session = context?.activeSession;
  return session?.kind === 'agent' ? session : null;
}

export function agentLabel(context) {
  const session = agentSessionOf(context);
  return session ? session.alias || session.title || session.agent : 'No agent session selected';
}

export async function deliverToAgent(context, text, { queue = false } = {}) {
  const session = agentSessionOf(context);
  if (!session) throw new Error('Click an agent session in the Ghostex sidebar first.');
  const bridge = await waitForBridge();
  const verb = queue ? 'queue-session-chat-prompt' : 'send-session-chat-message';
  const result = await bridge.cli(verb, [session.sessionId, text]);
  if (result.exitCode !== 0) {
    throw new Error((result.stderr || result.stdout || `${verb} failed`).trim());
  }
  return session;
}
