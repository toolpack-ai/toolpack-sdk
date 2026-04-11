import { execFileSync } from 'child_process';
import { ToolDefinition } from '../types.js';
import { logDebug } from '../../providers/provider-logger.js';

function ensureSafeKubectlArg(value: string, name: string): string {
    if (value.includes('\0') || value.includes('\n') || value.includes('\r')) {
        throw new Error(`Invalid ${name}: contains disallowed characters.`);
    }
    return value;
}

function formatKubectlError(error: any): string {
    const stdout = typeof error.stdout === 'string' ? error.stdout : '';
    const stderr = typeof error.stderr === 'string' ? error.stderr : '';
    const status = error.status ?? 'unknown';
    const stderrLines = stderr.split(/\r?\n/).filter((line: string) => line.trim().length > 0);
    const kubectlMessage = stderrLines.find((line: string) => line.toLowerCase().startsWith('error:')) || stderrLines[0] || error.message || '';
    return `kubectl failed (exit code ${status})${kubectlMessage ? `: ${kubectlMessage.trim()}` : ''}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`;
}

function runKubectl(args: string[], stdin?: string, timeoutMs = 30_000): string {
    args.forEach((arg, index) => ensureSafeKubectlArg(arg, `kubectl argument #${index}`));
    logDebug(`[k8s-tools] execute: kubectl ${args.join(' ')}`);

    try {
        const output = execFileSync('kubectl', args, {
            input: stdin,
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: timeoutMs,
        });
        return output || '(kubectl completed with no output)';
    } catch (error: any) {
        return formatKubectlError(error);
    }
}

function parseKubectlTimeout(timeout?: string): number {
    if (!timeout) return 300_000;
    const normalized = timeout.trim().toLowerCase();
    const match = /^([0-9]+)(s|m|h)?$/.exec(normalized);
    if (!match) return 300_000;

    const value = Number(match[1]);
    switch (match[2]) {
        case 'h':
            return value * 60 * 60 * 1000;
        case 'm':
            return value * 60 * 1000;
        default:
            return value * 1000;
    }
}

const category = 'kubernetes';

function toLabelSelector(labelInput: string | Record<string, string> | undefined): string | undefined {
    if (!labelInput) return undefined;
    if (typeof labelInput === 'string') return labelInput;
    const entries = Object.entries(labelInput).filter(([, value]) => value !== undefined && value !== '');
    if (!entries.length) return undefined;
    return entries.map(([key, value]) => `${ensureSafeKubectlArg(key, 'label key')}=${ensureSafeKubectlArg(value, 'label value')}`).join(',');
}

export const k8sListPodsTool: ToolDefinition = {
    name: 'k8s.list_pods',
    displayName: 'Kubernetes List Pods',
    description: 'List pods in the current or a specific Kubernetes namespace.',
    category,
    parameters: {
        type: 'object',
        properties: {
            namespace: { type: 'string', description: 'Namespace to query. If omitted, uses the current namespace.' },
            labels: { type: 'string', description: 'Label selector to filter pods.', },
            labelSelector: {
                type: 'object',
                description: 'Map of label key/value pairs to filter pods.',
                additionalProperties: { type: 'string' },
            },
            output: { type: 'string', description: 'Output format for the pod list.', enum: ['wide', 'name', 'json', 'yaml'], default: 'wide' },
            allNamespaces: { type: 'boolean', description: 'If true, list pods across all namespaces.', default: false },
        },
        required: [],
    },
    execute: async (args: Record<string, any>) => {
        const command = ['get', 'pods'];
        const output = args.output as string | undefined;

        if (output) {
            command.push('-o', output);
        } else {
            command.push('-o', 'wide');
        }

        if (args.allNamespaces) command.push('--all-namespaces');
        if (args.namespace && !args.allNamespaces) command.push('-n', ensureSafeKubectlArg(args.namespace as string, 'namespace'));

        const labelSelector = toLabelSelector(args.labelSelector as Record<string, string> | string | undefined) ?? args.labels;
        if (labelSelector) command.push('-l', ensureSafeKubectlArg(labelSelector, 'labels'));

        return runKubectl(command);
    },
};

