const k8s = require('@kubernetes/client-node');
const fs = require('fs');
const yaml = require('js-yaml');
const axios = require('axios');
const { getType } =require('./utils/helper');
const { exec } = require("child_process");
const util = require("util");

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

const client = k8s.KubernetesObjectApi.makeApiClient(kc);
const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
const k8sApi2 = kc.makeApiClient(k8s.AppsV1Api);

const initIngress = async () => {
    try {
        // Load YAML
        const content = fs.readFileSync("./kube/ingress-nginx-kind.yaml", 'utf8');
        const objects = yaml.loadAll(content);

        for (const obj of objects) {

            // Kubernetes API requires this
            obj.metadata = obj.metadata || {};
            obj.metadata.annotations = obj.metadata.annotations || {};

            try {
                await client.create(obj);
                console.log(`Created: ${obj.kind} ${obj.metadata.name}`);
            } catch (err) {
                // console.log("This is the error from ingress: ", JSON.parse(err.body).reason);
                const parsedErr = JSON.parse(err.body);

                if (parsedErr && parsedErr.reason === 'AlreadyExists') {
                    console.log(`Already exists: ${obj.kind} ${obj.metadata.name}, applying patch...`);
                    
                    // const name = obj.metadata.name;
                    // const namespace = obj.metadata.namespace || undefined;
                    // console.log("from ingresss:", obj)
                    await client.patch( 
                        obj,  
                        undefined,
                        {
                            headers: { "Content-Type": "application/merge-patch+json" }
                        });

                } else {
                    console.error("Failed:", err);
                }
            }
        }

    } catch (err) {
        console.error("Ingress initialization failed:", err);
    }
};

async function applyYamlFromUrl(timeoutMs = 10 * 60 * 1000, retryInterval = 5000) {
  const endTime = Date.now() + timeoutMs;

  const url = "https://raw.githubusercontent.com/jetstack/cert-manager/v1.6.1/deploy/manifests/cert-manager.yaml";

  while (Date.now() < endTime) {
    try {
      console.log(`Downloading YAML from ${url}...`);
      const res = await axios.get(url, { timeout: 20000 });

      const docs = yaml.loadAll(res.data);
      console.log(`Loaded ${docs.length} YAML documents.`);

      for (const doc of docs) {
        if (!doc || !doc.kind) continue;

        // VERY IMPORTANT: ensure apiVersion + kind are included
        doc.metadata = doc.metadata || {};

        try {
          await client.create(doc);
          console.log(`✔ Created ${doc.kind} "${doc.metadata.name}"`);
        } catch (err) {
          const parsedErr = JSON.parse(err.body || "{}");

          if (parsedErr.reason === "AlreadyExists") {
            console.log(`↻ Patching existing ${doc.kind} "${doc.metadata.name}"`);

            try {
              await client.patch(
                doc,
                undefined,
                undefined,
                undefined,
                {
                  headers: { "Content-Type": "application/merge-patch+json" }
                }
              );
            } catch (patchErr) {
              console.error("Patch failed:", patchErr.body || patchErr);
            }
          } else {
            console.error("Create failed:", parsedErr.message || err.message);
          }
        }
      }

      console.log("YAML applied successfully.");
      return;

    } catch (e) {
      console.error(`Failed to fetch/apply YAML. Retrying in ${retryInterval / 1000}s...`);
      await new Promise(r => setTimeout(r, retryInterval));
    }
  }

  throw new Error(`Timeout: Could not apply YAML from ${url}`);
};

const createNS = async () => {
  try {
    const nsName = 'duction';

    // List existing namespaces
    const existingResponse = await k8sApi.listNamespace();
    // console.log("This is from ns: ", existingResponse.items)
    const existingNamespaces = existingResponse.items || [];

    const exists = existingNamespaces.some(ns => ns.metadata.name === nsName);
    // console.log("from namespace: ", exists);

    if (exists) {
      console.log(`Namespace "${nsName}" already exists, skipping creation.`);
    } else {
      // Create new namespace
      const namespaceManifest = { metadata: { name: nsName } };
      const createdNamespace = await k8sApi.createNamespace({ body: namespaceManifest });
      console.log('New namespace created:', createdNamespace.metadata.name);
    }

  } catch (err) {
    console.error('Error creating namespace:', err.body || err);
  }
};

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

