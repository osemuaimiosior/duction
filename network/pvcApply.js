const k8s = require('@kubernetes/client-node');
const fs = require('fs');
const yaml = require('js-yaml');

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

const client = k8s.KubernetesObjectApi.makeApiClient(kc);

// Load YAML files
const files = [
  './kube/pvc-fabric-org0.yaml',
  './kube/pvc-fabric-org1.yaml',
  './kube/pvc-fabric-org2.yaml'
];

const dps = files.map(f => {
  const content = fs.readFileSync(f, 'utf8');
  const obj = yaml.load(content);
  obj.metadata.namespace = 'duction';
  return obj;
});

const applyResources = async () => {
  for (let i = 0; i < dps.length; i++) {
    try {
      const res = await client.create(dps[i]);
      console.log(`Resource created: ${dps[i].metadata.name}`);
    } catch (err) {
      // If resource already exists, patch it instead
      if (err.body && err.body.reason === 'AlreadyExists') {
        try {
          const res = await client.patch(dps[i]);
          console.log(`Resource patched: ${dps[i].metadata.name}`);
        } catch (patchErr) {
          console.error(`Failed to patch ${dps[i].metadata.name}:`, patchErr.body || patchErr);
        }
      } else {
        console.error(`Failed to create ${dps[i].metadata.name}:`, err.body || err);
      }
    }
  }
};

module.exports = applyResources;
