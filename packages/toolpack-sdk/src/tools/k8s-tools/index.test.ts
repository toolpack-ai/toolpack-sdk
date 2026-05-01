import { expect, test, describe } from 'vitest';
import { k8sToolsProject } from './index.js';
import {
    k8sListPodsTool,
    k8sDescribeTool,
    k8sGetLogsTool,
    k8sApplyManifestTool,
    k8sDeleteResourceTool,
    k8sListServicesTool,
    k8sListDeploymentsTool,
    k8sGetConfigMapTool,
    k8sSwitchContextTool,
    k8sGetNamespacesTool,
    k8sWaitForDeploymentTool,
} from './tools.js';

describe('k8s-tools', () => {
    const expectedToolNames = [
        'k8s.list_pods',
        'k8s.describe',
        'k8s.get_logs',
        'k8s.apply_manifest',
        'k8s.delete_resource',
        'k8s.list_services',
        'k8s.list_deployments',
        'k8s.get_config_map',
        'k8s.switch_context',
        'k8s.get_namespaces',
        'k8s.wait_for_deployment',
    ];

    test('exports the expected Kubernetes tool names', () => {
        expect(k8sToolsProject.manifest.tools).toEqual(expectedToolNames);
    });

    test('exports tool definitions with execute functions', () => {
        const tools = [
            k8sListPodsTool,
            k8sDescribeTool,
            k8sGetLogsTool,
            k8sApplyManifestTool,
            k8sDeleteResourceTool,
            k8sListServicesTool,
            k8sListDeploymentsTool,
            k8sGetConfigMapTool,
            k8sSwitchContextTool,
            k8sGetNamespacesTool,
            k8sWaitForDeploymentTool,
        ];

        tools.forEach((tool) => {
            expect(tool).toHaveProperty('execute');
            expect(typeof tool.execute).toBe('function');
        });
    });

    test('k8s tools expose JSON output and dry-run schema options', () => {
        expect(k8sListPodsTool.parameters.properties).toHaveProperty('output');
        expect(k8sListDeploymentsTool.parameters.properties).toHaveProperty('output');
        expect(k8sListServicesTool.parameters.properties).toHaveProperty('output');
        expect(k8sGetNamespacesTool.parameters.properties).toHaveProperty('output');
        expect(k8sApplyManifestTool.parameters.properties).toHaveProperty('dryRun');
        expect(k8sDeleteResourceTool.parameters.properties).toHaveProperty('dryRun');
    });
});
