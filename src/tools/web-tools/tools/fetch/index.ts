import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';
import { extractStructured, extractMinimal, formatStructured, formatMinimal } from './extractor.js';
import { logDebug } from '../../../../providers/provider-logger.js';

async function execute(args: Record<string, any>): Promise<string> {
    const url = args.url as string;
    const extractionMode = (args.extractionMode as string) || 'full';
    const headers = args.headers as Record<string, string> | undefined;
    const timeout = (args.timeout || 30000) as number;
    logDebug(`[web.fetch] execute url="${url}" mode=${extractionMode} timeout=${timeout}ms`);

    if (!url) {
        throw new Error('url is required');
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        throw new Error('url must start with http:// or https://');
    }

    const controller = new AbortController();
    const abortTimeout = setTimeout(() => controller.abort(), timeout);

    let response;
    try {
        response = await fetch(url, {
            method: 'GET',
            headers: headers || {},
            signal: controller.signal,
        });
    } catch (e: any) {
        if (e.name === 'AbortError') throw new Error(`Request timed out after ${timeout}ms`);
        throw e;
    } finally {
        clearTimeout(abortTimeout);
    }

    if (!response.ok) {
        return `HTTP ${response.status} ${response.statusText}\n${await response.text()}`;
    }

    const body = await response.text();

    // Handle different extraction modes
    if (extractionMode === 'structured') {
        const structured = extractStructured(body, url);
        return formatStructured(structured);
    } else if (extractionMode === 'minimal') {
        const minimal = extractMinimal(body, url);
        return formatMinimal(minimal);
    } else {
        // Full mode (default) - return raw HTML with 15K limit
        const maxLength = 15_000;
        if (body.length > maxLength) {
            return body.substring(0, maxLength) + `\n\n[TRUNCATED: showing 15K of ${body.length} total characters]`;
        }
        return body;
    }
}

export const webFetchTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
