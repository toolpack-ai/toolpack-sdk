import { Toolpack } from 'toolpack-sdk';

async function runKubernetesExample() {
  const sdk = await Toolpack.init({
    provider: 'openai',
    tools: true,
    defaultMode: 'agent',
  });

  console.log('Listing pods in the default namespace...');
  const podsResponse = await sdk.generate({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: 'Use the Kubernetes tools to list pods in the default namespace and return the results.',
      },
    ],
  });
  console.log(podsResponse.content);

  console.log('Applying a manifest to staging...');
  const applyResponse = await sdk.generate({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: 'Apply the manifest at ./deploy/my-app.yaml to the staging namespace using Kubernetes tools.',
      },
    ],
  });
  console.log(applyResponse.content);

  console.log('Waiting for the deployment rollout...');
  const rolloutResponse = await sdk.generate({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: 'Wait for the my-app deployment rollout to complete in the staging namespace.',
      },
    ],
  });
  console.log(rolloutResponse.content);

  console.log('Fetching logs from the running pod...');
  const logsResponse = await sdk.generate({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: 'Fetch the last 200 lines of logs from the pod my-app-12345 in the staging namespace.',
      },
    ],
  });
  console.log(logsResponse.content);
}

runKubernetesExample().catch((error) => {
  console.error('Kubernetes example failed:', error);
});
