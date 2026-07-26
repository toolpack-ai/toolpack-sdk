import * as fs from 'fs/promises';
import * as path from 'path';
import type { ToolDefinition, ToolProject } from '../types.js';
import type { SkillToolsOptions } from '../../skills/types.js';

export type { SkillToolsOptions };

// ── Inline helpers (no cross-package import needed) ────────────────────────

function parseFrontmatter(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match || !match[1]) return result;

  for (const line of match[1].split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const key = line.substring(0, colonIndex).trim();
    const value = line.substring(colonIndex + 1).trim();
    result[key] = value;
  }
  return result;
}

function parseTags(tagValue: string): string[] {
  const m = tagValue.match(/\[(.*)\]/);
  if (!m || !m[1]) return [];
  return m[1].split(',').map(t => t.trim().replace(/"/g, '')).filter(Boolean);
}

function parseTriggers(content: string): string[] {
  const triggers: string[] = [];
  const match = content.match(/## Triggers\n\n([\s\S]*?)(?=\n## |$)/);
  if (!match || !match[1]) return triggers;
  for (const line of match[1].split('\n').filter(l => l.startsWith('- '))) {
    const m = line.match(/^- "(.*)"/);
    if (m && m[1]) triggers.push(m[1]);
  }
  return triggers;
}

function parseSection(content: string, section: string): string {
  const match = content.match(new RegExp(`## ${section}\\n\\n([\\s\\S]*?)(?=\\n## |$)`));
  return match && match[1] ? match[1].trim() : '';
}

async function findSkillFile(dir: string, name: string): Promise<string | null> {
  async function scan(d: string): Promise<string | null> {
    let names: string[];
    try {
      names = await fs.readdir(d);
    } catch {
      return null;
    }
    for (const entryName of names) {
      const fullPath = path.join(d, entryName);
      let stat: Awaited<ReturnType<typeof fs.stat>>;
      try {
        stat = await fs.stat(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        const found = await scan(fullPath);
        if (found) return found;
      } else if (stat.isFile() && entryName === `${name}.skill.md`) {
        return fullPath;
      }
    }
    return null;
  }
  return scan(dir);
}

async function findAllSkillFiles(dir: string): Promise<string[]> {
  const result: string[] = [];
  async function scan(d: string): Promise<void> {
    let names: string[];
    try {
      names = await fs.readdir(d);
    } catch {
      return;
    }
    for (const entryName of names) {
      const fullPath = path.join(d, entryName);
      let stat: Awaited<ReturnType<typeof fs.stat>>;
      try {
        stat = await fs.stat(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        await scan(fullPath);
      } else if (stat.isFile() && entryName.endsWith('.skill.md')) {
        result.push(fullPath);
      }
    }
  }
  await scan(dir);
  return result;
}

function buildSkillContent(params: {
  name: string;
  title: string;
  description: string;
  triggers: string[];
  instructions: string;
  examples?: string;
  tags?: string[];
}): string {
  const { name, title, description, triggers, instructions, examples, tags } = params;
  const now = new Date().toISOString();
  const tagList = tags && tags.length > 0 ? tags.map(t => `"${t}"`).join(', ') : '';

  const lines: string[] = [
    '---',
    `name: ${name}`,
    `title: ${title}`,
    `version: 1.0.0`,
    `updated: ${now}`,
    `tags: [${tagList}]`,
    '---',
    '',
    '## Description',
    '',
    description,
    '',
    '## Triggers',
    '',
    triggers.map(t => `- "${t}"`).join('\n'),
    '',
    '## Instructions',
    '',
    instructions,
    '',
  ];

  if (examples) {
    lines.push('## Examples', '', examples, '');
  }

  return lines.join('\n');
}

// ── Tool: skill.create ──────────────────────────────────────────────────────

function makeSkillCreateTool(dir: string): ToolDefinition {
  return {
    name: 'skill.create',
    displayName: 'Create Skill',
    description: 'Create a new .skill.md file in the skill library.',
    category: 'skills',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Skill name in kebab-case (e.g. "code-review"). Used as the filename.',
        },
        title: {
          type: 'string',
          description: 'Human-readable title for the skill (max 100 chars).',
        },
        description: {
          type: 'string',
          description: 'Short description for BM25 search indexing (max 300 chars).',
        },
        triggers: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of trigger phrases that activate this skill (min 1, max 10).',
        },
        instructions: {
          type: 'string',
          description: 'Behavioral instructions injected into context when the skill activates (max 2000 chars).',
        },
        examples: {
          type: 'string',
          description: 'Optional examples section (max 3000 chars, never auto-injected).',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for filtering and search (max 10).',
        },
        subfolder: {
          type: 'string',
          description: 'Optional subfolder within the skills directory (e.g. "coding").',
        },
      },
      required: ['name', 'title', 'description', 'triggers', 'instructions'],
    },
    async execute(args) {
      const name = args['name'] as string;
      const title = args['title'] as string;
      const description = args['description'] as string;
      const triggers = (args['triggers'] as string[]) ?? [];
      const instructions = args['instructions'] as string;
      const examples = args['examples'] as string | undefined;
      const tags = (args['tags'] as string[]) ?? [];
      const subfolder = args['subfolder'] as string | undefined;

      if (!/^[a-z][a-z0-9-]*$/.test(name)) {
        return JSON.stringify({
          error: 'invalid_name',
          message: 'Skill name must be kebab-case (lowercase letters, numbers, hyphens, starting with a letter)',
        }, null, 2);
      }

      const targetDir = subfolder ? path.join(dir, subfolder) : dir;
      await fs.mkdir(targetDir, { recursive: true });

      const skillPath = path.join(targetDir, `${name}.skill.md`);

      try {
        await fs.access(skillPath);
        return JSON.stringify({
          error: 'skill_exists',
          message: `Skill "${name}" already exists at ${skillPath}. Use skill.update to modify it.`,
        }, null, 2);
      } catch {
        // File does not exist — continue
      }

      const content = buildSkillContent({ name, title, description, triggers, instructions, examples, tags });
      await fs.writeFile(skillPath, content, 'utf-8');

      return JSON.stringify({
        success: true,
        skill: name,
        path: skillPath,
        message: `Skill "${title}" created successfully`,
      }, null, 2);
    },
  };
}

// ── Tool: skill.read ───────────────────────────────────────────────────────

function makeSkillReadTool(dir: string): ToolDefinition {
  return {
    name: 'skill.read',
    displayName: 'Read Skill',
    description: 'Read a skill file by name. Optionally read only a specific section.',
    category: 'skills',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Skill name (without the .skill.md extension).',
        },
        section: {
          type: 'string',
          enum: ['all', 'metadata', 'description', 'triggers', 'instructions', 'examples'],
          description: 'Which section to return (default: all).',
          default: 'all',
        },
      },
      required: ['name'],
    },
    async execute(args) {
      const name = args['name'] as string;
      const section = (args['section'] as string) || 'all';

      const skillPath = await findSkillFile(dir, name);
      if (!skillPath) {
        return JSON.stringify({
          error: 'skill_not_found',
          message: `Skill "${name}" not found. Use skill.list to see available skills.`,
        }, null, 2);
      }

      const content = (await fs.readFile(skillPath, 'utf-8')).replace(/\r\n/g, '\n');
      const fm = parseFrontmatter(content);

      const metadata = {
        name: fm['name'] || name,
        title: fm['title'] || name,
        version: fm['version'],
        tags: fm['tags'] ? parseTags(fm['tags']) : [],
        updated: fm['updated'],
        path: skillPath,
      };

      if (section === 'metadata') {
        return JSON.stringify({ skill: name, metadata }, null, 2);
      }
      if (section === 'description') {
        return JSON.stringify({ skill: name, description: parseSection(content, 'Description') }, null, 2);
      }
      if (section === 'triggers') {
        return JSON.stringify({ skill: name, triggers: parseTriggers(content) }, null, 2);
      }
      if (section === 'instructions') {
        return JSON.stringify({ skill: name, instructions: parseSection(content, 'Instructions') }, null, 2);
      }
      if (section === 'examples') {
        return JSON.stringify({ skill: name, examples: parseSection(content, 'Examples') }, null, 2);
      }

      // all
      return JSON.stringify({
        skill: name,
        path: skillPath,
        metadata,
        description: parseSection(content, 'Description'),
        triggers: parseTriggers(content),
        instructions: parseSection(content, 'Instructions'),
        examples: parseSection(content, 'Examples') || undefined,
      }, null, 2);
    },
  };
}

