/**
 * Types for the toolpack-agents registry.
 * Used for discovering and publishing community agents.
 */

/**
 * Metadata that should be included in a package.json to identify
 * a package as a toolpack agent.
 *
 * @example
 * ```json
 * {
 *   "name": "toolpack-agent-fintech-research",
 *   "version": "1.0.0",
 *   "keywords": ["toolpack-agent"],
 *   "toolpack": {
 *     "agent": true,
 *     "category": "research",
 *     "description": "Research agent focused on fintech news and regulatory updates",
 *     "tags": ["fintech", "research", "news"],
 *     "author": "John Doe",
 *     "repository": "https://github.com/johndoe/toolpack-agent-fintech-research",
 *     "homepage": "https://example.com/fintech-agent"
 *   }
 * }
 * ```
 */
export interface ToolpackAgentMetadata {
  /** Must be true to be recognized as an agent */
  agent: true;

  /** Category for grouping (e.g., 'research', 'coding', 'data', 'custom') */
  category?: string;

  /** Short description of what the agent does */
  description?: string;

  /** Tags for searchability */
  tags?: string[];

  /** Author name or organization */
  author?: string;

  /** Repository URL */
  repository?: string;

  /** Homepage URL */
  homepage?: string;
}

/**
 * An agent entry returned from the registry search.
 */
export interface RegistryAgent {
  /** Package name */
  name: string;

  /** Package version */
  version: string;

  /** Package description from npm */
  description?: string;

  /** Toolpack-specific metadata */
  toolpack?: ToolpackAgentMetadata;

  /** NPM keywords */
  keywords?: string[];

  /** Package author */
  author?: string | { name?: string; email?: string };

  /** NPM registry date */
  date?: string;

  /** NPM registry links */
  links?: {
    npm?: string;
    homepage?: string;
    repository?: string;
    bugs?: string;
  };

  /** NPM registry publisher info */
  publisher?: {
    username?: string;
    email?: string;
  };

  /** NPM maintainers */
  maintainers?: Array<{
    username?: string;
    email?: string;
  }>;
}

/**
 * Options for searching the registry.
 */
export interface SearchRegistryOptions {
  /** Search query string */
  keyword?: string;

  /** Filter by category */
  category?: string;

  /** Filter by tag */
  tag?: string;

  /** Maximum number of results (default: 20) */
  limit?: number;

  /** Offset for pagination (default: 0) */
  offset?: number;

  /** NPM registry URL (default: https://registry.npmjs.org) */
  registryUrl?: string;
}

/**
 * Result from a registry search.
 */
export interface SearchRegistryResult {
  /** List of matching agents */
  agents: RegistryAgent[];

  /** Total number of results (may be approximate) */
  total: number;

  /** Offset used for this query */
  offset: number;

  /** Limit used for this query */
  limit: number;

  /** Whether more results are available */
  hasMore: boolean;
}
