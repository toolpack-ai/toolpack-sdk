import type { ToolpackInterceptor, ToolpackNextFunction } from '../interceptors/types.js';
import type { CompletionRequest, CompletionResponse } from '../providers/base/index.js';
import type { SkillInterceptorOptions } from './types.js';
import { SkillIndexManager } from './index-manager.js';

export type { SkillInterceptorOptions };

export function createSkillInterceptor(options?: SkillInterceptorOptions): ToolpackInterceptor {
  const dir = options?.dir ?? '.toolpack/skills';
  const maxSkills = options?.maxSkills ?? 3;
  const minScore = options?.minScore ?? 0.3;
  const onValidationError = options?.onValidationError ?? 'fail';

  const manager = new SkillIndexManager({ dir, onValidationError });

  return Object.assign(
    async (request: CompletionRequest, next: ToolpackNextFunction): Promise<CompletionResponse> => {
      const messages = request.messages ?? [];

      // Find the last user message index (needed for the array-content system prompt fallback)
      let lastUserIdx = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') { lastUserIdx = i; break; }
      }

      // Build BM25 query from the last 3 user messages — short follow-ups like "performance?"
      // gain meaning from earlier turns in the same thread.
      const query = messages
        .filter(m => m.role === 'user' && typeof m.content === 'string')
        .slice(-3)
        .map(m => (m.content as string).trim())
        .filter(Boolean)
        .join(' ');

      if (query) {
        const results = await manager.search(query, maxSkills, minScore);
        if (results.length > 0) {
          const blocks = results
            .map(r => `--- Skill: ${r.skill.title} ---\n${r.skill.instructions.trim()}\n---`)
            .join('\n\n');
          const injected = `<skill-instructions>\n${blocks}\n</skill-instructions>`;

          const systemIdx = messages.findIndex(m => m.role === 'system');
          let newMessages: typeof messages;

          if (systemIdx >= 0 && typeof messages[systemIdx].content === 'string') {
            // Append to existing string system prompt
            newMessages = messages.map((m, i) =>
              i === systemIdx ? { ...m, content: `${m.content}\n\n${injected}` } : m
            );
          } else if (systemIdx < 0) {
            // No system message — create one at position 0
            newMessages = [{ role: 'system', content: injected }, ...messages];
          } else {
            // System message has non-string content (rare) — fall back to user message
            newMessages = messages.map((m, i) =>
              i === lastUserIdx && typeof m.content === 'string'
                ? { ...m, content: `${injected}\n\n${m.content}` }
                : m
            );
          }

          return next({ ...request, messages: newMessages });
        }
      }

      return next(request);
    },
    {
      /** Eagerly validate all skill files at Toolpack.init() time. */
      init: () => manager.ensureLoaded(),
    },
  );
}
