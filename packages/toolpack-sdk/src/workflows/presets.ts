import { WorkflowConfig } from './workflow-types.js';

/**
 * Agent planning prompt.
 * Full detailed planning for general autonomous tasks.
 */
export const AGENT_PLANNING_PROMPT = `
You are a planning assistant. Given a user request, create a detailed step-by-step plan.

Rules:
1. Break the task into clear, actionable steps
2. Each step should be independently executable WITHOUT requiring additional user input
3. Order steps by dependencies (what must happen first)
4. Be specific about what each step will accomplish
5. Estimate which tools will be needed for each step
6. If the user's request is ambiguous, make reasonable assumptions and proceed - do NOT create steps that ask for clarification
7. Steps should produce concrete outputs, not ask questions or wait for user input
8. ALWAYS include at least one step, even for simple questions. For simple factual questions, create a single step like "Provide the answer to [question]"
9. When a step uses information gathered by a previous step, set "dependsOn" to that step's number and phrase the description as "Using the [data] from step N, [do something]" instead of gathering it again
10. For plans with MORE than 2 steps, the final step must synthesize the workflow's results into a concise deliverable, avoiding redundant word-for-word repetition of earlier step outputs. For plans with 1-2 steps, no synthesis step is needed.
11. The exact result MUST be valid JSON matching this schema:
{
  "summary": "Brief description of the overall goal",
  "steps": [
    {
      "number": 1,
      "description": "What this step does",
      "expectedTools": ["tool.name"],
      "dependsOn": []
    }
  ]
}
`;


/**
 * Default workflow configuration.
 * Direct execution with no planning.
 */
export const DEFAULT_WORKFLOW: WorkflowConfig = {
    name: 'Direct',
    planning: { enabled: false },
    progress: { enabled: true },
};

/**
 * Agent workflow configuration.
 * Plan-direct: planning phase generates a structured roadmap, then executes in a single
 * generate() call with full tool parallelism. Simpler queries bypass planning via
 * complexity routing.
 */
export const AGENT_WORKFLOW: WorkflowConfig = {
    name: 'Agent',
    planning: {
        enabled: true,
        planningPrompt: AGENT_PLANNING_PROMPT,
    },
    progress: { enabled: true },
    complexityRouting: {
        enabled: true,
        strategy: 'single-step',
        confidenceThreshold: 0.6,
    },
};

/**
 * Concise planning prompt for coding tasks.
 * Minimal rules focused on actionable code changes.
 */
export const CODING_PLANNING_PROMPT = `
Create a step-by-step plan for this coding task.

Rules:
1. Break into actionable steps using tools (read/write files, search code)
2. Each step executes independently without user input
3. Order by dependencies
4. Individual steps: be concise and technical. No conversational filler.
5. For >2 steps, final step summarizes changes with conversational explanation
6. Output valid JSON: {"summary": "...", "steps": [{...}]}

JSON Schema:
{
  "summary": "Brief description of the overall goal",
  "steps": [
    {
      "number": 1,
      "description": "What this step does",
      "expectedTools": ["tool.name"],
      "dependsOn": []
    }
  ]
}
`;


/**
 * Coding workflow configuration.
 * Plan-direct: planning phase generates a structured roadmap using concise coding-focused prompts,
 * then executes in a single generate() call with full tool parallelism.
 */
export const CODING_WORKFLOW: WorkflowConfig = {
    name: 'Coding',
    planning: {
        enabled: true,
        planningPrompt: CODING_PLANNING_PROMPT,
    },
    progress: { enabled: true },
    complexityRouting: {
        enabled: true,
        strategy: 'single-step',
        confidenceThreshold: 0.6,
    },
};

/**
 * Chat workflow configuration.
 * Direct conversational responses — no planning.
 */
export const CHAT_WORKFLOW: WorkflowConfig = {
    name: 'Chat',
    planning: { enabled: false },
    progress: { enabled: false },
};
