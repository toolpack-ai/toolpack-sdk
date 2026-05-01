import type { Toolpack } from 'toolpack-sdk';

export interface DelegationSpec {
  to: string;
  message: string;
}

export interface ScriptEntry {
  match: RegExp | string;
  reply: string;
  delegations?: DelegationSpec[];
}

type AgentScripts = Record<string, ScriptEntry[]>;

/**
 * A Toolpack.generate-compatible mock that returns deterministic responses
 * per agent name and message pattern. Used exclusively by TestAgent.
 */
export class ScriptedLLM {
  private scripts: AgentScripts;

  constructor(scripts: AgentScripts) {
    this.scripts = scripts;
  }

  getEntry(agentName: string, message: string): ScriptEntry | undefined {
    const entries = this.scripts[agentName];
    if (!entries) return undefined;
    for (const entry of entries) {
      const hit =
        typeof entry.match === 'string'
          ? message.includes(entry.match)
          : entry.match.test(message);
      if (hit) return entry;
    }
    return undefined;
  }

  /** Returns a Toolpack.generate-compatible function bound to agentName. */
  makeGenerate(agentName: string): Toolpack['generate'] {
    return async (request: unknown) => {
      const req = request as { messages: Array<{ role: string; content: string }> };
      const lastUser = [...req.messages].reverse().find(m => m.role === 'user');
      const message = lastUser?.content ?? '';
      const entry = this.getEntry(agentName, message);
      return {
        content: entry?.reply ?? `[${agentName}] no script matched: "${message.slice(0, 60)}"`,
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
    };
  }

  /** Build a minimal Toolpack mock for the given agent. */
  makeToolpack(agentName: string): Toolpack {
    const generate = this.makeGenerate(agentName);
    return {
      generate,
      setMode: () => {},
      registerMode: () => {},
      setProvider: () => {},
      setModel: () => {},
    } as unknown as Toolpack;
  }
}
