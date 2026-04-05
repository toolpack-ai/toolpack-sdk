/**
 * Query Classifier for Tool Orchestration
 * 
 * Classifies user queries into analytical, action, or conversational types
 * to optimize tool execution strategy (e.g., adjust maxToolRounds).
 */

export type QueryType = 'analytical' | 'action' | 'conversational';

export interface QueryClassification {
    type: QueryType;
    confidence: number;
    reasoning?: string;
}

export class QueryClassifier {
    private analyticalPatterns: RegExp[] = [
        // Exploration & discovery
        /\b(analyze|find|search|check|list|show)\b/i,
        /\b(biggest|largest|smallest|most|least|all|every|count)\b/i,
        /\b(explain|understand|review|audit|inspect|examine)\b/i,
        /\b(compare|difference|similar|match|pattern)\b/i,
        // Questions
        /\b(what|where|how many|which|who|when|why|how)\b/i,
        /\?$/,  // Ends with question mark
    ];

    private actionPatterns: RegExp[] = [
        // File operations
        /\b(create|write|update|modify|edit|patch|delete|remove|rename|move|copy)\b/i,
        // Execution commands
        /\b(run|execute|start|stop|restart|deploy|install|build)\b/i,
        // Code changes
        /\b(fix|refactor|implement|add|change|replace|insert)\b/i,
        // Imperative verbs
        /\b(make|do|set|configure|setup|initialize)\b/i,
    ];

    /**
     * Classify a user query based on pattern matching.
     * Returns the query type and confidence score.
     */
    classify(userMessage: string): QueryClassification {
        if (!userMessage || userMessage.trim().length === 0) {
            return { type: 'conversational', confidence: 0.0 };
        }

        const text = userMessage.toLowerCase();

        // Count pattern matches
        const analyticalScore = this.analyticalPatterns.filter(p => p.test(text)).length;
        const actionScore = this.actionPatterns.filter(p => p.test(text)).length;

        // Calculate confidence (normalized by pattern count)
        const analyticalConfidence = analyticalScore / this.analyticalPatterns.length;
        const actionConfidence = actionScore / this.actionPatterns.length;

        // Determine type based on scores
        if (analyticalScore > actionScore && analyticalScore > 0) {
            let confidence = Math.min(analyticalConfidence, 1.0);
            // Guard: Cap confidence if action patterns also fired to prevent false routing
            // of queries like "analyze this code and fix all the bugs"
            if (actionScore > 0) {
                confidence = Math.min(confidence, 0.5);
            }
            return {
                type: 'analytical',
                confidence,
                reasoning: `Matched ${analyticalScore} analytical patterns${actionScore > 0 ? `, ${actionScore} action patterns (capped confidence)` : ''}`,
            };
        } else if (actionScore > analyticalScore && actionScore > 0) {
            return {
                type: 'action',
                confidence: Math.min(actionConfidence, 1.0),
                reasoning: `Matched ${actionScore} action patterns`,
            };
        } else if (analyticalScore === actionScore && analyticalScore > 0) {
            // Mixed query - prefer analytical for safety (more exploration)
            return {
                type: 'analytical',
                confidence: 0.5,
                reasoning: `Mixed query (${analyticalScore} analytical, ${actionScore} action patterns)`,
            };
        } else {
            // No clear patterns - conversational
            return {
                type: 'conversational',
                confidence: 0.3,
                reasoning: 'No strong analytical or action patterns detected',
            };
        }
    }

    /**
     * Get recommended maxToolRounds adjustment based on query type.
     * Returns a multiplier or bonus rounds.
     */
    getToolRoundsAdjustment(classification: QueryClassification, baseRounds: number): number {
        if (classification.type === 'analytical' && classification.confidence > 0.6) {
            // Analytical queries benefit from deeper exploration
            return Math.min(baseRounds + 3, 10);
        } else if (classification.type === 'action' && classification.confidence > 0.6) {
            // Action queries are usually focused - keep default
            return baseRounds;
        } else {
            // Conversational or low confidence - keep default
            return baseRounds;
        }
    }
}