// ── Tool: skill.update ─────────────────────────────────────────────────────

function makeSkillUpdateTool(dir: string): ToolDefinition {
  return {
    name: 'skill.update',
    displayName: 'Update Skill',
    description: 'Update fields of an existing skill. Only provided fields are changed.',
    category: 'skills',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Skill name to update.',
        },
        title: {
          type: 'string',
          description: 'New title (optional).',
        },
        description: {
          type: 'string',
          description: 'New description replacing the existing one (optional).',
        },
        triggers: {
          type: 'array',
          items: { type: 'string' },
          description: 'New triggers list replacing the existing one (optional).',
        },
        instructions: {
          type: 'string',
          description: 'New instructions replacing the existing ones (optional).',
        },
        addExamples: {
          type: 'string',
          description: 'Additional examples text to append to the Examples section (optional).',
        },
        addTags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags to add to the existing tags (optional).',
        },
      },
      required: ['name'],
    },
    async execute(args) {
      const skillName = args['name'] as string;
      const newTitle = args['title'] as string | undefined;
      const newDescription = args['description'] as string | undefined;
      const newTriggers = args['triggers'] as string[] | undefined;
      const newInstructions = args['instructions'] as string | undefined;
      const addExamples = args['addExamples'] as string | undefined;
      const addTags = args['addTags'] as string[] | undefined;

      const skillPath = await findSkillFile(dir, skillName);
      if (!skillPath) {
        return JSON.stringify({
          error: 'skill_not_found',
          message: `Skill "${skillName}" not found. Use skill.create to create it first.`,
        }, null, 2);
      }

      let content = (await fs.readFile(skillPath, 'utf-8')).replace(/\r\n/g, '\n');
      const fm = parseFrontmatter(content);

      const existingTags = fm['tags'] ? parseTags(fm['tags']) : [];
      const existingTitle = fm['title'] || skillName;
      const existingVersion = fm['version'] || '1.0.0';

      const finalTitle = newTitle ?? existingTitle;
      const finalTags = addTags ? [...new Set([...existingTags, ...addTags])] : existingTags;
      const now = new Date().toISOString();

      // Update description section
      if (newDescription !== undefined) {
        content = content.replace(
          /## Description\n\n[\s\S]*?(?=\n## )/,
          `## Description\n\n${newDescription}\n\n`,
        );
      }

      // Replace triggers section
      if (newTriggers !== undefined) {
        const triggersContent = newTriggers.map(t => `- "${t}"`).join('\n');
        content = content.replace(
          /## Triggers\n\n[\s\S]*?(?=\n## )/,
          `## Triggers\n\n${triggersContent}\n\n`,
        );
      }

      // Replace instructions section
      if (newInstructions !== undefined) {
        content = content.replace(
          /## Instructions\n\n[\s\S]*?(?=\n## |$)/,
          `## Instructions\n\n${newInstructions}\n\n`,
        );
      }

      // Append to examples section
      if (addExamples) {
        const examplesMatch = content.match(/## Examples\n\n([\s\S]*?)(?=\n## |$)/);
        if (examplesMatch) {
          const existing = examplesMatch[1] ?? '';
          const separator = existing.trim() ? '\n\n' : '';
          content = content.replace(
            /## Examples\n\n[\s\S]*?(?=\n## |$)/,
            `## Examples\n\n${existing}${separator}${addExamples}\n\n`,
          );
        } else {
          // Append a new examples section at the end
          content = content.trimEnd() + `\n\n## Examples\n\n${addExamples}\n`;
        }
      }

      // Rebuild frontmatter
      content = content.replace(
        /^---\n[\s\S]*?\n---/,
        [
          '---',
          `name: ${skillName}`,
          `title: ${finalTitle}`,
          `version: ${existingVersion}`,
          `updated: ${now}`,
          `tags: [${finalTags.map(t => `"${t}"`).join(', ')}]`,
          '---',
        ].join('\n'),
      );

      await fs.writeFile(skillPath, content, 'utf-8');

      const updated: string[] = [];
      if (newTitle) updated.push('title');
      if (newDescription !== undefined) updated.push('description');
      if (newTriggers !== undefined) updated.push('triggers');
      if (newInstructions !== undefined) updated.push('instructions');
      if (addExamples) updated.push('examples (appended)');
      if (addTags) updated.push(`tags (+${addTags.length})`);

      return JSON.stringify({
        success: true,
        skill: skillName,
        path: skillPath,
        updated,
        message: `Skill "${skillName}" updated successfully`,
      }, null, 2);
    },
  };
}