const pvcApply = async () => {
  for (let i = 0; i < dps.length; i++) {
    try {
      await client.create(dps[i]);
      console.log(`Resource created: ${dps[i].metadata.name}`);
    } catch (err) {
      // If resource already exists, patch it instead
      const parsedErr = JSON.parse(err.body);

      if (parsedErr && parsedErr.reason === 'AlreadyExists') {
        try {

          const name = dps[i].metadata.name;
          const namespace = dps[i].metadata.namespace || undefined;
        
          await client.patch(
            name, 
            namespace, 
            dps[i],  
            undefined,
            undefined,
            undefined,
            {
                headers: { "Content-Type": "application/merge-patch+json" }
            });

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

const pvcApplyOrg = async () => {
  for (let i = 0; i < dps.length; i++) {
    try {
      await client.create(dps[i]);
      console.log(`Resource created: ${dps[i].metadata.name}`);
    } catch (err) {
      // If resource already exists, patch it instead
      const parsedErr = JSON.parse(err.body);

      if (parsedErr && parsedErr.reason === 'AlreadyExists') {
        try {

          const name = dps[i].metadata.name;
          let namespace;
          
          switch (name){
            case "fabric-org0":
              namespace = "org0";
              await client.patch(
                name, 
                namespace, 
                dps[i],  
                undefined,
                undefined,
                undefined,
                {
                    headers: { "Content-Type": "application/merge-patch+json" }
              });
          break;

            case "fabric-org1":
              namespace = "org1";
              await client.patch(
                name, 
                namespace, 
                dps[i],  
                undefined,
                undefined,
                undefined,
                {
                    headers: { "Content-Type": "application/merge-patch+json" }
              });
          break;

            case "fabric-org2":
              namespace = "org2";
              await client.patch(
                name, 
                namespace, 
                dps[i],  
                undefined,
                undefined,
                undefined,
                {
                    headers: { "Content-Type": "application/merge-patch+json" }
              });
          break;

          }
          
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

const checkCertMgDeployment = async () => {
  const deployments = [
    "cert-manager",
    "cert-manager-cainjector",
    "cert-manager-webhook"
  ];

  const namespace = "cert-manager";

  for (const name of deployments) {
    console.log(`Checking deployment: ${name}`);
    console.log(getType(name));

    const timeoutMs = 15 * 60 * 1000; // 15 minutes
    const intervalMs = 600000; // Check every 10 min
    const endTime = Date.now() + timeoutMs;

    while (Date.now() < endTime) {
      try {
        // Must pass name and namespace as direct args
        const res = await k8sApi2.readNamespacedDeployment({name, namespace});
        console.log(res);

        const status = res.body.status;
        const ready = status.readyReplicas || 0;
        const desired = status.replicas || 0;

        console.log(`${name}: ${ready}/${desired} ready`);

        if (ready === desired && desired > 0) {
          console.log(`${name} rollout complete`);
          break; // move to next deployment
        } else {
          console.log(`⏳ ${name} initializing...`);
        }

      } catch (err) {
        // Deployment not created yet
        const parsedErr = JSON.parse(err.body || "{}");
        if (parsedErr.reason === "NotFound") {
          console.log(`${name} not found yet, waiting...`);
        } else {
          console.error("Unexpected error:", err);
        }
      }

      await new Promise(r => setTimeout(r, intervalMs));
    }
  }

  return true;
};

async function waitForNginxIngress() {
  const namespace = "ingress-nginx";
  const selector = "app.kubernetes.io/component=controller";

  const timeoutMs = 15 * 60 * 1000; // 15 minutes
  const intervalMs = 600000; // Check every 10 min
  const endTime = Date.now() + timeoutMs;

  console.log("Waiting for NGINX ingress controller pod to become Ready...");

  while (Date.now() < endTime) {
    const res = await k8sApi.listNamespacedPod({
      namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      selector
  });

    console.log("From waiting from ingress: ", res)

    if (res.body.items.length === 0) {
      console.log("No controller pods found yet...");
    }

    for (const pod of res.body.items) {
      const conditions = pod.status?.conditions || [];
      const readyCondition = conditions.find(c => c.type === "Ready");

      if (readyCondition && readyCondition.status === "True") {
        console.log(`Pod ${pod.metadata.name} is Ready`);
        return true;
      } else {
        console.log(`Pod ${pod.metadata.name} is NOT Ready yet`);
      }
    }

    await new Promise(r => setTimeout(r, intervalMs));
  }

  throw new Error(`Timeout: NGINX ingress controller pod did not become Ready within ${timeoutMs} minutes`);
};

async function recreateConfigMap() {
  // 1. Read all files from folder

  const ns = [
    'org0',
    'org1',
    'org2'
  ];

  let _name;
  let namespace;
  let folderPath;

  for (const namesp of ns) {

    switch (namesp){
      case "fabric-org0":
        
        _name = "org0-config";
        namespace = "fabric-org0";
        folderPath = "config/org0";

        const files0 = fs.readdirSync(folderPath);

        const data0 = {};
        for (const file of files0) {
          const fullPath = path.join(folderPath, file);
          data0[file] = fs.readFileSync(fullPath, "utf8");
        }

        // 2. Delete old configmap if exists
        try {
          await k8sApi.deleteNamespacedConfigMap(_name, namespace);
          console.log(`Deleted existing ConfigMap: ${_name}`);
        } catch (err) {
          console.log("No existing ConfigMap or delete skipped");
        }

        // 3. Create new configmap
        const body0 = {
          metadata: { _name },
          data0,
        };

        await k8sApi.createNamespacedConfigMap(namespace, body0);
        console.log(`Created ConfigMap: ${_name}`);
      break;
      
      case "fabric-org1":
        
        _name = "org0-config";
        namespace = "fabric-org1";
        folderPath = "config/org1";

        const files1 = fs.readdirSync(folderPath);

        const data1 = {};
        for (const file of files1) {
          const fullPath = path.join(folderPath, file);
          data1[file] = fs.readFileSync(fullPath, "utf8");
        }

        // 2. Delete old configmap if exists
        try {
          await k8sApi.deleteNamespacedConfigMap(_name, namespace);
          console.log(`Deleted existing ConfigMap: ${_name}`);
        } catch (err) {
          console.log("No existing ConfigMap or delete skipped");
        }

        // 3. Create new configmap
        const body1 = {
          metadata: { _name },
          data1,
        };

        await k8sApi.createNamespacedConfigMap(namespace, body1);
        console.log(`Created ConfigMap: ${_name}`);
      break;

      case "fabric-org2":
        
        _name = "org0-config";
        namespace = "fabric-org2";
        folderPath = "config/org2";

        const files2 = fs.readdirSync(folderPath);

        const data2 = {};
        for (const file of files1) {
          const fullPath = path.join(folderPath, file);
          data2[file] = fs.readFileSync(fullPath, "utf8");
        }

        // 2. Delete old configmap if exists
        try {
          await k8sApi.deleteNamespacedConfigMap(_name, namespace);
          console.log(`Deleted existing ConfigMap: ${_name}`);
        } catch (err) {
          console.log("No existing ConfigMap or delete skipped");
        }

        // 3. Create new configmap
        const body2 = {
          metadata: { _name },
          data2,
        };

        await k8sApi.createNamespacedConfigMap(namespace, body2);
        console.log(`Created ConfigMap: ${_name}`);
      break;
    }
  }

  
};

async function initTLSCertIssuers(){

  const ns = [
    'org0',
    'org1',
    'org2'
  ];

  const yamlFilePath = "kube/root-tls-cert-issuer.yaml";

  for (const namespace of ns){

    switch(namespace){
      case "org0":
        try {
          await client.create(yamlFilePath);
          console.log(`Resource created: ${yamlFilePath.metadata.name}`);
        } catch (err) {}
      break;

      case "org1":
        try {
          await client.create(yamlFilePath);
          console.log(`Resource created: ${yamlFilePath.metadata.name}`);
        } catch (err) {}
      break;

      case "org2":
        try {
          await client.create(yamlFilePath);
          console.log(`Resource created: ${yamlFilePath.metadata.name}`);
        } catch (err) {}
      break;
    }
  };
};

const customApi = kc.makeApiClient(k8s.CustomObjectsApi);

async function waitForTLSIssuerReady(timeoutMs = 30000, intervalMs = 2000) {
  const issuerName = "root-tls-cert-issuer";

  const namespaces = ["org0", "org1", "org2"];

  for (const ns of namespaces) {
    console.log(`\n=== Checking Issuer in namespace: ${ns} ===`);

    const start = Date.now();  // timeout resets for each namespace

    while (Date.now() - start < timeoutMs) {
      try {
        const res = await customApi.getNamespacedCustomObject(
          "cert-manager.io",
          "v1",
          ns,
          "issuers",
          issuerName
        );

        const conditions = res.body.status?.conditions || [];
        const ready = conditions.find(c => c.type === "Ready" && c.status === "True");

        if (ready) {
          console.log(`Issuer "${issuerName}" is Ready in namespace ${ns}`);
          break;  // go to next namespace
        }

        console.log(`Issuer in ${ns} not ready yet...`);
      } catch (err) {
        console.log(`Issuer "${issuerName}" not found yet in ${ns}`);
      }

      await new Promise(res => setTimeout(res, intervalMs));
    }

    // Did we fail to become ready?
    if (Date.now() - start >= timeoutMs) {
      throw new Error(`Timeout: Issuer "${issuerName}" not Ready in namespace ${ns}`);
    }
  }

  console.log("\n All issuers are Ready in org0, org1, org2");
  return true;
};

async function generateTLS() {

  const ns = [
    'org0',
    'org1',
    'org2'
  ];

  for (const namespace of ns){

    switch(namespace){
      case "org0":
      let yamlFilePath0 = "kube/org0/org0-tls-cert-issuer.yaml";
        try {
          await client.create(yamlFilePath0);
          console.log(`Resource created: ${yamlFilePath0.metadata.name}`);
        } catch (err) {}
      break;

      case "org1":
        let yamlFilePath1 = "kube/org0/org0-tls-cert-issuer.yaml";
        try {
          await client.create(yamlFilePath1);
          console.log(`Resource created: ${yamlFilePath1.metadata.name}`);
        } catch (err) {}
      break;

      case "org2":
        let yamlFilePath2 = "kube/org0/org0-tls-cert-issuer.yaml";
        try {
          await client.create(yamlFilePath2);
          console.log(`Resource created: ${yamlFilePath2.metadata.name}`);
        } catch (err) {}
      break;
    }
  };
  
};

async function waitForGeneratedIssuerReady(timeoutMs = 30000, intervalMs = 2000) {
  const issuerMap = {
    org0: "org0-tls-cert-issuer",
    org1: "org1-tls-cert-issuer",
    org2: "org2-tls-cert-issuer"
  };

  const namespaces = ["org0", "org1", "org2"];

  for (const ns of namespaces) {
    const issuerName = issuerMap[ns];
    const start = Date.now();

    console.log(`\n=== Checking Issuer "${issuerName}" in namespace: ${ns} ===`);

    while (Date.now() - start < timeoutMs) {
      try {
        const res = await customApi.getNamespacedCustomObject(
          "cert-manager.io",
          "v1",
          ns,
          "issuers",
          issuerName
        );

        const ready = res.body.status?.conditions?.find(
          c => c.type === "Ready" && c.status === "True"
        );

        if (ready) {
          console.log(`Issuer "${issuerName}" is Ready in namespace ${ns}`);
          break; // STOP WAITING — READY!
        }

        console.log(`Issuer "${issuerName}" exists but is not ready yet in ${ns}`);
      } catch (err) {
        console.log(`Issuer "${issuerName}" not found yet in namespace ${ns}`);
      }

      await new Promise(r => setTimeout(r, intervalMs));
    }

    if (Date.now() - start >= timeoutMs) {
      throw new Error(`Timeout: Issuer "${issuerName}" NOT Ready in namespace ${ns}`);
    }
  }

  console.log("\n All generated issuers (org0, org1, org2) are Ready!");
  return true;
};

const applyYamlToNamespace = async (filePath, namespace) => {
  try {
    // 1. Read the YAML file
    let content = fs.readFileSync(filePath, "utf8");

    // 2. ENV substitution (simple envsubst)
    content = content.replace(/\$\w+/g, (envVar) => process.env[envVar.slice(1)] || "");

    // 3. Parse YAML into multiple docs (if `---`)
    const docs = yaml.loadAll(content);

    // 4. Apply each YAML object
    for (const doc of docs) {
      if (!doc || !doc.kind) continue;

      try {
        await client.create(doc);
        console.log(`Created ${doc.kind}: ${doc.metadata.name} in ${namespace}`);
      } catch (err) {
        // Patch if already exists
        const parsed = JSON.parse(err.body);
        if (parsed.reason === "AlreadyExists") {
          await client.patch(
            doc.metadata.name,
            namespace,
            doc,
            undefined,
            undefined,
            undefined,
            {
              headers: {"Content-Type": "application/merge-patch+json"},
            }
          );

          console.log(`Patched ${doc.kind}: ${doc.metadata.name}`);
        } else {
          throw err;
        }
      }
    }

  } catch (e) {
    console.error("Error applying YAML:", e);
    throw e;
  }
};

async function waitForIssuerReady(timeoutMs = 30000, intervalMs = 2000) {
  const issuerName = "org0-tls-cert-issuer";

  const namespaces = ["org0", "org1", "org2"];

  for (const ns of namespaces) {
    console.log(`\n=== Checking Issuer in namespace: ${ns} ===`);

    const start = Date.now();  // timeout resets for each namespace

    while (Date.now() - start < timeoutMs) {
      try {
        const res = await customApi.getNamespacedCustomObject(
          "cert-manager.io",
          "v1",
          ns,
          "issuers",
          issuerName
        );

        const conditions = res.body.status?.conditions || [];
        const ready = conditions.find(c => c.type === "Ready" && c.status === "True");

        if (ready) {
          console.log(`Issuer "${issuerName}" is Ready in namespace ${ns}`);
          break;  // go to next namespace
        }

        console.log(`Issuer in ${ns} not ready yet...`);
      } catch (err) {
        console.log(`Issuer "${issuerName}" not found yet in ${ns}`);
      }

      await new Promise(res => setTimeout(res, intervalMs));
    }

    // Did we fail to become ready?
    if (Date.now() - start >= timeoutMs) {
      throw new Error(`Timeout: Issuer "${issuerName}" not Ready in namespace ${ns}`);
    }
  }

  console.log("\n All issuers are Ready in org0, org1, org2");
  return true;
};

const applyCAYamlToNamespace = async (filePath, namespace) => {
  try {
    // 1. Read the YAML file
    let content = fs.readFileSync(filePath, "utf8");

    // 2. ENV substitution (simple envsubst)
    content = content.replace(/\$\w+/g, (envVar) => process.env[envVar.slice(1)] || "");

    // 3. Parse YAML into multiple docs (if `---`)
    const docs = yaml.loadAll(content);

    // 4. Apply each YAML object
    for (const doc of docs) {
      if (!doc || !doc.kind) continue;

      try {
        await client.create(doc);
        console.log(`Created ${doc.kind}: ${doc.metadata.name} in ${namespace}`);
      } catch (err) {
        // Patch if already exists
        const parsed = JSON.parse(err.body);
        if (parsed.reason === "AlreadyExists") {
          await client.patch(
            doc.metadata.name,
            namespace,
            doc,
            undefined,
            undefined,
            undefined,
            {
              headers: {"Content-Type": "application/merge-patch+json"},
            }
          );

          console.log(`Patched ${doc.kind}: ${doc.metadata.name}`);
        } else {
          throw err;
        }
      }
    }

  } catch (e) {
    console.error("Error applying YAML:", e);
    throw e;
  }
};

const execAsync = util.promisify(exec);

// This function below contain code on how to executr CLI commands in nodejs...if large process CLI command, use swamp
async function extractCACert(namespace, secretName, outputPath) {
  try {
    // Get Secret JSON from Kubernetes
    const { stdout } = await execAsync(
      `kubectl -n ${namespace} get secret ${secretName} -o json`
    );

    // Parse JSON
    const secret = JSON.parse(stdout);

    if (!secret.data || !secret.data["ca.crt"]) {
      throw new Error("ca.crt not found in secret");
    }

    // Base64 decode
    const decoded = Buffer.from(secret.data["ca.crt"], "base64");

    // Write file
    await fs.writeFile(outputPath, decoded);

    console.log(`Extracted CA cert → ${outputPath}`);
  } catch (err) {
    console.error("Error extracting CA cert:", err);
  }
};

async function enrollOrgCA() {
  const base = process.cwd();

  const ca = [
    "org0-ca",
    "org1-ca",
    "org2-ca",
  ];

  const orgMap = {
    "org0-ca": "org0",
    "org1-ca": "org1",
    "org2-ca": "org2",
  };

  for (const c of ca) {

    const url = `https://${process.env.RCAADMIN_USER}:${process.env.RCAADMIN_PASS}` +
                `@${c}.${process.env.DOMAIN}:${process.env.NGINX_HTTPS_PORT}`;

    const tlsFile = `${base}/build/cas/${c}/tlsca-cert.pem`;
    const mspDir = `${base}/build/enrollments/${orgMap[c]}/users/${process.env.RCAADMIN_USER}/msp`;

    const cmd = `fabric-ca-client enroll \
      --url ${url} \
      --tls.certfiles ${tlsFile} \
      --mspdir ${mspDir}`;

    try {
      const { stdout } = await execAsync(cmd);
      console.log(stdout);
    } catch (err) {
      console.error("Error executing enroll:", err.stderr || err);
    }
  }  
};

async function registerOrderer() {
  const { DOMAIN, NGINX_HTTPS_PORT, RCAADMIN_USER } = process.env;
  const base = process.cwd();

  const Orderers = ["org0-orderer1", "org0-orderer2", "org0-orderer3"];

  for (const od of Orderers){

    const tlsCert = `${base}/build/cas/org0-ca/tlsca-cert.pem`;
    const adminMsp = `${base}/build/enrollments/org0/users/${RCAADMIN_USER}/msp`;

    const cmd = `
      fabric-ca-client register \
        --id.name ${od} \
        --id.secret ordererpw \
        --id.type orderer \
        --url https://org0-ca.${DOMAIN}:${NGINX_HTTPS_PORT} \
        --tls.certfiles ${tlsCert} \
        --mspdir ${adminMsp}
    `;

    try {
      console.log(`Registering ${od}...`);
      const { stdout } = await execAsync(cmd);
      console.log(stdout);
      console.log("Registered org0-orderer1");
    } catch (err) {
      // Handle “already registered”
      if (err.stderr?.includes("already registered") || err.code === 1) {
        console.log(`${od} was already registered — continuing.`);
        return;
      }
      console.error("Registration failed");
      throw err;
    }
  }
  
};

async function enrollOrdererInsidePod() {

   const Orderers = ["org0-orderer1", "org0-orderer2", "org0-orderer3"];

  for (const od of Orderers){

    const podCmd = `
      set -x

      export FABRIC_CA_CLIENT_HOME=/var/hyperledger/fabric-ca-client
      export FABRIC_CA_CLIENT_TLS_CERTFILES=/var/hyperledger/fabric/config/tls/ca.crt

      fabric-ca-client enroll \
        --url https://${od}:ordererpw@org0-ca \
        --csr.hosts org0-orderer \
        --mspdir /var/hyperledger/fabric/organizations/ordererOrganizations/org0.example.com/orderers/${od}.org0.example.com/msp

      # Write config.yaml
      echo "NodeOUs:
        Enable: true
        ClientOUIdentifier:
          Certificate: cacerts/org0-ca.pem
          OrganizationalUnitIdentifier: client
        PeerOUIdentifier:
          Certificate: cacerts/org0-ca.pem
          OrganizationalUnitIdentifier: peer
        AdminOUIdentifier:
          Certificate: cacerts/org0-ca.pem
          OrganizationalUnitIdentifier: admin
        OrdererOUIdentifier:
          Certificate: cacerts/org0-ca.pem
          OrganizationalUnitIdentifier: orderer" > /var/hyperledger/fabric/organizations/ordererOrganizations/org0.example.com/orderers/${od}.org0.example.com/msp/config.yaml
    `;

    try {
      console.log("Executing enrollment inside CA pod...");

      const { stdout } = await execAsync(
        `kubectl -n org0 exec deploy/org0-ca -i -- /bin/sh << 'EOF'\n${podCmd}\nEOF`
      );

      console.log(stdout);
      console.log("Orderer enrollment completed inside CA pod");

    } catch (err) {
      console.error("Enrollment inside CA pod failed");
      console.error(err.stderr || err);
      throw err;
    };
}
};

async function registerPeers() {
  const { DOMAIN, NGINX_HTTPS_PORT, RCAADMIN_USER } = process.env;
  const base = process.cwd();

  const peers = [
    "org1-peer0",  
    "org1-peer1",
    "org2-peer0",
    "org2-peer1"
  ];

  const orga = {
    "org1-peer0": "org1", 
    "org1-peer1": "org1", 
    "org2-peer0": "org2",
    "org2-peer1": "org2"
  };

  const caMap = {
    "org1-peer0": "org1-ca", 
    "org1-peer1": "org1-ca", 
    "org2-peer0": "org2-ca",
    "org2-peer1": "org2-ca"
  };

  for (const peer of peers) {

    const tlsCert = `${base}/build/cas/${caMap[peer]}/tlsca-cert.pem`;
    const adminMsp = `${base}/build/enrollments/${orga[peer]}/users/${RCAADMIN_USER}/msp`;

    const cmd = `
      fabric-ca-client register \
        --id.name ${peer} \
        --id.secret ordererpw \
        --id.type peer \
        --url https://${caMap[peer]}.${DOMAIN}:${NGINX_HTTPS_PORT} \
        --tls.certfiles ${tlsCert} \
        --mspdir ${adminMsp}
    `;

    try {
      console.log(`Registering ${od}...`);
      const { stdout } = await execAsync(cmd);
      console.log(stdout);
      console.log("Registered org0-orderer1");
    } catch (err) {
      // Handle “already registered”
      if (err.stderr?.includes("already registered") || err.code === 1) {
        console.log(`${od} was already registered — continuing.`);
        return;
      }
      console.error("Registration failed");
      throw err;
    }
  }
  
};

async function enrollPeerInsidePod() {

   const peers = [
    "org1-peer0",  
    "org1-peer1",
    "org2-peer0",
    "org2-peer1"
  ];

  const orga = {
    "org1-peer0": "org1", 
    "org1-peer1": "org1", 
    "org2-peer0": "org2",
    "org2-peer1": "org2"
  };

  const caMap = {
    "org1-peer0": "org1-ca", 
    "org1-peer1": "org1-ca", 
    "org2-peer0": "org2-ca",
    "org2-peer1": "org2-ca"
  };

  for (const peer of peers){

    const podCmd = `
      set -x
      export FABRIC_CA_CLIENT_HOME=/var/hyperledger/fabric-ca-client
      export FABRIC_CA_CLIENT_TLS_CERTFILES=/var/hyperledger/fabric/config/tls/ca.crt

      fabric-ca-client enroll \
        --url https://${peer}:peerpw@${caMap[peer]} \
        --csr.hosts localhost,org1-peer,org1-peer-gateway-svc \
        --mspdir /var/hyperledger/fabric/organizations/peerOrganizations/${orga[peer]}.example.com/peers/${peer}.${orga[peer]}.example.com/msp

      # Create local MSP config.yaml
      echo "NodeOUs:
        Enable: true
        ClientOUIdentifier:
          Certificate: cacerts/${caMap[peer]}.pem
          OrganizationalUnitIdentifier: client
        PeerOUIdentifier:
          Certificate: cacerts/${caMap[peer]}.pem
          OrganizationalUnitIdentifier: peer
        AdminOUIdentifier:
          Certificate: cacerts/${caMap[peer]}.pem
          OrganizationalUnitIdentifier: admin
        OrdererOUIdentifier:
          Certificate: cacerts/${caMap[peer]}.pem
          OrganizationalUnitIdentifier: orderer" > /var/hyperledger/fabric/organizations/peerOrganizations/${orga[peer]}.example.com/peers/${peer}.${orga[peer]}.example.com/msp/config.yaml
    `;

    try {
      console.log("Executing enrollment inside CA pod...");

      const { stdout } = await execAsync(
        `kubectl -n ${orga[peer]} exec deploy/${caMap[peer]}-i -- /bin/sh << 'EOF'\n${podCmd}\nEOF`
      );

      console.log(stdout);
      console.log("Orderer enrollment completed inside CA pod");

    } catch (err) {
      console.error("Enrollment inside CA pod failed");
      console.error(err.stderr || err);
      throw err;
    };
}
};

async function setupOrg0Orderers() {
  await registerOrderer();
  await enrollOrdererInsidePod();
};

async function setupOrgPeers() {
  await registerPeers();
  await enrollPeerInsidePod();
};

async function applyOrdererYaml() {

  const orderers = ["org0-orderer1", "org0-orderer2", "org0-orderer3"];

      if(process.env.ORDERER_TYPE === "bft"){
          try {
          const namespace = "org0";
          const yamlPath = `kube/org0/org0-orderer4.yaml`;

          // 1. Read YAML file
          let yamlContent = fs.readFileSync(yamlPath, "utf8");

          // 2. Perform envsubst manually
          yamlContent = yamlContent.replace(/\$\{([^}]+)\}/g, (_, name) => {
            return process.env[name] || "";
          });

          // 3. Apply using kubectl via stdin (-f -)
          const { stdout, stderr } = await execAsync(
            `kubectl -n ${namespace} apply -f -`,
            { input: yamlContent }
          );

          console.log(stdout);
          if (stderr) console.log(stderr);

          console.log(`org0-orderer4.yaml applied successfully`);
        } catch (err) {
            console.error(`Failed to apply org0-orderer4.yaml`);
            console.error(err);
            throw err;
        }
      } 

      for (const orderer of orderers){
          try {
            const namespace = "org0";
            const yamlPath = `kube/org0/${orderer}.yaml`;

            // 1. Read YAML file
            let yamlContent = fs.readFileSync(yamlPath, "utf8");

            // 2. Perform envsubst manually
            yamlContent = yamlContent.replace(/\$\{([^}]+)\}/g, (_, name) => {
              return process.env[name] || "";
            });

            // 3. Apply using kubectl via stdin (-f -)
            const { stdout, stderr } = await execAsync(
              `kubectl -n ${namespace} apply -f -`,
              { input: yamlContent }
            );

            console.log(stdout);
            if (stderr) console.log(stderr);

            console.log(`${orderer}.yaml applied successfully`);
          } catch (err) {
              console.error(`Failed to apply ${orderer}.yaml`);
              console.error(err);
              throw err;
          };
      }; 
  };

const runSetup = async () => {
  
  try {
    console.log("STEP 1: Creating namespace...");
    await createNS();
    console.log("Namespace created\n");

    console.log("STEP 2: Creating PVC...");
    await pvcApply();
    console.log("PVC created\n");

    console.log("STEP 3: Applying nginx ingress...");
    await initIngress();
    console.log("Ingress applied\n");

    console.log("STEP 4: Applying Cert-Manager YAML...");
    await applyYamlFromUrl();
    // console.log("Cert-Manager YAML applied\n");

    console.log("STEP 5: Checking Cert-Manager deployments...");
    await checkCertMgDeployment();
    console.log("Cert-Manager ready\n");

    console.log("STEP 6: Waiting for nginx ingress controller...");
    await waitForNginxIngress();
    console.log("Ingress controller ready\n");

    console.log("STEP 7: Apply PVC to organisational level...");
    await pvcApplyOrg();
    console.log("PVC applied and ready\n");

    console.log("STEP 8: Create configmap for organisations...");
    await recreateConfigMap();
    console.log("PVC applied and ready\n");

    console.log("STEP 9: Initializing TLS certificate Issuers...");
    await initTLSCertIssuers();
    console.log("TLS certificate Issuer Initialized and ready\n");

    console.log("STEP 10: Initializing TLS certificate Issuers...");
    await waitForTLSIssuerReady();
    console.log("TLS certificate Issuer Initialized and ready\n");

    console.log("STEP 10: Generate TLS certificate...");
    await generateTLS();
    console.log("TLS certificate Issuer Initialized and ready\n");

    console.log("STEP 10: Generate TLS certificate...");
    await applyYamlToNamespace("kube/org0/org0-ca.yaml", process.env.ORG0_NS);
    await applyYamlToNamespace("kube/org1/org1-ca.yaml", process.env.ORG1_NS);
    await applyYamlToNamespace("kube/org2/org2-ca.yaml", process.env.ORG2_NS);
    console.log("TLS certificate Issuer Initialized and ready\n");

    console.log("STEP 11: Waiting for CA certificate Issuers...");
    await waitForIssuerReady();
    console.log("CA certificate Issuer Initialized and ready\n");

    console.log("STEP 12: Generate TLS certificate...");
    await applyCAYamlToNamespace("kube/org0/org0-ca.yaml", process.env.ORG0_NS);
    await applyCAYamlToNamespace("kube/org1/org1-ca.yaml", process.env.ORG1_NS);
    await applyCAYamlToNamespace("kube/org2/org2-ca.yaml", process.env.ORG2_NS);
    console.log("DOne\n");

    console.log("STEP 13: Creating directory...");
    fs.mkdir(`${process.cwd()}/build/cas/org0-ca`, { recursive: true }, (err) => {
      if (err) console.log("Error while creating directory org0-ca\n");

    });

    fs.mkdir(`${process.cwd()}/build/cas/org1-ca`, { recursive: true }, (err) => {
      if (err) console.log("Error while creating directory org1-ca\n");
    });

    fs.mkdir(`${process.cwd()}/build/cas/org2-ca`, { recursive: true }, (err) => {
      if (err) console.log("Error while creating directory org2-ca\n");

    });
    console.log("DOne\n");

    
    console.log("STEP 14: Reading CA's TLS certificate from the cert-manager CA secret...");
    await extractCACert(process.env.ORG0_NS, "org0-ca-tls-cert",`${process.cwd()}/build/cas/org0-ca/tlsca-cert.pem`);
    await extractCACert(process.env.ORG0_NS, "org1-ca-tls-cert",`${process.cwd()}/build/cas/org1-ca/tlsca-cert.pem`);
    await extractCACert(process.env.ORG0_NS, "org2-ca-tls-cert",`${process.cwd()}/build/cas/org2-ca/tlsca-cert.pem`);
    console.log("DOne\n");

    console.log("STEP 15: Enrolling root CA Org users...");
    await enrollOrgCA()
    console.log("DOne\n");

    console.log("STEP 16: Setup Org0 Orderers...");
    await setupOrg0Orderers()
    console.log("DOne\n");

    console.log("STEP 17: Setup Org Peers...");
    await setupOrgPeers()
    console.log("DOne\n");

    console.log("STEP 18: Apply Orderer Yaml...");
    await applyOrdererYaml()
    console.log("DOne\n");

    console.log("\n🎉 ALL STEPS COMPLETED SUCCESSFULLY!\n");

  } catch (err) {
    console.error("SETUP FAILED:", err);
    process.exit(1);
  }
};

module.exports = {
    applyYamlFromUrl, 
    initIngress,
    createNS,
    pvcApply,
    checkCertMgDeployment,
    waitForNginxIngress,
    recreateConfigMap,
    initTLSCertIssuers,
    waitForTLSIssuerReady,
    waitForIssuerReady,
    generateTLS,
    waitForGeneratedIssuerReady,
    applyYamlToNamespace,
    applyCAYamlToNamespace,
    extractCACert,
    enrollOrgCA,
    setupOrg0Orderers,
    setupOrgPeers,
    applyOrdererYaml,
    runSetup
};