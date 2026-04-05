import { Plan, PlanStep } from './planning/plan-types.js';
import { CompletionResponse } from '../types/index.js';

export interface WorkflowConfig {
    /**
     * Workflow name for display purposes.
     */
    name?: string;
    /**
     * Planning phase configuration.
     * If enabled, AI generates a plan before executing.
     */
    planning?: {
        /** Enable planning phase. Default: false */
        enabled: boolean;

        /** Pause for user approval before executing plan. Default: false */
        requireApproval?: boolean;

        /** Custom system prompt for plan generation. */
        planningPrompt?: string;

        /** Maximum number of steps allowed in a plan. Default: 20 */
        maxSteps?: number;
    };

    /**
     * Step-based execution configuration.
     * If enabled, tasks are broken into steps and executed sequentially.
     */
    steps?: {
        /** Enable step-based execution. Default: false */
        enabled: boolean;

        /** Retry failed steps. Default: true */
        retryOnFailure?: boolean;

        /** Maximum retry attempts per step. Default: 3 */
        maxRetries?: number;

        /** Allow adding/modifying steps during execution. Default: true */
        allowDynamicSteps?: boolean;

        /** Maximum total steps (including dynamic). Default: 50 */
        maxTotalSteps?: number;

        /** Custom step execution prompt. Default: uses built-in STEP_EXECUTION_PROMPT */
        stepPrompt?: string;
    };

    /**
     * Progress reporting configuration.
     */
    progress?: {
        /** Emit progress events. Default: true */
        enabled: boolean;

        /** Report estimated completion percentage. Default: true */
        reportPercentage?: boolean;
    };

    /**
     * Failure handling configuration.
     */
    onFailure?: {
        /** Strategy when a step fails after all retries. Default: 'abort' */
        strategy: 'abort' | 'skip' | 'ask_user';
    };

    /**
     * Query complexity routing configuration.
     * Routes simple queries to faster execution paths based on query classification.
     */
    complexityRouting?: {
        /** Enable complexity-based routing. Default: false (opt-in) */
        enabled: boolean;

        /** Routing strategy for simple queries. Default: 'single-step' */
        strategy: 'single-step' | 'bypass' | 'disabled';

        /** Confidence threshold for routing analytical queries. Default: 0.6 */
        confidenceThreshold?: number;
    };
}

/**
 * Default workflow config (direct execution, no planning/steps).
 */
export const DEFAULT_WORKFLOW_CONFIG: WorkflowConfig = {
    planning: { enabled: false },
    steps: { enabled: false },
    progress: { enabled: true },
};

export interface WorkflowEvents {
    /** Emitted when a plan is created (before approval if required) */
    'workflow:plan_created': (plan: Plan) => void;

    /** Emitted when user approves/rejects a plan */
    'workflow:plan_decision': (plan: Plan, approved: boolean) => void;

    /** Emitted when plan execution starts */
    'workflow:started': (plan: Plan) => void;

    /** Emitted when a step starts */
    'workflow:step_start': (step: PlanStep, plan: Plan) => void;

    /** Emitted when a step completes successfully */
    'workflow:step_complete': (step: PlanStep, plan: Plan) => void;

    /** Emitted when a step fails */
    'workflow:step_failed': (step: PlanStep, error: Error, plan: Plan) => void;

    /** Emitted when a step is retried */
    'workflow:step_retry': (step: PlanStep, attempt: number, plan: Plan) => void;

    /** Emitted when a new step is dynamically added */
    'workflow:step_added': (step: PlanStep, plan: Plan) => void;

    /** Emitted for progress updates */
    'workflow:progress': (progress: WorkflowProgress) => void;

    /** Emitted when workflow completes */
    'workflow:completed': (plan: Plan, result: WorkflowResult) => void;

    /** Emitted when workflow fails */
    'workflow:failed': (plan: Plan, error: Error) => void;
}

export interface WorkflowProgress {
    planId: string;
    currentStep: number;
    totalSteps: number;
    percentage: number;
    currentStepDescription: string;
    status: 'planning' | 'awaiting_approval' | 'executing' | 'completed' | 'failed';
}

export interface WorkflowResult {
    success: boolean;
    plan: Plan;
    output?: string;
    error?: string;
    response?: CompletionResponse; // Full CompletionResponse from last step
    metrics: {
        totalDuration: number;
        stepsCompleted: number;
        stepsFailed: number;
        retriesUsed: number;
    };
}