export const k8sDescribeTool: ToolDefinition = {
    name: 'k8s.describe',
    displayName: 'Kubernetes Describe Resource',
    description: 'Describe a Kubernetes resource or resource instance.',
    category,
    parameters: {
        type: 'object',
        properties: {
            resource: { type: 'string', description: 'Resource type to describe, such as pod, service, deployment.', },
            name: { type: 'string', description: 'Resource name. Optional for cluster-wide descriptions.', },
            namespace: { type: 'string', description: 'Namespace containing the resource.', },
        },
        required: ['resource'],
    },
    execute: async (args: Record<string, any>) => {
        const resource = ensureSafeKubectlArg(args.resource as string, 'resource');
        const command = ['describe', resource];
        if (args.name) command.push(ensureSafeKubectlArg(args.name as string, 'name'));
        if (args.namespace) command.push('-n', ensureSafeKubectlArg(args.namespace as string, 'namespace'));
        return runKubectl(command);
    },
};

export const k8sGetLogsTool: ToolDefinition = {
    name: 'k8s.get_logs',
    displayName: 'Kubernetes Get Pod Logs',
    description: 'Fetch logs from a Kubernetes pod, optionally from a specific container.',
    category,
    parameters: {
        type: 'object',
        properties: {
            podName: { type: 'string', description: 'The name of the pod to fetch logs from.' },
            namespace: { type: 'string', description: 'Namespace of the pod.', },
            container: { type: 'string', description: 'Container name inside the pod.', },
            tailLines: { type: 'number', description: 'Number of log lines to show from the end.', default: 100 },
            since: { type: 'string', description: 'Return logs newer than a relative duration like 5m or 1h.', },
        },
        required: ['podName'],
    },
    execute: async (args: Record<string, any>) => {
        const command = ['logs', ensureSafeKubectlArg(args.podName as string, 'podName')];
        if (args.container) command.push('-c', ensureSafeKubectlArg(args.container as string, 'container'));
        if (args.namespace) command.push('-n', ensureSafeKubectlArg(args.namespace as string, 'namespace'));
        if (typeof args.tailLines === 'number') command.push('--tail', `${args.tailLines}`);
        if (args.since) command.push('--since', ensureSafeKubectlArg(args.since as string, 'since'));
        return runKubectl(command);
    },
};

export const k8sApplyManifestTool: ToolDefinition = {
    name: 'k8s.apply_manifest',
    displayName: 'Kubernetes Apply Manifest',
    description: 'Apply a Kubernetes manifest from a file path or inline YAML content.',
    category,
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Path to the manifest file to apply.', },
            manifest: { type: 'string', description: 'Inline YAML manifest to apply if no path is provided.', },
            namespace: { type: 'string', description: 'Namespace to apply the manifest into, if supported by the manifest.', },
            dryRun: { type: 'boolean', description: 'If true, perform a client-side dry run without applying changes.', default: false },
        },
        required: [],
    },
    confirmation: {
        level: 'high',
        reason: 'This will change cluster state by applying a Kubernetes manifest.',
        showArgs: ['path', 'namespace'],
    },
    execute: async (args: Record<string, any>) => {
        const path = args.path as string | undefined;
        const manifest = args.manifest as string | undefined;
        const command = ['apply'];
        if (args.dryRun) command.push('--dry-run=client');
        command.push('-f');
        if (path) {
            command.push(ensureSafeKubectlArg(path, 'path'));
            if (args.namespace) command.push('-n', ensureSafeKubectlArg(args.namespace as string, 'namespace'));
            return runKubectl(command);
        }

        if (!manifest) {
            throw new Error('Either path or manifest is required to apply a Kubernetes manifest.');
        }

        if (args.namespace) command.push('-n', ensureSafeKubectlArg(args.namespace as string, 'namespace'));
        command.push('-');
        return runKubectl(command, manifest);
    },
};

