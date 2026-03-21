/**
 * SLM Self-Healer
 *
 * Uses a local Ollama SLM to intelligently resolve CSS selectors
 * from a compressed DOM snapshot when all pattern-based layers fail.
 *
 * This is Layer 5 in the selector resolution engine.
 * Framework-agnostic — no UI dependencies.
 */

import http from 'http';
import { logError, logWarn, logInfo, logDebug } from '../provider-logger';

export type HealerRole = 'input' | 'submit' | 'response';

export interface SlmHealerConfig {
    /** Whether SLM self-healing is enabled */
    enabled: boolean;
    /** Ollama model to use */
    model: string;
    /** Base URL for Ollama. Default: http://localhost:11434 */
    baseUrl?: string;
}

export interface SlmHealResult {
    selector: string;
    confidence: number;
    reasoning: string;
}

// ============================================================================
// DOM Compression
// ============================================================================

/**
 * Compress a raw HTML string into a minimal structural representation
 * optimized for SLM selector identification.
 *
 * Strategy:
 * 1. Remove <head>, scripts, styles, SVGs, comments
 * 2. Remove nav, sidebar, header, footer elements (not the chat area)
 * 3. Strip text content — keep only DOM structure + selector-relevant attributes
 * 4. Remove irrelevant attributes (keep id, class, role, aria-*, data-testid, placeholder, type, contenteditable)
 * 5. Focus on <main> or primary content area if available
 */
export function compressDom(html: string, maxLength: number = 12000): string {
    let compressed = html;

    // Phase 1: Remove entire blocks that are never useful
    compressed = compressed
        .replace(/<head[\s\S]*?<\/head>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<svg[\s\S]*?<\/svg>/gi, '<svg/>')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<link[^>]*>/gi, '')
        .replace(/<meta[^>]*>/gi, '');

    // Phase 2: Remove nav/sidebar/header/footer blocks (unlikely to contain chat messages)
    compressed = compressed
        .replace(/<nav[\s\S]*?<\/nav>/gi, '<!-- nav -->')
        .replace(/<footer[\s\S]*?<\/footer>/gi, '<!-- footer -->');

    // Phase 3: Remove irrelevant attributes (keep only selector-relevant ones)
    compressed = compressed.replace(/\s*style="[^"]*"/gi, '');
    compressed = compressed.replace(/\s*data-(?!testid)[a-z-]+="[^"]*"/gi, '');
    compressed = compressed.replace(/\s*on[a-z]+="[^"]*"/gi, '');
    compressed = compressed.replace(/\s*tabindex="[^"]*"/gi, '');
    compressed = compressed.replace(/\s*draggable="[^"]*"/gi, '');

    // Phase 4: Truncate long text content between tags (keep first 30 chars as context)
    compressed = compressed.replace(/>([^<]{40,})</g, (_, text) => {
        return '>' + text.substring(0, 30).trim() + '...<';
    });

    // Phase 5: Collapse whitespace
    compressed = compressed.replace(/\s+/g, ' ').trim();

    // Phase 6: Try to extract just the <main> or primary content area
    const mainMatch = compressed.match(/<main[\s\S]*<\/main>/i);
    if (mainMatch && mainMatch[0].length > 500) {
        compressed = mainMatch[0];
    }

    // Final truncation
    if (compressed.length > maxLength) {
        compressed = compressed.substring(0, maxLength) + '\n<!-- truncated -->';
    }

    return compressed;
}

// ============================================================================
// Prompt Templates
// ============================================================================

const ROLE_DESCRIPTIONS: Record<HealerRole, string> = {
    input: 'the main chat input field where users type their messages (textarea, contenteditable div, or textbox)',
    submit: 'the send/submit button that submits the chat message',
    response: 'the container elements that hold AI assistant response messages in the chat conversation area',
};

const ROLE_HINTS: Record<HealerRole, string> = {
    input: '- Look for textarea, contenteditable div, or elements with role="textbox"\n- Usually near the bottom of the page',
    submit: '- Look for a button near the input field\n- Often has an SVG icon (send arrow) or text like "Send"',
    response: `- Look for REPEATED elements that wrap each AI message in the conversation
- These are usually div, article, or section elements with a shared class or data attribute
- The selector should match MULTIPLE message containers (one per message in the chat)
- Do NOT select navigation, sidebar, header, or footer elements
- Do NOT select the page root or main layout containers
- Common patterns: elements with "message", "response", "assistant", "markdown", "prose" in class/role/data attributes
- The selector should use class names, data-testid, role, or aria attributes — NOT pseudo-elements like ::before/::after`,
};

