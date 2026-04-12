import type {
  RegistryAgent,
  SearchRegistryOptions,
  SearchRegistryResult,
  ToolpackAgentMetadata,
} from './types.js';

/**
 * NPM registry search response format.
 */
interface NpmSearchResponse {
  objects: Array<{
    package: {
      name: string;
      version: string;
      description?: string;
      keywords?: string[];
      date?: string;
      links?: {
        npm?: string;
        homepage?: string;
        repository?: string;
        bugs?: string;
      };
      publisher?: {
        username?: string;
        email?: string;
      };
      maintainers?: Array<{
        username?: string;
        email?: string;
      }>;
      author?: string | { name?: string; email?: string };
      [key: string]: unknown;
    };
    score?: {
      final?: number;
      detail?: {
        quality?: number;
        popularity?: number;
        maintenance?: number;
      };
    };
    searchScore?: number;
  }>;
  total: number;
  time?: string;
}

/**
 * Searches the NPM registry for toolpack agents.
 *
 * Queries packages with the "toolpack-agent" keyword and filters
 * by optional category, tags, and search keywords.
 *
 * @example
 * ```ts
 * import { searchRegistry } from '@toolpack-sdk/agents/registry';
 *
 * // Search all agents
 * const results = await searchRegistry();
 *
 * // Search by keyword
 * const results = await searchRegistry({ keyword: 'fintech' });
 *
 * // Filter by category
 * const results = await searchRegistry({ category: 'research' });
 *
 * // Combined search
 * const results = await searchRegistry({
 *   keyword: 'stock',
 *   category: 'research',
 *   limit: 10,
 * });
 *
 * // Display results
 * for (const agent of results.agents) {
 *   console.log(`${agent.name}: ${agent.toolpack?.description || agent.description}`);
 *   console.log(`  Install: npm install ${agent.name}`);
 * }
 * ```
 *
 * @param options Search options
 * @returns Search results with agents and pagination info
 */
export async function searchRegistry(
  options: SearchRegistryOptions = {}
): Promise<SearchRegistryResult> {
  const {
    keyword,
    category,
    tag,
    limit = 20,
    offset = 0,
    registryUrl = 'https://registry.npmjs.org',
  } = options;

  // Build search query - always include toolpack-agent keyword
  const searchTerms: string[] = ['toolpack-agent'];
  if (keyword) {
    searchTerms.push(keyword);
  }
  if (tag) {
    searchTerms.push(tag);
  }

  const query = searchTerms.join(' ');

  // Build the NPM registry search URL
  // NPM search API: /-/v1/search?text=...&size=...&from=...
  const searchUrl = new URL('/-/v1/search', registryUrl);
  searchUrl.searchParams.set('text', query);
  searchUrl.searchParams.set('size', String(Math.min(limit + offset, 250))); // NPM max is 250
  searchUrl.searchParams.set('from', String(0)); // We'll handle offset in memory for filtering

  try {
    const response = await fetch(searchUrl.toString(), {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new RegistryError(
        `NPM registry search failed: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as NpmSearchResponse;

    // Transform and filter results
    let agents: RegistryAgent[] = data.objects.map(obj => {
      const pkg = obj.package;
      const toolpack = extractToolpackMetadata(pkg);

      return {
        name: pkg.name,
        version: pkg.version,
        description: pkg.description,
        toolpack,
        keywords: pkg.keywords,
        author: pkg.author,
        date: pkg.date,
        links: pkg.links,
        publisher: pkg.publisher,
        maintainers: pkg.maintainers,
      };
    });

    // Filter by category if specified
    if (category) {
      agents = agents.filter(
        agent => agent.toolpack?.category?.toLowerCase() === category.toLowerCase()
      );
    }

    // Filter by tag if specified
    if (tag) {
      const tagLower = tag.toLowerCase();
      agents = agents.filter(
        agent =>
          agent.toolpack?.tags?.some(t => t.toLowerCase() === tagLower) ||
          agent.keywords?.some(k => k.toLowerCase() === tagLower)
      );
    }

    // Only include packages with toolpack.agent = true
    agents = agents.filter(agent => agent.toolpack?.agent === true);

    // Apply offset and limit
    const total = agents.length;
    agents = agents.slice(offset, offset + limit);

    return {
      agents,
      total,
      offset,
      limit,
      hasMore: total > offset + limit,
    };
  } catch (error) {
    if (error instanceof RegistryError) {
      throw error;
    }
    throw new RegistryError(
      `Failed to search registry: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Extracts toolpack metadata from package.json data.
 */
function extractToolpackMetadata(pkg: Record<string, unknown>): ToolpackAgentMetadata | undefined {
  const toolpack = pkg.toolpack as Record<string, unknown> | undefined;

  if (!toolpack || toolpack.agent !== true) {
    return undefined;
  }

  return {
    agent: true,
    category: typeof toolpack.category === 'string' ? toolpack.category : undefined,
    description: typeof toolpack.description === 'string' ? toolpack.description : undefined,
    tags: Array.isArray(toolpack.tags)
      ? toolpack.tags.filter((t): t is string => typeof t === 'string')
      : undefined,
    author: typeof toolpack.author === 'string' ? toolpack.author : undefined,
    repository: typeof toolpack.repository === 'string' ? toolpack.repository : undefined,
    homepage: typeof toolpack.homepage === 'string' ? toolpack.homepage : undefined,
  };
}

/**
 * Error thrown when registry operations fail.
 */
export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryError';
  }
}
