/**
 * SLM Model Registry
 *
 * Hardcoded registry of small language models suitable for self-healing
 * selector resolution. These are models known to understand HTML/CSS
 * well enough to identify DOM selectors from page snapshots.
 *
 * This registry lives in SDK code (not in toolpack.config.json) because
 * it represents SDK-validated models. The user selects one of these via
 * the selfHealing.ollama.model setting in toolpack.config.json.
 */

export interface SlmModelEntry {
    /** Ollama model name (what you pass to `ollama pull`) */
    model: string;
    /** Human-readable label */
    label: string;
    /** Approximate parameter count */
    params: string;
    /** Approximate download size */
    size: string;
    /** How well this model handles HTML/CSS selector tasks (1-5) */
    selectorCapability: number;
    /** Brief description of why this model is suitable */
    description: string;
}

/**
 * Registry of SLMs validated for self-healing selector resolution.
 * Ordered by recommendation (best first).
 */
export const SLM_REGISTRY: readonly SlmModelEntry[] = [
    {
        model: 'qwen2.5-coder:3b',
        label: 'Qwen 2.5 Coder 3B',
        params: '3B',
        size: '~2GB',
        selectorCapability: 5,
        description: 'Best code understanding at small size. Excellent HTML/CSS comprehension.',
    },
    {
        model: 'phi3:mini',
        label: 'Phi-3 Mini',
        params: '3.8B',
        size: '~2.3GB',
        selectorCapability: 4,
        description: 'Strong reasoning for its size. Good at structured output.',
    },
    {
        model: 'codegemma:2b',
        label: 'CodeGemma 2B',
        params: '2B',
        size: '~1.4GB',
        selectorCapability: 4,
        description: 'Compact code model from Google. Fast inference.',
    },
    {
        model: 'deepseek-coder:1.3b',
        label: 'DeepSeek Coder 1.3B',
        params: '1.3B',
        size: '~0.8GB',
        selectorCapability: 3,
        description: 'Smallest viable option. Very fast but less accurate.',
    },
    {
        model: 'qwen2.5-coder:7b',
        label: 'Qwen 2.5 Coder 7B',
        params: '7B',
        size: '~4.5GB',
        selectorCapability: 5,
        description: 'Higher accuracy than 3B variant. Requires more RAM/VRAM.',
    },
    {
        model: 'codellama:7b',
        label: 'Code Llama 7B',
        params: '7B',
        size: '~3.8GB',
        selectorCapability: 4,
        description: 'Meta code model. Solid HTML/CSS understanding.',
    },
] as const;

/**
 * Get the default recommended SLM model for self-healing.
 */
export function getDefaultSlmModel(): string {
    return SLM_REGISTRY[0].model;
}

/**
 * Check if a model name is in the validated registry.
 */
export function isRegisteredSlm(model: string): boolean {
    const target = model.toLowerCase();
    return SLM_REGISTRY.some(
        entry => entry.model.toLowerCase() === target ||
                 entry.model.split(':')[0].toLowerCase() === target.split(':')[0].toLowerCase()
    );
}

/**
 * Get registry entry for a model, or null if not found.
 */
export function getSlmEntry(model: string): SlmModelEntry | null {
    const target = model.toLowerCase();
    return SLM_REGISTRY.find(
        entry => entry.model.toLowerCase() === target ||
                 entry.model.split(':')[0].toLowerCase() === target.split(':')[0].toLowerCase()
    ) || null;
}

/**
 * Get all registered SLM models as a simple list (for UI display).
 */
export function getRegisteredSlmModels(): SlmModelEntry[] {
    return [...SLM_REGISTRY];
}
