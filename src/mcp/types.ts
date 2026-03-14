export interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: number | string;
    method: string;
    params?: any;
}

export interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: number | string;
    result?: any;
    error?: {
        code: number;
        message: string;
        data?: any;
    };
}

export interface McpTool {
    name: string;
    description?: string;
    inputSchema: {
        type: string;
        properties?: Record<string, any>;
        required?: string[];
    };
}

export interface McpServerCapabilities {
    tools?: Record<string, any>;
    resources?: Record<string, any>;
    prompts?: Record<string, any>;
}
