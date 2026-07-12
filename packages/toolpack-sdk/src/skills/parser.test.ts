import { describe, it, expect } from 'vitest';
import { parseSkillFile } from './parser.js';

const ROOT = '/skills';

function make(frontmatter: string, body = ''): string {
  return `---\n${frontmatter}\n---\n\n## Description\n\nA test skill.\n\n## Triggers\n\n- "test trigger"\n\n## Instructions\n\nDo the thing.${body}`;
}

describe('parseSkillFile — tags parsing', () => {
  it('parses inline array with double quotes', () => {
    const skill = parseSkillFile(
      make('name: my-skill\ntitle: My Skill\ntags: ["coding", "quality"]'),
      `${ROOT}/my-skill.skill.md`,
      ROOT,
    );
    expect(skill.tags).toEqual(['coding', 'quality']);
  });

  it('parses inline array without quotes', () => {
    const skill = parseSkillFile(
      make('name: my-skill\ntitle: My Skill\ntags: [coding, quality, review]'),
      `${ROOT}/my-skill.skill.md`,
      ROOT,
    );
    expect(skill.tags).toEqual(['coding', 'quality', 'review']);
  });

  it('parses inline array with single quotes', () => {
    const skill = parseSkillFile(
      make("name: my-skill\ntitle: My Skill\ntags: ['coding', 'quality']"),
      `${ROOT}/my-skill.skill.md`,
      ROOT,
    );
    expect(skill.tags).toEqual(['coding', 'quality']);
  });

  it('parses YAML block-list tags', () => {
    const skill = parseSkillFile(
      make('name: my-skill\ntitle: My Skill\ntags:\n  - coding\n  - quality\n  - review'),
      `${ROOT}/my-skill.skill.md`,
      ROOT,
    );
    expect(skill.tags).toEqual(['coding', 'quality', 'review']);
  });

  it('parses block-list tags with quoted values', () => {
    const skill = parseSkillFile(
      make('name: my-skill\ntitle: My Skill\ntags:\n  - "coding"\n  - "quality"'),
      `${ROOT}/my-skill.skill.md`,
      ROOT,
    );
    expect(skill.tags).toEqual(['coding', 'quality']);
  });

  it('returns empty tags when tags field is absent', () => {
    const skill = parseSkillFile(
      make('name: my-skill\ntitle: My Skill'),
      `${ROOT}/my-skill.skill.md`,
      ROOT,
    );
    expect(skill.tags).toEqual([]);
  });

  it('returns empty tags for empty inline array', () => {
    const skill = parseSkillFile(
      make('name: my-skill\ntitle: My Skill\ntags: []'),
      `${ROOT}/my-skill.skill.md`,
      ROOT,
    );
    expect(skill.tags).toEqual([]);
  });

  it('block-list does not bleed into the next frontmatter key', () => {
    // version comes after the block-list tags — must still be parsed
    const skill = parseSkillFile(
      make('name: my-skill\ntitle: My Skill\ntags:\n  - coding\nversion: 1.2.0'),
      `${ROOT}/my-skill.skill.md`,
      ROOT,
    );
    expect(skill.tags).toEqual(['coding']);
    expect(skill.version).toBe('1.2.0');
  });
});

describe('parseSkillFile — other fields', () => {
  it('derives name from filename when frontmatter name is absent', () => {
    const skill = parseSkillFile(
      make('title: My Skill'),
      `${ROOT}/code-review.skill.md`,
      ROOT,
    );
    expect(skill.name).toBe('code-review');
  });

  it('parses version', () => {
    const skill = parseSkillFile(
      make('name: my-skill\ntitle: My Skill\nversion: 2.0.0'),
      `${ROOT}/my-skill.skill.md`,
      ROOT,
    );
    expect(skill.version).toBe('2.0.0');
  });

  it('derives category from subfolder', () => {
    const skill = parseSkillFile(
      make('name: my-skill\ntitle: My Skill'),
      `${ROOT}/coding/my-skill.skill.md`,
      ROOT,
    );
    expect(skill.category).toBe('coding');
  });

  it('sets category to undefined when file is at root', () => {
    const skill = parseSkillFile(
      make('name: my-skill\ntitle: My Skill'),
      `${ROOT}/my-skill.skill.md`,
      ROOT,
    );
    expect(skill.category).toBeUndefined();
  });

  it('parses instructions section', () => {
    const skill = parseSkillFile(
      make('name: my-skill\ntitle: My Skill'),
      `${ROOT}/my-skill.skill.md`,
      ROOT,
    );
    expect(skill.instructions).toBe('Do the thing.');
  });

  it('parses examples section when present', () => {
    const content = make('name: my-skill\ntitle: My Skill', '\n\n## Examples\n\nExample content here.');
    const skill = parseSkillFile(content, `${ROOT}/my-skill.skill.md`, ROOT);
    expect(skill.examples).toBe('Example content here.');
  });

  it('leaves examples undefined when section is absent', () => {
    const skill = parseSkillFile(
      make('name: my-skill\ntitle: My Skill'),
      `${ROOT}/my-skill.skill.md`,
      ROOT,
    );
    expect(skill.examples).toBeUndefined();
  });
});
