import http from 'http';

// ============================================================================
// HTTP helpers (zero-dependency, uses Node built-in http)
// ============================================================================

export function ollamaRequest(
    baseUrl: string,
    path: string,
    method: 'GET' | 'POST',
    body?: object,
    timeoutMs: number = 120000,
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const url = new URL(path, baseUrl);
        const options: http.RequestOptions = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method,
            headers: { 'Content-Type': 'application/json' },
            timeout: timeoutMs,
        };

        const req = http.request(options, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                resolve({
                    status: res.statusCode || 0,
                    body: Buffer.concat(chunks).toString('utf-8'),
                });
            });
        });

        req.on('error', (err) => reject(err));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timed out'));
        });

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

export function ollamaStream(
    baseUrl: string,
    path: string,
    body: object,
    timeoutMs: number = 120000,
    signal?: AbortSignal,
): { stream: AsyncGenerator<string>; abort: () => void } {
    let req: http.ClientRequest;
    let aborted = false;

    // Wire up AbortSignal if provided
    if (signal) {
        signal.addEventListener('abort', () => {
            aborted = true;
            if (req) req.destroy();
        }, { once: true });
    }

    const generator = async function* (): AsyncGenerator<string> {
        const url = new URL(path, baseUrl);
        const options: http.RequestOptions = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            timeout: timeoutMs,
        };

        const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
            req = http.request(options, resolve);
            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Stream request timed out'));
            });
            req.write(JSON.stringify(body));
            req.end();
        });

        // Check for HTTP errors
        if (response.statusCode && response.statusCode >= 400) {
            // Collect error body
            let errorBody = '';
            for await (const chunk of response) {
                errorBody += chunk.toString();
            }
            throw new Error(`Ollama HTTP ${response.statusCode}: ${errorBody}`);
        }

        // Yield NDJSON lines as they arrive
        let buffer = '';
        for await (const chunk of response) {
            if (aborted) break;
            const chunkStr = chunk.toString();
            buffer += chunkStr;

            // Check for error response in first chunk (Ollama returns {"error":"..."} for unsupported features)
            if (buffer.includes('"error"')) {
                try {
                    const errData = JSON.parse(buffer.trim());
                    if (errData.error) {
                        throw new Error(`Ollama: ${errData.error}`);
                    }
                } catch (e: any) {
                    if (e.message.startsWith('Ollama:')) throw e;
                    // Not valid JSON yet, continue buffering
                }
            }

            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                if (line.trim()) yield line;
            }
        }
        // Flush remaining
        if (buffer.trim() && !aborted) yield buffer.trim();
    };

    return {
        stream: generator(),
        abort: () => {
            aborted = true;
            if (req) req.destroy();
        },
    };
}
