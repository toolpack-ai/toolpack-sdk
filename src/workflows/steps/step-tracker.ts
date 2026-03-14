import { Plan, PlanStep } from '../planning/plan-types.js';
import { WorkflowProgress } from '../workflow-types.js';

export class StepTracker {
    /**
     * Compute current progress of the plan.
     */
    static getProgress(plan: Plan): WorkflowProgress {
        const totalSteps = plan.steps.length;

        // Find first non-completed step
        let currentStepIdx = plan.steps.findIndex((s: PlanStep) => s.status !== 'completed' && s.status !== 'skipped');
        if (currentStepIdx === -1) {
            currentStepIdx = totalSteps; // All done
        }

        const percentage = totalSteps > 0
            ? Math.round((currentStepIdx / totalSteps) * 100)
            : 0;

        const currentStep = plan.steps[currentStepIdx];
        const currentStepDescription = currentStep ? currentStep.description : 'Done';

        let status: WorkflowProgress['status'] = 'executing';
        if (plan.status === 'draft') status = 'planning';
        if (plan.status === 'approved') status = 'executing';
        if (plan.status === 'completed') status = 'completed';
        if (plan.status === 'failed' || plan.status === 'cancelled') status = 'failed';

        return {
            planId: plan.id,
            currentStep: Math.min(currentStepIdx + 1, totalSteps), // 1-indexed for display, capped at totalSteps
            totalSteps,
            percentage,
            currentStepDescription,
            status,
        };
    }

    /**
     * Build a text summary of previously completed steps.
     * Used to inject context into the prompt for the next step without overflowing the context window.
     */
    static summarizeCompletedSteps(plan: Plan, upToStepId: string): string {
        const completed = [];

        for (const step of plan.steps) {
            if (step.id === upToStepId) break;

            if (step.status === 'completed' && step.result) {
                const tools = step.result.toolsUsed?.length
                    ? ` (Tools: ${step.result.toolsUsed.join(', ')})`
                    : '';

                // Truncate output to keep it reasonable
                let output = step.result.output || 'No output';
                if (output.length > 500) {
                    output = output.substring(0, 500) + '... [truncated]';
                }

                completed.push(`Step ${step.number}: ${step.description}${tools}\nResult: ${output}`);
            } else if (step.status === 'failed') {
                completed.push(`Step ${step.number}: ${step.description}\nFailed: ${step.result?.error || 'Unknown error'}`);
            } else if (step.status === 'skipped') {
                completed.push(`Step ${step.number}: ${step.description}\nSkipped.`);
            }
        }

        if (completed.length === 0) {
            return 'No previous steps.';
        }

        return completed.join('\n\n');
    }
}
