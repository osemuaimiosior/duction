const k8s = require('@kubernetes/client-node');

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

const createNS = async () => {
  try {
    const nsName = 'duction';

    // List existing namespaces
    const existingResponse = await k8sApi.listNamespace();
    const existingNamespaces = existingResponse.body?.items || [];

    const exists = existingNamespaces.some(ns => ns.metadata.name === nsName);

    if (exists) {
      console.log(`Namespace "${nsName}" already exists, skipping creation.`);
    } else {
      // Create new namespace
      const namespaceManifest = { metadata: { name: nsName } };
      const createdNamespace = await k8sApi.createNamespace({ body: namespaceManifest });
      console.log('New namespace created:', createdNamespace.body.metadata.name);
    }

  } catch (err) {
    console.error('Error creating namespace:', err.body || err);
  }
};

module.exports = createNS;
