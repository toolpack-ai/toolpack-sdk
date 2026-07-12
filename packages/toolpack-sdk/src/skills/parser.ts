import * as path from 'path';
import type { Skill } from './types.js';

/**
 * Parse a .skill.md file from its string content and absolute file path.
 * Returns a Skill object. Category is derived from subfolder between rootDir and file.
 */
export function parseSkillFile(content: string, filePath: string, rootDir: string): Skill {
  // Parse frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

  let name = '';
  let title = '';
  let version: string | undefined;
  let tags: string[] = [];

  if (frontmatterMatch && frontmatterMatch[1]) {
    const lines = frontmatterMatch[1].split('\n');
    let parsingTagsList = false;

    for (const line of lines) {
      // Collect block-list tag items (e.g. "  - coding") before the colon check
      // that would otherwise skip them (they have no colon).
      if (parsingTagsList) {
        const listItem = line.match(/^\s+-\s+(.+?)\s*$/);
        if (listItem) {
          tags.push(listItem[1].replace(/^["']|["']$/g, ''));
          continue;
        }
        parsingTagsList = false;
      }

      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;

      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();

      if (key === 'name') name = value;
      if (key === 'title') title = value;
      if (key === 'version') version = value;
      if (key === 'tags') {
        if (value) {
          // Inline array: tags: ["coding", "quality"] or tags: [coding, quality]
          // Use [^\]]* (non-greedy-safe) instead of .* to avoid overshooting on
          // tags that somehow contain a ] character.
          const tagsMatch = value.match(/\[([^\]]*)\]/);
          if (tagsMatch) {
            tags = tagsMatch[1]
              .split(',')
              .map(t => t.trim().replace(/^["']|["']$/g, ''))
              .filter(Boolean);
          }
        } else {
          // Block list — collect subsequent indented "- value" lines.
          parsingTagsList = true;
          tags = [];
        }
      }
    }
  }

  // Derive name from filename if missing
  if (!name) {
    name = path.basename(filePath, '.skill.md');
  }

  // Parse description section
  const descMatch = content.match(/## Description\n\n([\s\S]*?)(?=\n## |$)/);
  const description = descMatch && descMatch[1] ? descMatch[1].trim() : '';

  // Parse triggers section — lines starting with `- "..."`
  const triggersMatch = content.match(/## Triggers\n\n([\s\S]*?)(?=\n## |$)/);
  const triggers: string[] = [];
  if (triggersMatch && triggersMatch[1]) {
    const triggerLines = triggersMatch[1].split('\n').filter(l => l.startsWith('- '));
    for (const line of triggerLines) {
      const match = line.match(/^- "(.*)"/);
      if (match && match[1]) {
        triggers.push(match[1]);
      }
    }
  }

  // Parse instructions section
  const instructionsMatch = content.match(/## Instructions\n\n([\s\S]*?)(?=\n## |$)/);
  const instructions = instructionsMatch && instructionsMatch[1] ? instructionsMatch[1].trim() : '';

  // Parse examples section (optional)
  const examplesMatch = content.match(/## Examples\n\n([\s\S]*?)(?=\n## |$)/);
  const examples = examplesMatch && examplesMatch[1] ? examplesMatch[1].trim() : undefined;

  // Derive category from subfolder between rootDir and file
  const relPath = path.relative(rootDir, filePath);
  const relDir = path.dirname(relPath);
  const category = relDir === '.' ? undefined : relDir.split(path.sep)[0];

  return {
    name,
    title,
    version,
    tags,
    category,
    filePath,
    description,
    triggers,
    instructions,
    examples: examples || undefined,
    lastModified: 0, // caller must set this from file stat
  };
}
