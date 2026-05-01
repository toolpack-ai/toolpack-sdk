/**
 * A participant in a conversation — a human user, another agent, or the
 * system itself. Stored alongside each `StoredMessage` so the prompt
 * assembler can reconstruct who said what without extra lookups.
 */
export interface Participant {
  /** Coarse participant kind */
  kind: 'system' | 'user' | 'agent';

  /** Stable identifier for this participant (platform-specific id or agent name) */
  id: string;

  /** Human-readable display name, resolved lazily. Falls back to `id` if unset. */
  displayName?: string;

  /** For `kind: 'agent'` only: an optional role label for rendering */
  agentType?: string;

  /** Optional free-form metadata (e.g. platform-specific profile info) */
  metadata?: Record<string, unknown>;
}