// ── Tool: skill.list ───────────────────────────────────────────────────────

function makeSkillListTool(dir: string): ToolDefinition {
  return {
    name: 'skill.list',
    displayName: 'List Skills',
    description: 'List all skills in the skill library, optionally filtered by tag.',
    category: 'skills',
    parameters: {
      type: 'object',
      properties: {
        tag: {
          type: 'string',
          description: 'Filter skills by tag (optional).',
        },
        verbose: {
          type: 'boolean',
          description: 'Include description and triggers in the output (default: false).',
          default: false,
        },
      },
      required: [],
    },
    async execute(args) {
      const filterTag = args['tag'] as string | undefined;
      const verbose = (args['verbose'] as boolean) ?? false;

      try {
        await fs.access(dir);
      } catch {
        return JSON.stringify({
          skills: [],
          count: 0,
          message: 'No skills directory found. Use skill.create to create your first skill.',
        }, null, 2);
      }

      const filePaths = await findAllSkillFiles(dir);

      if (filePaths.length === 0) {
        return JSON.stringify({
          skills: [],
          count: 0,
          message: 'No skills found. Use skill.create to create your first skill.',
        }, null, 2);
      }

      const skills: Array<{
        name: string;
        title: string;
        tags?: string[];
        category?: string;
        description?: string;
        triggers?: string[];
      }> = [];

      for (const filePath of filePaths) {
        const content = (await fs.readFile(filePath, 'utf-8')).replace(/\r\n/g, '\n');
        const fm = parseFrontmatter(content);

        const name = fm['name'] || path.basename(filePath, '.skill.md');
        const title = fm['title'] || name;
        const tags = fm['tags'] ? parseTags(fm['tags']) : [];

        if (filterTag && !tags.includes(filterTag)) continue;

        const relDir = path.dirname(path.relative(dir, filePath));
        const category = relDir === '.' ? undefined : relDir.split(path.sep)[0];

        if (verbose) {
          skills.push({
            name,
            title,
            tags,
            category,
            description: parseSection(content, 'Description') || undefined,
            triggers: parseTriggers(content),
          });
        } else {
          skills.push({ name, title });
        }
      }

      return JSON.stringify({
        skills,
        count: skills.length,
        filtered: filterTag ? `by tag: ${filterTag}` : null,
      }, null, 2);
    },
  };
}

// ── Factory function ───────────────────────────────────────────────────────

/**
 * Creates a ToolProject with 4 skill management tools: create, read, update, list.
 *
 * @example
 * ```ts
 * const skillTools = createSkillTools({ dir: '.toolpack/skills' });
 * ```
 */
export function createSkillTools(options?: SkillToolsOptions): ToolProject {
  const dir = path.resolve(options?.dir ?? '.toolpack/skills');

  const tools: ToolDefinition[] = [
    makeSkillCreateTool(dir),
    makeSkillReadTool(dir),
    makeSkillUpdateTool(dir),
    makeSkillListTool(dir),
  ];

  return {
    manifest: {
      key: 'skill',
      name: 'skill-tools',
      displayName: 'Skill Management',
      version: '1.0.0',
      description: 'Tools for creating, reading, updating, and listing agent skill files.',
      tools: ['skill.create', 'skill.read', 'skill.update', 'skill.list'],
      category: 'skills',
    },
    tools,
  };
}