function buildPrompt(role: HealerRole, compressedDom: string): string {
    return `You are a CSS selector expert analyzing a web-based AI chat interface (like ChatGPT, Claude, or Gemini).

Task: Find the CSS selector for: ${ROLE_DESCRIPTIONS[role]}.

Hints:
${ROLE_HINTS[role]}

Rules:
- Return ONLY a valid CSS selector string on a single line, nothing else.
- The selector MUST exist in the provided DOM. Do NOT invent or hallucinate selectors.
- Prefer selectors using class, id, role, aria-label, data-testid, or placeholder attributes.
- Avoid generic selectors like "div" or "div.relative" that match too many unrelated elements.
- If you cannot confidently identify the element, respond with: NONE

DOM snapshot:
\`\`\`html
${compressedDom}
\`\`\`

CSS selector:`;
}

// ============================================================================
// Ollama HTTP call (lightweight, no dependency on OllamaAdapter)
// ============================================================================

function ollamaGenerate(
    baseUrl: string,
    model: string,
    prompt: string,
    timeoutMs: number = 30000,
): Promise<string> {
    return new Promise((resolve, reject) => {
        const url = new URL('/api/generate', baseUrl);
        const body = JSON.stringify({
            model,
            prompt,
            stream: false,
            options: {
                temperature: 0.1,
                num_predict: 100,
            },
        });

        const options: http.RequestOptions = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
            timeout: timeoutMs,
        };

        const req = http.request(options, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                try {
                    const data = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
                    resolve(data.response || '');
                } catch {
                    resolve('');
                }
            });
        });

        req.on('error', (err) => reject(err));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Ollama SLM request timed out'));
        });

        req.write(body);
        req.end();
    });
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Attempt to resolve a CSS selector using an Ollama SLM.
 * Sends a compressed DOM snapshot to the model and parses the response.
 *
 * @param config - Self-healing Ollama configuration
 * @param role - Which element to find (input, submit, response)
 * @param domHtml - Raw HTML of the page (will be compressed)
 * @returns The resolved selector, or null if the SLM couldn't identify it
 */
export async function healWithSlm(
    config: SlmHealerConfig,
    role: HealerRole,
    domHtml: string,
): Promise<SlmHealResult | null> {
    if (!config.enabled) return null;

    const baseUrl = config.baseUrl || 'http://localhost:11434';
    const compressed = compressDom(domHtml);
    const prompt = buildPrompt(role, compressed);

    logDebug(`SLM DOM compressed: ${domHtml.length} -> ${compressed.length}`);
    logInfo(`SLM self-healing attempt: role=${role}, model=${config.model}, domLength=${compressed.length}`);

    try {
        const raw = await ollamaGenerate(baseUrl, config.model, prompt);
        const response = raw.trim();
        logDebug(`SLM raw response (role=${role}): ${response}`);

        // Parse the response — should be a CSS selector or "NONE"
        if (!response || response.toUpperCase() === 'NONE') {
            logWarn(`SLM could not identify selector (role=${role}): ${response}`);
            return null;
        }

        // Extract selector (first line, strip backticks/quotes)
        let selector = response.split('\n')[0].trim();
        selector = selector.replace(/^[`'"]+|[`'"]+$/g, '');

        // Strip CSS declaration blocks — SLMs sometimes return full rules like "#sel { display: none; }"
        selector = selector.replace(/\s*\{[^}]*\}\s*/g, '').trim();

        // Strip common prefixes the SLM might echo back
        selector = selector.replace(/^(CSS\s*selector\s*[:=]\s*)/i, '').trim();

        // Basic validation: must look like a CSS selector
        if (!selector || selector.length > 200 || /[{}]/.test(selector)) {
            logWarn(`SLM invalid selector rejected (role=${role}): ${selector}`);
            return null;
        }

        logInfo(`SLM healed selector (role=${role}, model=${config.model}): ${selector}`);

        return {
            selector,
            confidence: 50,
            reasoning: `Identified by ${config.model} SLM from DOM snapshot`,
        };
    } catch (err: any) {
        logError(`SLM self-healing failed (role=${role}): ${err.message}`);
        return null;
    }
}
