export const SKILL_LIMITS = {
  name: 50,
  title: 100,
  tags: { count: 10, each: 30 },
  description: 300,
  triggers: { count: 10, min: 1, each: 100 },
  instructions: 5000,
  examples: 3000,
} as const;

export type SkillSection = 'description' | 'triggers' | 'instructions' | 'examples' | 'metadata' | 'all';
export type SkillValidationMode = 'fail' | 'warn';

export interface Skill {
  name: string;
  title: string;
  version?: string;
  tags: string[];
  category?: string;   // derived from subfolder name relative to root dir
  filePath: string;    // absolute path
  description: string;
  triggers: string[];
  instructions: string;
  examples?: string;
  lastModified: number; // mtime in ms
}

export interface SkillValidationError {
  file: string;        // relative path from skills dir
  errors: string[];    // fatal — skill cannot be used
  warnings: string[];  // non-fatal
}

export interface SkillSearchResult {
  skill: Skill;
  score: number;
}

export interface SkillInterceptorOptions {
  dir?: string;                        // default: '.toolpack/skills'
  maxSkills?: number;                  // default: 3
  minScore?: number;                   // default: 0.3
  onValidationError?: SkillValidationMode; // default: 'fail'
}

export interface SkillToolsOptions {
  /** Skills directory. Default: '.toolpack/skills' */
  dir?: string;
}