export const k8sDeleteResourceTool: ToolDefinition = {
    name: 'k8s.delete_resource',
    displayName: 'Kubernetes Delete Resource',
    description: 'Delete a Kubernetes resource by type and name, or delete resources from a manifest file.',
    category,
    parameters: {
        type: 'object',
        properties: {
            resource: { type: 'string', description: 'Resource type to delete, such as pod, service, deployment.', },
            name: { type: 'string', description: 'Name of the resource to delete.', },
            namespace: { type: 'string', description: 'Namespace containing the resource.', },
            path: { type: 'string', description: 'Path to a manifest file that contains the resources to delete.', },
            force: { type: 'boolean', description: 'Force deletion of the resource.', default: false },
            dryRun: { type: 'boolean', description: 'If true, perform a client-side dry run without deleting resources.', default: false },
        },
        required: [],
    },
    confirmation: {
        level: 'high',
        reason: 'This will delete resources from the Kubernetes cluster.',
        showArgs: ['resource', 'name', 'path'],
    },
    execute: async (args: Record<string, any>) => {
        const path = args.path as string | undefined;
        const resource = args.resource as string | undefined;
        const name = args.name as string | undefined;

        if (path) {
            const command = ['delete'];
            if (args.dryRun) command.push('--dry-run=client');
            command.push('-f', ensureSafeKubectlArg(path, 'path'));
            if (args.namespace) command.push('-n', ensureSafeKubectlArg(args.namespace as string, 'namespace'));
            return runKubectl(command);
        }

        if (!resource || !name) {
            throw new Error('resource and name are required unless a manifest path is provided.');
        }

        const command = ['delete', ensureSafeKubectlArg(resource, 'resource'), ensureSafeKubectlArg(name, 'name')];
        if (args.namespace) command.push('-n', ensureSafeKubectlArg(args.namespace as string, 'namespace'));
        if (args.force) command.push('--force', '--grace-period=0');
        if (args.dryRun) command.push('--dry-run=client');
        return runKubectl(command);
    },
};

export const k8sListServicesTool: ToolDefinition = {
    name: 'k8s.list_services',
    displayName: 'Kubernetes List Services',
    description: 'List services in the current or a specific Kubernetes namespace.',
    category,
    parameters: {
        type: 'object',
        properties: {
            namespace: { type: 'string', description: 'Namespace to query. If omitted, uses the current namespace.' },
            output: { type: 'string', description: 'Output format for the service list.', enum: ['wide', 'name', 'json', 'yaml'], default: 'wide' },
            allNamespaces: { type: 'boolean', description: 'List services across all namespaces.', default: false },
        },
        required: [],
    },
    execute: async (args: Record<string, any>) => {
        const command = ['get', 'services'];
        const output = args.output as string | undefined;
        command.push('-o', output || 'wide');
        if (args.allNamespaces) command.push('--all-namespaces');
        if (args.namespace && !args.allNamespaces) command.push('-n', ensureSafeKubectlArg(args.namespace as string, 'namespace'));
        return runKubectl(command);
    },
};

export const k8sListDeploymentsTool: ToolDefinition = {
    name: 'k8s.list_deployments',
    displayName: 'Kubernetes List Deployments',
    description: 'List deployments in the current or a specific Kubernetes namespace.',
    category,
    parameters: {
        type: 'object',
        properties: {
            namespace: { type: 'string', description: 'Namespace to query. If omitted, uses the current namespace.' },
            labels: { type: 'string', description: 'Label selector to filter deployments.', },
            labelSelector: {
                type: 'object',
                description: 'Map of label key/value pairs to filter deployments.',
                additionalProperties: { type: 'string' },
            },
            output: { type: 'string', description: 'Output format for the deployment list.', enum: ['wide', 'name', 'json', 'yaml'], default: 'wide' },
            allNamespaces: { type: 'boolean', description: 'List deployments across all namespaces.', default: false },
        },
        required: [],
    },
    execute: async (args: Record<string, any>) => {
        const command = ['get', 'deployments'];
        const output = args.output as string | undefined;
        command.push('-o', output || 'wide');
        if (args.allNamespaces) command.push('--all-namespaces');
        if (args.namespace && !args.allNamespaces) command.push('-n', ensureSafeKubectlArg(args.namespace as string, 'namespace'));

        const labelSelector = toLabelSelector(args.labelSelector as Record<string, string> | string | undefined) ?? args.labels;
        if (labelSelector) command.push('-l', ensureSafeKubectlArg(labelSelector, 'labels'));
        return runKubectl(command);
    },
};

