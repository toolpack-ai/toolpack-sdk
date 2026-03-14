import { CompletionResponse } from '../../types/index.js';

export interface PlanStep {
    /** Unique step ID */
    id: string;

    /** Step number (1-indexed) */
    number: number;

    /** Human-readable description */
    description: string;

    /** Expected tools to be used (optional, for validation) */
    expectedTools?: string[];

    /** Dependencies on other step IDs (must complete first) */
    dependsOn?: string[];

    /** Step status */
    status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';

    /** Result after completion */
    result?: {
        success: boolean;
        output?: string;
        error?: string;
        toolsUsed?: string[];
        duration?: number;
        response?: CompletionResponse; // Full CompletionResponse for metadata preservation
    };
}

export interface Plan {
    /** Unique plan ID */
    id: string;

    /** Original user request */
    request: string;

    /** Plan summary/goal */
    summary: string;

    /** Ordered steps */
    steps: PlanStep[];

    /** Plan status */
    status: 'draft' | 'approved' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

    /** Timestamps */
    createdAt: Date;
    startedAt?: Date;
    completedAt?: Date;

    /** Raw response from the planning phase */
    planningResponse?: CompletionResponse;

    /** Metrics */
    metrics?: {
        totalDuration: number;
        stepsCompleted: number;
        stepsFailed: number;
        retriesUsed: number;
    };
}
