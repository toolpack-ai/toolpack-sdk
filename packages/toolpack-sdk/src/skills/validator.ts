import type { Skill, SkillValidationError } from './types.js';
import { SKILL_LIMITS } from './types.js';

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * Validate a parsed Skill against SKILL_LIMITS.
 * Returns a SkillValidationError with errors (fatal) and warnings (non-fatal).
 */
export function validateSkill(skill: Skill, relativeFile: string): SkillValidationError {
  const errors: string[] = [];
  const warnings: string[] = [];

  // name: required, kebab-case, max 50 chars
  if (!skill.name) {
    errors.push('name is required in frontmatter');
  } else {
    if (!NAME_PATTERN.test(skill.name)) {
      errors.push(`name "${skill.name}" must match kebab-case pattern /^[a-z][a-z0-9-]*$/`);
    }
    if (skill.name.length > SKILL_LIMITS.name) {
      warnings.push(`name exceeds ${SKILL_LIMITS.name} character limit (${skill.name.length} chars)`);
    }
  }

  // title: required, max 100 chars
  if (!skill.title) {
    errors.push('title is required in frontmatter');
  } else if (skill.title.length > SKILL_LIMITS.title) {
    warnings.push(`title exceeds ${SKILL_LIMITS.title} character limit (${skill.title.length} chars)`);
  }

  // tags: max 10, each max 30 chars
  if (skill.tags.length > SKILL_LIMITS.tags.count) {
    warnings.push(`too many tags (${skill.tags.length}); maximum is ${SKILL_LIMITS.tags.count}`);
  }
  for (const tag of skill.tags) {
    if (tag.length > SKILL_LIMITS.tags.each) {
      warnings.push(`tag "${tag}" exceeds ${SKILL_LIMITS.tags.each} character limit`);
    }
  }

  // description: required, max 300 chars
  if (!skill.description) {
    errors.push('## Description section is required and must not be empty');
  } else if (skill.description.length > SKILL_LIMITS.description) {
    warnings.push(`description exceeds ${SKILL_LIMITS.description} character limit (${skill.description.length} chars)`);
  }

  // triggers: required, min 1, max 10, each max 100 chars
  if (!skill.triggers || skill.triggers.length === 0) {
    errors.push('## Triggers section must contain at least one trigger');
  } else {
    if (skill.triggers.length < 3) {
      warnings.push(
        `only ${skill.triggers.length} trigger(s) defined; add more variations (synonyms, short forms, longer phrases) so BM25 can match a wider range of user phrasings — aim for at least 3`,
      );
    }
    if (skill.triggers.length > SKILL_LIMITS.triggers.count) {
      warnings.push(`too many triggers (${skill.triggers.length}); maximum is ${SKILL_LIMITS.triggers.count}`);
    }
    for (const trigger of skill.triggers) {
      if (trigger.length > SKILL_LIMITS.triggers.each) {
        warnings.push(`trigger "${trigger.substring(0, 50)}..." exceeds ${SKILL_LIMITS.triggers.each} character limit`);
      }
    }
  }

  // instructions: required, max 5000 chars
  if (!skill.instructions) {
    errors.push('## Instructions section is required and must not be empty');
  } else if (skill.instructions.length > SKILL_LIMITS.instructions) {
    warnings.push(`instructions exceed ${SKILL_LIMITS.instructions} character limit (${skill.instructions.length} chars)`);
  }

  // examples: if present, max 3000 chars
  if (skill.examples && skill.examples.length > SKILL_LIMITS.examples) {
    warnings.push(`examples exceed ${SKILL_LIMITS.examples} character limit (${skill.examples.length} chars)`);
  }

  return { file: relativeFile, errors, warnings };
}