export const k8sGetConfigMapTool: ToolDefinition = {
    name: 'k8s.get_config_map',
    displayName: 'Kubernetes Get ConfigMap',
    description: 'Retrieve a ConfigMap from a Kubernetes namespace.',
    category,
    parameters: {
        type: 'object',
        properties: {
            name: { type: 'string', description: 'ConfigMap name.', },
            namespace: { type: 'string', description: 'Namespace containing the ConfigMap.', },
            output: { type: 'string', description: 'Output format, such as yaml or json.', enum: ['yaml', 'json'], default: 'yaml' },
        },
        required: ['name'],
    },
    execute: async (args: Record<string, any>) => {
        const command = ['get', 'configmap', ensureSafeKubectlArg(args.name as string, 'name'), '-o', args.output as string || 'yaml'];
        if (args.namespace) command.push('-n', ensureSafeKubectlArg(args.namespace as string, 'namespace'));
        return runKubectl(command);
    },
};

export const k8sSwitchContextTool: ToolDefinition = {
    name: 'k8s.switch_context',
    displayName: 'Kubernetes Switch Context',
    description: 'Switch the active kubectl context to a different Kubernetes cluster or namespace configuration.',
    category,
    parameters: {
        type: 'object',
        properties: {
            context: { type: 'string', description: 'The kubeconfig context to switch to.', },
        },
        required: ['context'],
    },
    execute: async (args: Record<string, any>) => {
        return runKubectl(['config', 'use-context', ensureSafeKubectlArg(args.context as string, 'context')]);
    },
};

export const k8sGetNamespacesTool: ToolDefinition = {
    name: 'k8s.get_namespaces',
    displayName: 'Kubernetes Get Namespaces',
    description: 'List namespaces in the current Kubernetes context.',
    category,
    parameters: {
        type: 'object',
        properties: {
            output: { type: 'string', description: 'Output format for the namespace list.', enum: ['wide', 'name', 'json', 'yaml'], default: 'wide' },
        },
        required: [],
    },
    execute: async (args: Record<string, any>) => runKubectl(['get', 'namespaces', '-o', (args.output as string) || 'wide']),
};

export const k8sWaitForDeploymentTool: ToolDefinition = {
    name: 'k8s.wait_for_deployment',
    displayName: 'Kubernetes Wait For Deployment',
    description: 'Wait for a Kubernetes deployment to complete its rollout.',
    category,
    parameters: {
        type: 'object',
        properties: {
            name: { type: 'string', description: 'Deployment name to wait for.', },
            namespace: { type: 'string', description: 'Namespace containing the deployment.', },
            timeout: { type: 'string', description: 'Timeout duration, e.g. 300s or 5m.', default: '300s' },
        },
        required: ['name'],
    },
    execute: async (args: Record<string, any>) => {
        const timeout = args.timeout as string | undefined;
        const command = ['rollout', 'status', `deployment/${ensureSafeKubectlArg(args.name as string, 'name')}`, '--timeout', timeout || '300s'];
        if (args.namespace) command.push('-n', ensureSafeKubectlArg(args.namespace as string, 'namespace'));
        return runKubectl(command, undefined, parseKubectlTimeout(timeout));
    },
};
