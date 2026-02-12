const k8s = require('@kubernetes/client-node');
const {PatchUtils} = k8s;
const fs = require('fs');
const fsp = require('fs/promises');
const path = require("path");
const os = require("os");
const yaml = require('js-yaml');
const axios = require('axios');
const { getType, sleep } = require('./utils/helper');
const { exec, execSync } = require("child_process");
const util = require("util");
const { spawn } = require("child_process");
const tar = require("tar");
const crypto = require("crypto");

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

const client = k8s.KubernetesObjectApi.makeApiClient(kc);
const customApi = kc.makeApiClient(k8s.CustomObjectsApi);
const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
const k8sApi2 = kc.makeApiClient(k8s.AppsV1Api);

const execAsync = util.promisify(exec);

//<=============== Network setup starts ========================>//

const CLUSTER_NAME = process.env.CLUSTER_NAME;   // change if needed
const regName = "kind-registry";     // your registry container name
const regPort = 5000;                // registry port
const LOCAL_REGISTRY_INTERFACE = "127.0.0.1"; // or 0.0.0.0

function shOutput(cmd) {
  return execSync(cmd, { encoding: "utf-8" }).trim();
}

function sh(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

const preStartUpConfig = async () => {
  // 1. Get kind node container names
  const nodes = execSync(
    `kind get nodes --name ${CLUSTER_NAME}`,
    { encoding: "utf-8" }
  )
    .trim()
    .split("\n");

  if (!nodes.length) {
    throw new Error("No kind nodes found");
  }

  // 2. Configure containerd registry on each node
  for (const node of nodes) {
    // create directory
    sh(`docker exec ${node} mkdir -p /etc/containerd/certs.d/localhost:${regPort}`);

    // write hosts.toml
    const toml = `
      server = "http://localhost:${regPort}"

      [host."http://${regName}:${regPort}"]
        capabilities = ["pull", "resolve", "push"]
    `.trim();

    sh(
      `docker exec ${node} sh -c 'cat > /etc/containerd/certs.d/localhost:${regPort}/hosts.toml <<EOF
        ${toml}
        EOF'`
    );

    console.log("Registry configured for all kind nodes");
    console.log("Restarting containerd");

    sh(`docker exec ${node} systemctl restart containerd || true`);
}

};


const launchDockerRegistry = async () => {
  console.log(
    `Launching container registry "${regName}" at localhost:${regPort}`
  );

  // 1. Check if registry container is running
  let running = "";
  try {
    running = shOutput(`docker inspect -f '{{.State.Running}}' ${regName}`);
  } catch {
    running = "false";
  }

  // 2. Start registry if not running
  if (running !== "true") {
    sh(`docker run \
        --detach \
        --restart always \
        --name ${regName} \
        --publish ${LOCAL_REGISTRY_INTERFACE}:${regPort}:5000 \
        registry:2
          `.trim());
  }

  // 3. Connect registry to kind network
  // (ignore error if already connected)
  try {
    sh(`docker network connect kind ${regName}`);
  } catch {
    console.log("Registry already connected to kind network");
  }

    
  const filePath = path.join(__dirname, "..", "kube", "launch-docker-registry.yaml");

  sh(`kubectl apply -f ${filePath}`);

  console.log("Local Docker registry ready");
}

const initIngress = async () => {
    try {
        // Load YAML
        const content = fs.readFileSync("./kube/ingress-nginx-kind.yaml", 'utf8');
        const objects = yaml.loadAll(content);

        for (let obj of objects) {

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
                
                    await client.patch( 
                        obj,  
                        undefined,
                        {
                            headers: { "Content-Type": "application/merge-patch+json" }
                        });

                } else {
                    console.error("Failed to install ingress");
                    // console.error("Failed:", err);
                }
            }
        }

    } catch (err) {
        // console.err("Ingress initialization failed:", err); // To check the error message
        console.log("Ingress initialization failed");
    }
};

async function applyYamlFromUrl() {
// async function applyYamlFromUrl(timeoutMs = 5 * 60 * 1000, retryInterval = 2 * 60 * 1000) {
  // const endTime = Date.now() + timeoutMs;

  // const url = process.env.CERT_MANAGER_YAML;

  // while (Date.now() < endTime) {
  //   console.log(`Downloading YAML from ${url}...`);
  //   const cmd = `kubectl apply -f ${url}`;

  //   try {
  //     const { stdout } = await execAsync(cmd, { stdio: "inherit" });
  //     console.log(stdout);
  //     return stdout;
      
  //   } catch (err) {
  //     console.error("Error executing enroll:", err.stderr || err);
  //     await new Promise(r => setTimeout(r, retryInterval));
  //   }
  // }
  
  const filePath = path.join(__dirname, "..", "kube", "cert-manager.yaml");
  // console.log(filePath);
  const cmd = `kubectl apply -f ${filePath}`;

    try {
      const { stdout } = await execAsync(cmd);
      console.log(stdout);
      return stdout;
      
    } catch (err) {
      console.error("Error applying cert-manager:", err.stderr || err);
    }
  };

const createNS = async () => {
  const nsName = 'duction';
  
  try {
    // List existing namespaces
    const existingResponse = await k8sApi.listNamespace();
    // console.log("This is from ns: ", existingResponse.items)

    const existingNamespaces = existingResponse.items || [];

    const exists = existingNamespaces.some(ns => ns.metadata.name === nsName);

    if (exists) {

      console.log(`Namespace "${nsName}" already exists, skipping creation.`);
      return;
    };

      // Create new namespace
    const namespaceManifest = {
        apiVersion: "v1",
        kind: "Namespace",
        metadata: { name: nsName }
    };

    const createdNamespace = await k8sApi.createNamespace(namespaceManifest);

    console.log('New namespace created:', createdNamespace.body.metadata.name);
    return;

  } catch (err) {
    const reason = err?.response?.body?.reason;
    const code   = err?.response?.body?.code;

    if(reason === "AlreadyExists" && code === 409 ){
      // console.error('Error creating namespace');
      console.log(`Namespace "${nsName}" already exists, skipping creation.`);
      return;
    }

     console.error("Unexpected error creating namespace:", err);
  }
};

const createOrgNS = async () => {
  const organisation = ["org0", "org1", "org2"]
  
  for(let ord of organisation) {
    const nsName = ord;
    try {
      // List existing namespaces
      const existingResponse = await k8sApi.listNamespace();
    
      const existingNamespaces = existingResponse.items || [];

      const exists = existingNamespaces.some(ns => ns.metadata.name === nsName);

      if (exists) {
        console.log(`Namespace "${nsName}" already exists, skipping creation.`);
        return;
      } 
        // Create new namespace
      const namespaceManifest = {
        apiVersion: "v1",
        kind: "Namespace",
        metadata: { name: nsName }
      };

      const createdNamespace = await k8sApi.createNamespace(namespaceManifest);
      console.log('New namespace created:', createdNamespace.body.metadata.name);

    } catch (err) {
      const reason = err?.body?.reason;
      const code   = err?.body?.code;

      if(reason === "AlreadyExists" && code === 409 ){
          console.log(`Namespace "${nsName}" already exists, skipping creation.`);
        }
    }
  }
};

// Load PV YAML files
const pvFiles = [
  './kube/pv-fabric-org0.yaml',
  './kube/pv-fabric-org1.yaml',
  './kube/pv-fabric-org2.yaml'
];

const pvDps = pvFiles.map(f => {
  const content = fs.readFileSync(f, 'utf8');
  const obj = yaml.load(content);
  // obj.metadata.namespace = 'duction';
  return obj;
})

const pvApply = async () => {
  for (let i = 0; i < pvDps.length; i++) {

    try {

      await client.create(pvDps[i]);
      console.log(`Resource created: ${dps[i].metadata.name}`);
      return;

    } catch (err) {

      if (err.body && err.body.reason === 'AlreadyExists') {
        try {
        
          await client.patch(
          //   pvDps[i],
          //   name, 
          //   // namespace,
          //   undefined,
          //   undefined,
          //   undefined,
          //   {
          //       headers: { "Content-Type": "application/merge-patch+json" }
          //   });

            {
              apiVersion: pvDps[i].apiVersion,
              kind: pvDps[i].kind,
              metadata: { 
                name: pvDps[i].metadata.name, 
              }
            },
            pvDps[i],
            undefined,
            undefined,
            undefined,
            {
              headers: { "Content-Type": "application/merge-patch+json" }
            }
          );

          console.log(`Resource patched: ${pvDps[i].metadata.name}`);
          
        } catch (patchErr) {
          // console.error(`Failed to patch ${pvDps[i].metadata.name}, ${pvDps[i].metadata.name} already exist`);
          console.error(`Failed to patch ${pvDps[i].metadata.name}:`, patchErr.body || patchErr);
        }
      } else {
        console.error(`${pvDps[i].metadata.name} already exist`);
        // console.error(`Failed to create ${dps[i].metadata.name}:`, err.body || err);
      }
    }
  }
};

const pvcApplyOrg = async () => {
  const files = [
    "./kube/pvc-fabric-org0.yaml",
    "./kube/pvc-fabric-org1.yaml",
    "./kube/pvc-fabric-org2.yaml",
  ];

  await createOrgNS();
  await sleep(1 * 60 * 1000);

  for (let file of files) {
    const docs = yaml.loadAll(fs.readFileSync(file, "utf8"));
    const body = docs.find(d => d && d.kind === "PersistentVolumeClaim");

    const name = body.metadata.name;
    const namespace = body.metadata.namespace; 

    try {
      
      await k8sApi.createNamespacedPersistentVolumeClaim(namespace, body);
      console.log(`PVC created: ${name}`);

    } catch (err) {
      const body = err.response?.body;

      if (body?.reason === "AlreadyExists") {
        try {
          
          console.log(`PVC already exists: ${name} — skipping`);
          continue;

          // await sleep(3000);

          // await k8sApi.createNamespacedPersistentVolumeClaim(namespace, body);
          // await k8sApi.patchNamespacedPersistentVolumeClaim(
          //   {
          //     apiVersion: body.apiVersion,
          //     kind: body.kind,
          //     metadata: { 
          //       name: body.metadata.name, 
          //     }
          //   },
          //   name,
          //   namespace,
          //   body,
          //   undefined,
          //   undefined,
          //   undefined,
          //   {
          //     headers: { "Content-Type": "application/merge-patch+json" },
          //   }
          // );

          // console.log(`PVC patched: ${name}`);

        } catch (patchErr) {
          console.log(`Failed to skip ${name}:`, patchErr.response?.body || patchErr);
        }
      } else {
        console.log(`${name} already exsit in the cluster`);
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

  for (let name of deployments) {
    console.log(`Checking deployment: ${name}`);
    // console.log(getType(name));

    const timeoutMs = 2 * 60 * 1000; // 2 minutes
    const intervalMs = 1 * 60 * 1000;; // Check every 1 min
    const endTime = Date.now() + timeoutMs;

    while (Date.now() < endTime) {
      try {
        // Must pass name and namespace as direct args
        const res = await k8sApi2.readNamespacedDeployment(name, namespace);
        // console.log(res.body);
        // console.log(res.body.status);

        const status = res.body.status;
        const ready = status.readyReplicas || 0;
        const desired = status.replicas || 0;

        console.log(`${name}: ${ready}/${desired} ready`);

        if (desired > 0) {
          console.log(`${name} rollout complete`);
          break; // move to next deployment
        } else {
          console.log(`⏳ ${name} initializing...`);
        }

      } catch (err) {
        // Deployment not created yet
        const parsedErr = err.body || "{}";
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

  const timeoutMs = 5 * 60 * 1000; // 5 minutes
  const intervalMs = 2 * 60 * 1000; // 2 minutes
  const endTime = Date.now() + timeoutMs;

  console.log("Waiting for NGINX ingress controller pod to become Ready...");

  while (Date.now() < endTime) {
    const res = await k8sApi.listNamespacedPod(
      namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      selector );

    // console.log("From waiting from ingress: ", res.items)

    // console.log(res.body);
    
    if (res.body.items.length === 0) {
      console.log("No controller pods found yet...");
    }

    for (let pod of res.body.items) {
      // console.log("from ingresss:", pod.status.conditions);
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

  console.log(`Timeout: NGINX ingress controller pod did not become Ready within ${timeoutMs} minutes`);
};

async function recreateConfigMap() {
  const orgs = [
    { name: "org0", namespace: "org0", folder: "config/org0" },
    { name: "org1", namespace: "org1", folder: "config/org1" },
    { name: "org2", namespace: "org2", folder: "config/org2" }
  ];

  for (const org of orgs) {
    const configMapName = `${org.name}-config`;
    const data = {};

    if (!fs.existsSync(org.folder)) {
      console.log(`Config folder missing: ${org.folder}`);
    }

    const files = fs.readdirSync(org.folder);

    for (const file of files) {
      const fullPath = path.join(org.folder, file);
      if (fs.lstatSync(fullPath).isFile()) {
        data[file] = fs.readFileSync(fullPath, "utf8");
      }
    }

    //HARD REQUIREMENTS
    if (!data["core.yaml"] && org.name !== "org0") {
      console.log(`core.yaml missing for ${org.name}`);
    }

    if (org.name === "org0" && !data["orderer.yaml"]) {
      console.log(`orderer.yaml missing for org0`);
    }

    const body = {
      metadata: { name: configMapName },
      data
    };

    try {
      await k8sApi.deleteNamespacedConfigMap(configMapName, org.namespace);
      console.log(`Deleted existing ConfigMap: ${configMapName}`);
    } catch (_) {}

    await k8sApi.createNamespacedConfigMap(org.namespace, body);
    console.log(`Created ConfigMap: ${configMapName}`);
  }
}

async function initTLSCertIssuers() {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();

  const customApi = kc.makeApiClient(k8s.CustomObjectsApi);
  const namespaces = ['org0', 'org1', 'org2'];

  const filePath = "/home/osemu/projects/duction/kube/root-tls-cert-issuer.yaml";
  const base = yaml.load(fs.readFileSync(filePath, "utf8"));

  for (let ns of namespaces) {
    try {
      const issuer = JSON.parse(JSON.stringify(base)); // deep clone
      // console.log("TLS roote issure:", issuer)
      issuer.metadata.namespace = ns;

      // console.log('CustomObjectsApi:', typeof customApi);
      // console.log('Functions:', Object.keys(customApi));

      await customApi.createNamespacedCustomObject(
        "cert-manager.io",   // group
        "v1",                // version
        ns,                  // namespace
        "issuers",           // plural
        issuer               // body
      );

      console.log(`Created Issuer in namespace: ${ns}`);

    } catch (err) {

      console.error(`Error creating issuer in ${ns}: `, err.message);
    }
  }
};

async function waitForTLSIssuerReady(timeoutMs = 30000, intervalMs = 2000) {
  const issuerName = "root-tls-cert-issuer";

  const namespaces = ["org0", "org1", "org2"];

  for (let ns of namespaces) {
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
       console.log(`Timeout: Issuer "${issuerName}" not Ready in namespace ${ns}`);
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

  for (let namespace of ns){

    try {
          let yamlFilePath = path.join(__dirname,`../kube/${namespace}/${namespace}-tls-cert-issuer.yaml`);
          console.log(`Applying: ${yamlFilePath}`);

          const fileContent = fs.readFileSync(yamlFilePath, "utf8");
          const docs = yaml.loadAll(fileContent);

          for (const doc of docs) {
            // Ensures namespace is set
            if (!doc.metadata.namespace) {
              doc.metadata.namespace = namespace;
            }

            await client.create(doc);
            console.log(`Created ${doc.kind}: ${doc.metadata.name}`);
          }
        } catch (err) {
          console.error("TLS creation error:", err.body.reason || err.body.status);
      };  
  };
};

async function waitForGeneratedIssuerReady(timeoutMs = 30000, intervalMs = 2000) {
  const issuerMap = {
    org0: "org0-tls-cert-issuer",
    org1: "org1-tls-cert-issuer",
    org2: "org2-tls-cert-issuer"
  };

  const namespaces = ["org0", "org1", "org2"];

  for (let ns of namespaces) {
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

async function waitForIssuerReady(timeoutMs = 30000, intervalMs = 2000) {
  

  const namespaces = ["org0", "org1", "org2"];

  for (let ns of namespaces) {
    console.log(`\n=== Checking Issuer in namespace: ${ns} ===`);

    const start = Date.now();  // timeout resets for each namespace

    let issuerName = `${ns}-tls-cert-issuer`;

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

const applyCAYamlToNamespace = async (filePath, _namespace) => {
  try {
    // 1. Read the YAML file
    let content = fs.readFileSync(filePath, "utf8");

    // 2. ENV substitution (simple envsubst)
    // content = content.replace(/\$\w+/g, (envVar) => process.env[envVar.slice(1)] || "");
    content = content.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] || "");


    // 3. Parse YAML into multiple docs (if `---`)
    const docs = yaml.loadAll(content);

    // 4. Apply each YAML object
    for (let doc of docs) {
      if (!doc || !doc.kind) continue;

       if (!doc.metadata) doc.metadata = {};
        doc.metadata.namespace = _namespace;
        // console.log(doc);

      try {
        await client.create(doc);
        console.log(`Created ${doc.kind}: ${doc.metadata.name} in ${_namespace}`);

      } catch (err) {
        // Patch if already exists
        const parsed = err.body;
        if (parsed?.reason === "AlreadyExists" || err.body?.includes?.("AlreadyExists")){
           await client.patch(
            {
              apiVersion: doc.apiVersion,
              kind: doc.kind,
              metadata: { 
                name: doc.metadata.name, 
                namespace: _namespace 
              }
            },
            doc,
            undefined,
            undefined,
            undefined,
            {
              headers: { "Content-Type": "application/merge-patch+json" }
            }
          );

          console.log(`Patched ${doc.kind}: ${doc.metadata.name}`);
        } else {
          console.log(err.message);
          // console.log(parsed);
        }
      }
    }

  } catch (e) {
    console.error("Error applying YAML:", e.message);
    // throw e;
  }
};

const checkCADeployment = async () => {
  const organisations = ["org0", "org1", "org2"];
  const intervalMs = 60_000; // 1 minute

  for (const org of organisations) {
    const url = `https://${org}-ca.localho.st:443/cainfo`;
    const cmd = `curl -sk ${url}`;

    try {
      const { stdout } = await execAsync(cmd);

      console.log(`CA reachable for ${org}`);
      console.log(stdout);

    } catch (err) {
      console.error(`CA NOT reachable for ${org}`);
      console.error(err.stderr || err.message);
    }

    await new Promise(r => setTimeout(r, intervalMs));
  }
};

// This function below contain code on how to executr CLI commands in nodejs...if large process CLI command, use swamp
async function extractCACert(namespace, secretName, outputPath) {
  try {
    // Get Secret JSON from Kubernetes
    const { stdout } = await execAsync(
      `kubectl -n ${namespace} get secret ${secretName} -o json`
    );

    // Parse JSON
    const secret = JSON.parse(stdout);
    // console.log("From extractCACert: ", secret.data);

    if (!secret.data || !secret.data["ca.crt"]) {
      throw new Error("ca.crt not found in secret");
    }

    // Base64 decode
    const decoded = Buffer.from(secret.data["ca.crt"], "base64");

    // Write file
    // await fs.writeFile(outputPath, decoded);
    await fsp.writeFile(outputPath, decoded);

    // await fs.writeFile(outputPath, decoded, (err) => {
    //   if (err) {
    //   console.log('Error writing file:', err);
    //   } else {
    //   console.log('File written successfully');
    //   }
    // });

    console.log(`Extracted CA cert → ${outputPath}`);
  } catch (err) {
    console.error("Error extracting CA cert:", err);
  }
};

// const pathsToCheck = [
//       "/usr/local/bin/fabric-ca-client",
//       "/mnt/c/Users/HP/bin/fabric-ca-client"
//     ];

// let caClientPath = pathsToCheck.find(p => fs.existsSync(p));

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

  for (let c of ca) {

    const url = `https://${process.env.RCAADMIN_USER}:${process.env.RCAADMIN_PASS}@${c}.${process.env.DOMAIN}:${process.env.NGINX_HTTPS_PORT}`;
    const tlsFile = `${base}/build/cas/${c}/tlsca-cert.pem`;
    const mspDir = `${base}/build/enrollments/${orgMap[c]}/users/${process.env.RCAADMIN_USER}/msp`;

    const caClientPath = path.join(base, "bin", "fabric-ca-client");

    // Safety check
    await execAsync(`chmod +x ${caClientPath}`);
    
    // if (!caClientPath) console.log("fabric-ca-client not found");
    // console.log("This is the caClientPath: ", caClientPath)

    const cmd = `${caClientPath} enroll \
      --url ${url} \
      --tls.certfiles ${tlsFile} \
      --mspdir ${mspDir}`;

    try {
      const result = await execAsync(cmd);
      console.log("From exec command enroll CA: ", result);

      if(result.stderr){
        console.log("Error from exec command enroll CA: ", result.stderr);
      }

    } catch (err) {
      console.error("Error executing enroll:", err.stderr);
      // console.error("Error executing enroll:", err.stderr || err);
    }
  }  
};

async function registerOrderer() {
  const { DOMAIN, NGINX_HTTPS_PORT, RCAADMIN_USER } = process.env;
  const base = process.cwd();

  const Orderers = ["org0-orderer1", "org0-orderer2", "org0-orderer3"];

  for (let od of Orderers){

    const tlsCert = `${base}/build/cas/org0-ca/tlsca-cert.pem`;
    const adminMsp = `${base}/build/enrollments/org0/users/${RCAADMIN_USER}/msp`;

    //  if (!caClientPath) console.log("fabric-ca-client not found");
    // // console.log("This is the caClientPath: ", caClientPath)

    const caClientPath = path.join(base, "bin", "fabric-ca-client");

    // Safety check
    await execAsync(`chmod +x ${caClientPath}`);

    const cmd = `${caClientPath} register \
        --id.name ${od} \
        --id.secret ordererpw \
        --id.type orderer \
        --url https://org0-ca.${DOMAIN}:${NGINX_HTTPS_PORT} \
        --tls.certfiles ${tlsCert} \
        --mspdir ${adminMsp}`;

    try {
      console.log(`Registering ${od}...`);
      const { stdout } = await execAsync(cmd);
      // console.log(stdout);
      console.log(`Registered ${od}`);
    } catch (err) {
      // Handle “already registered”
      if (err.stderr?.includes("already registered")) {
        console.log(`${od} was already registered — continuing.`);
      }else{
        console.error("Registration failed: ", err.stderr);
      }
    }
  }
  
};

async function enrollOrdererInsidePod() {

   const Orderers = ["org0-orderer1", "org0-orderer2", "org0-orderer3"];

  for (let od of Orderers){

    // if (!caClientPath) console.log("fabric-ca-client not found");

    const podCmd = `
      set -x
      export FABRIC_CA_CLIENT_HOME=/var/hyperledger/fabric-ca-client
      export FABRIC_CA_CLIENT_TLS_CERTFILES=/var/hyperledger/fabric/config/tls/ca.crt

      MSP_DIR=/var/hyperledger/fabric/organizations/ordererOrganizations/org0.example.com/orderers/${od}.org0.example.com/msp

      mkdir -p $MSP_DIR

      fabric-ca-client enroll \
        --url https://${od}:ordererpw@org0-ca \
        --csr.hosts org0-orderer \
        --mspdir $MSP_DIR

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
      console.log(`Executing enrollment of ${od} inside pod...`);

      const com = `kubectl -n org0 exec deploy/org0-ca -i -- /bin/sh << 'EOF'\n${podCmd}\nEOF`;

      const { stdout } = await execAsync(com);
      console.log("Orderer enrollment completed inside pod");

    } catch (err) {
      console.log("Enrollment inside CA pod failed ", err.stderr);
      // throw err;
    };
}
};

async function registerPeers() {
  const { DOMAIN, NGINX_HTTPS_PORT, RCAADMIN_USER } = process.env;
  const base = process.cwd();

  const peers = [
    "org1-peer1",  
    "org1-peer2",
    "org2-peer1",
    "org2-peer2"
  ];

  const orga = {
    "org1-peer1": "org1", 
    "org1-peer2": "org1", 
    "org2-peer1": "org2",
    "org2-peer2": "org2"
  };

  const caMap = {
    "org1-peer1": "org1-ca", 
    "org1-peer2": "org1-ca", 
    "org2-peer1": "org2-ca",
    "org2-peer2": "org2-ca"
  };

  for (let peer of peers) {

    const tlsCert = `${base}/build/cas/${caMap[peer]}/tlsca-cert.pem`;
    const adminMsp = `${base}/build/enrollments/${orga[peer]}/users/${RCAADMIN_USER}/msp`;

    const caClientPath = path.join(base, "bin", "fabric-ca-client");

    // Safety check
    await execAsync(`chmod +x ${caClientPath}`);

    const cmd = `${caClientPath} register \
        --id.name ${peer} \
        --id.secret peerpw \
        --id.type peer \
        --url https://${caMap[peer]}.${DOMAIN}:${NGINX_HTTPS_PORT} \
        --tls.certfiles ${tlsCert} \
        --mspdir ${adminMsp}`;

    try {
      const { stdout } = await execAsync(cmd);
      // console.log(stdout);
      console.log(`Registered ${peer}`);
    } catch (err) {
      // Handle “already registered”
      if (err.stderr?.includes("already registered")) {
        console.log(`${peer} was already registered — continuing.`);
      } else{
        console.error("Registration failed: ", err);
      }
    }
  }
  
};

async function mountMSPConfig() {

  const caMap = {
    "org1-peer1": "org1", 
    "org1-peer2": "org1", 
    "org2-peer1": "org2",
    "org2-peer2": "org2"
  };

  const orgPeers = [
    "org1-peer1",  
    "org1-peer2",
    "org2-peer1",
    "org2-peer2"
  ];

  for (const peer of orgPeers) {

    const localFile = path.join(__dirname, "..", "kube", caMap[peer], "msp-config.yaml" );

    const cmd = `kubectl -n ${caMap[peer]} create configmap ${peer}-msp-config --from-file=config.yaml=${localFile} --dry-run=client -o yaml | kubectl apply -f - `;

    try {
      const { stdout, stderr } = await execAsync(cmd);

      if (stdout) {
        console.log(`[${caMap[peer]}] MSP ConfigMap applied:\n`, stdout);
      }

      if (stderr) {
        console.error(`[${caMap[peer]}] STDERR:\n`, stderr);
      }

    } catch (err) {
      console.error(`[${caMap[peer]}] Failed to apply MSP ConfigMap`, err);
      throw err;
    }
  }
}

async function enrollPeerInsidePod() {

  const peers = [
    "org1-peer1",  
    "org1-peer2",
    "org2-peer1",
    "org2-peer2"
  ];

  const orga = {
    "org1-peer1": "org1", 
    "org1-peer2": "org1", 
    "org2-peer1": "org2",
    "org2-peer2": "org2"
  };

  const caMap = {
    "org1-peer1": "org1-ca", 
    "org1-peer2": "org1-ca", 
    "org2-peer1": "org2-ca",
    "org2-peer2": "org2-ca"
  };

  for (let peer of peers){

    switch(peer) {
      case "org1-peer1":

        const podCmd1 = `
          set -x
          export FABRIC_CA_CLIENT_HOME=/var/hyperledger/fabric-ca-client
          export FABRIC_CA_CLIENT_TLS_CERTFILES=/var/hyperledger/fabric/config/tls/ca.crt

          MSP_DIR1=/var/hyperledger/fabric/organizations/peerOrganizations/org1.example.com/peers/org1-peer1.org1.example.com/msp

          mkdir -p "$MSP_DIR1"

          fabric-ca-client enroll \
            --url https://org1-peer1:peerpw@org1-ca \
            --csr.hosts localhost,org1-peer,org1-peer-gateway-svc \
            --mspdir "$MSP_DIR1"
          `;

        try {
          const ocm1 =  `kubectl -n org1 exec deploy/org1-ca -i -- /bin/sh << 'EOF'\n${podCmd1}\nEOF`

          const stdout1 = await execAsync(ocm1);

        if (stdout1.stdout){
            console.log("stdout result: ", stdout1.stdout);
          };

        if (stdout1.stderr){
            console.log("stderr result:", stdout1.stderr);
          };

          console.log(`Peer ${peer} enrollment completed inside CA pod`);

        } catch (err) {
          console.error("Enrollment inside CA pod failed ", err);
        };

        // const localFile1 = path.join(__dirname, "..", "kube", "org1", "msp-config.yaml");

        // const podCmdNew = `kubectl -n org1 get pod -l app=org1-ca -o jsonpath='{.items[0].metadata.name}'`;

        // const { stdout: podName } = await execAsync(podCmdNew);

        // const cmd1 = `
        //   kubectl -n org1 cp ${localFile1} ${podName}:/tmp/msp-config.yaml && kubectl -n org1 exec ${podName} -- sh -c 'cp /tmp/msp-config.yaml /var/hyperledger/fabric/organizations/peerOrganizations/org1.example.com/peers/org1-peer1.org1.example.com/msp'
        // `;

        // const rr = await execAsync(cmd1);
        // console.log(rr);

      break;

      case "org1-peer2":

        const podCmd2 = `
          set -x
          export FABRIC_CA_CLIENT_HOME=/var/hyperledger/fabric-ca-client
          export FABRIC_CA_CLIENT_TLS_CERTFILES=/var/hyperledger/fabric/config/tls/ca.crt

          MSP_DIR2=/var/hyperledger/fabric/organizations/peerOrganizations/org1.example.com/peers/org1-peer2.org1.example.com/msp

          mkdir -p "$MSP_DIR2"

          fabric-ca-client enroll \
            --url https://org1-peer2:peerpw@org1-ca \
            --csr.hosts localhost,org1-peer,org1-peer-gateway-svc \
            --mspdir "$MSP_DIR2"
          `;

        try {
          const ocm2 =  `kubectl -n org1 exec deploy/org1-ca -i -- /bin/sh << 'EOF'\n${podCmd2}\nEOF`

          const stdout1 = await execAsync(ocm2);

        // if (stdout1.stderr){
        //     console.log("stderr:", stdout1.stderr);
        //   };

          // console.log(`Peer ${peer} enrollment completed inside CA pod`);

        } catch (err) {
          console.error("Enrollment inside CA pod failed ", err);
        };

        // const localFile2 = path.join(__dirname, "..", "kube", "org1", "msp-config.yaml");

        // const podCmdNew2 = `kubectl -n org1 get pod -l app=org1-ca -o jsonpath='{.items[0].metadata.name}'`;

        // const { stdout: podName2 } = await execAsync(podCmdNew2);

        // const cmd2 = `
        //   kubectl -n org1 cp ${localFile2} ${podName2}:/tmp/config.yaml && kubectl -n org1 exec ${podName2} -- sh -c 'cp /tmp/config.yaml /var/hyperledger/fabric/organizations/peerOrganizations/org1.example.com/peers/org1-peer2.org1.example.com/msp/config.yaml'
        // `;

        // await execAsync(cmd2);

      break;

      case "org2-peer1":

        const podCmd3 = `
          set -x
          export FABRIC_CA_CLIENT_HOME=/var/hyperledger/fabric-ca-client
          export FABRIC_CA_CLIENT_TLS_CERTFILES=/var/hyperledger/fabric/config/tls/ca.crt

          MSP_DIR3=/var/hyperledger/fabric/organizations/peerOrganizations/org2.example.com/peers/org2-peer1.org2.example.com/msp

          mkdir -p "$MSP_DIR3"

          fabric-ca-client enroll \
            --url https://org2-peer1:peerpw@org2-ca \
            --csr.hosts localhost,org2-peer,org2-peer-gateway-svc \
            --mspdir "$MSP_DIR3"
          `;

        try {
          const ocm3 =  `kubectl -n org2 exec deploy/org2-ca -i -- /bin/sh << 'EOF'\n${podCmd3}\nEOF`

          const stdout1 = await execAsync(ocm3);

        // if (stdout1.stderr){
        //     console.log("stderr:", stdout1.stderr);
        //   };

          // console.log(`Peer ${peer} enrollment completed inside CA pod`);

        } catch (err) {
          console.error("Enrollment inside CA pod failed ", err);
        };

        // const localFile3 = path.join(__dirname, "..", "kube", "org2", "msp-config.yaml");

        // const podCmdNew3 = `kubectl -n org2 get pod -l app=org2-ca -o jsonpath='{.items[0].metadata.name}'`;

        // const { stdout: podName3 } = await execAsync(podCmdNew3);

        // const cmd3 = `
        //   kubectl -n org2 cp ${localFile3} ${podName3}:/tmp/config.yaml && kubectl -n org2 exec ${podName3} -- sh -c 'cp /tmp/config.yaml /var/hyperledger/fabric/organizations/peerOrganizations/org2.example.com/peers/org2-peer1.org2.example.com/msp/config.yaml'
        // `;

        // await execAsync(cmd3);

      break;

      case "org2-peer2":

        const podCmd4 = `
          set -x
          export FABRIC_CA_CLIENT_HOME=/var/hyperledger/fabric-ca-client
          export FABRIC_CA_CLIENT_TLS_CERTFILES=/var/hyperledger/fabric/config/tls/ca.crt

          MSP_DIR4=/var/hyperledger/fabric/organizations/peerOrganizations/org2.example.com/peers/org2-peer2.org2.example.com/msp

          mkdir -p "$MSP_DIR4"

          fabric-ca-client enroll \
            --url https://org2-peer2:peerpw@org2-ca \
            --csr.hosts localhost,org2-peer,org2-peer-gateway-svc \
            --mspdir "$MSP_DIR4"
          `;

        try {
          const ocm4 =  `kubectl -n org2 exec deploy/org2-ca -i -- /bin/sh << 'EOF'\n${podCmd4}\nEOF`

          const stdout1 = await execAsync(ocm4);

        if (stdout1.stderr){
            console.log("org2-peer2 stderr:", stdout1.stderr);
          };

          // console.log(`Peer ${peer} enrollment completed inside CA pod`);

        } catch (err) {
          console.error("Enrollment inside CA pod failed ", err);
        };

        // const localFile4 = path.join(__dirname, "..", "kube", "org2", "msp-config.yaml");

        // const podCmdNew4 = `kubectl -n org2 get pod -l app=org2-ca -o jsonpath='{.items[0].metadata.name}'`;

        // const { stdout: podName4 } = await execAsync(podCmdNew4);

        // const cmd4 = `
        //   kubectl -n org2 cp ${localFile4} ${podName4}:/tmp/config.yaml && kubectl -n org2 exec ${podName4} -- sh -c 'cp /tmp/config.yaml /var/hyperledger/fabric/organizations/peerOrganizations/org2.example.com/peers/org2-peer2.org2.example.com/msp/config.yaml'
        // `;

        // await execAsync(cmd4);

      break;

    }  
}
};

async function setupOrg0Orderers() {
  await registerOrderer();
  await enrollOrdererInsidePod();
};

async function setupOrgPeers() {
  await registerPeers();
  await enrollPeerInsidePod();
  await mountMSPConfig();
};


const applyCertificate = async (yamlPath, namespace) => {
  try{
    const yamlContent = fs.readFileSync(yamlPath, "utf8").replace(
      /\$\{([^}]+)\}/g,
      (_, name) => process.env[name] || ""
    );
    const out = await kubectlApplyFromString(yamlContent, namespace);

    console.log("Certificate applied: ", out);
  }catch(err){
    console.log(`Certificate application failed in ${namespace}: `, err.message);
  }
};

const waitForTLSSecret = async (secretName, namespace, timeout = "180s") => {

  const cmd = `kubectl wait \
      --for=condition=Ready \
      certificate/${secretName} \
      -n ${namespace} \
      --timeout=${timeout}
    `;

  await execAsync(cmd);
  console.log(`TLS certificate ${secretName} is Ready`);
};

function kubectlApplyFromString(yaml, namespace) {
  return new Promise((resolve, reject) => {
    const kubectl = spawn("kubectl", ["-n", namespace, "apply", "-f", "-"]);

    let stdout = "";
    let stderr = "";

    kubectl.stdout.on("data", d => stdout += d.toString());
    kubectl.stderr.on("data", d => stderr += d.toString());

    kubectl.on("close", code => {
      if (code !== 0) {
        reject(new Error(stderr));
      } else {
        resolve(stdout);
      }
    });

    kubectl.stdin.write(yaml);
    kubectl.stdin.end();
  });
}

const applyOrdererYaml = async () => {

  const orderers = ["org0-orderer1", "org0-orderer2", "org0-orderer3"];
  const namespace = "org0";

  if (process.env.ORDERER_TYPE === "bft") {
    const yamlPath = `kube/org0/org0-orderer4.yaml`;
    let yamlContent = fs.readFileSync(yamlPath, "utf8");

    yamlContent = yamlContent.replace(/\$\{([^}]+)\}/g, (_, name) => {
      if (!process.env[name]) throw new Error(`Missing env ${name}`);
      return process.env[name];
    });

    const out = await kubectlApplyFromString(yamlContent, namespace);
    console.log(out);
    console.log(`org0-orderer4.yaml applied successfully`);
  }

  for (let orderer of orderers) {
    const yamlPath = `kube/org0/${orderer}.yaml`;
    let yamlContent = fs.readFileSync(yamlPath, "utf8");

    yamlContent = yamlContent.replace(/\$\{([^}]+)\}/g, (_, name) => {
      if (!process.env[name]) throw new Error(`Missing env ${name}`);
      return process.env[name];
    });

    const out = await kubectlApplyFromString(yamlContent, namespace);
    // console.log(out);
    console.log(`${orderer}.yaml applied successfully`);
  }
};

const checkOrdererDeployment = async () => {
  const deployments = [
    "org0-orderer1",
    "org0-orderer2",
    "org0-orderer3",
    "org0-orderer4"
  ];

  const namespace = "org0";

  for (let name of deployments) {

    if(process.env.ORDERER_TYPE === "bft" && name === "org0-orderer4"){
      continue;
    };

    console.log(`Checking deployment: ${name}`);
    // console.log(getType(name));

    const timeoutMs = 5 * 60 * 1000; // 5 minutes
    const intervalMs = 1 * 60 * 1000; // 2 minutes
    const endTime = Date.now() + timeoutMs;

    while (Date.now() < endTime) {
      try {
        // Must pass name and namespace as direct args

        if(process.env.ORDERER_TYPE === "bft" && name === "org0-orderer4"){

          const res = await k8sApi2.readNamespacedDeployment(name, namespace);
          console.log("from orderer: ", res.body.status);
          console.log("from orderer: ", res.body.status.conditions);

          const status = res.body.status;
          const ready = status.readyReplicas || 0;
          const desired = status.replicas || 0;

          console.log(`${name}: ${ready}/${desired} ready`);

          if (ready === desired && desired > 0) {
            console.log(`${name} rollout complete`);
            break; // move to next deployment
          } else {
            console.log(`${name} initializing...`);
          }
        };

        const res = await k8sApi2.readNamespacedDeployment(name, namespace);
        // console.log("from orderer: ", res.body.status);
        // console.log("from orderer: ", res.body.status.conditions);

        const status = res.body.status;
        const ready = status.readyReplicas || 0;
        const desired = status.replicas || 0;

        console.log(`${name}: ${ready}/${desired} ready`);

        if (ready === desired && desired > 0) {
          console.log(`${name} rollout complete`);
          break; // move to next deployment
        } else {
          console.log(`${name} initializing...`);
        }

      } catch (err) {
        // Deployment not created yet
        const parsedErr = err.body || "{}";
        if (parsedErr.reason === "NotFound" && name === "org0-orderer4") {

          return;

        } else if(parsedErr.reason === "NotFound"){

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


const applyOrgPeerYaml = async () => {

  const peers = [
    "org1-peer1",  
    "org1-peer2",
    "org2-peer1",
    "org2-peer2"
  ];

  const orga = {
    "org1-peer1": "org1", 
    "org1-peer2": "org1", 
    "org2-peer1": "org2",
    "org2-peer2": "org2"
  };

  for (let p of peers) {
    try {
      const namespace = orga[p];
      const yamlPath = `kube/${namespace}/${p}.yaml`;

      let yamlContent = fs.readFileSync(yamlPath, "utf8");

      yamlContent = yamlContent.replace(/\$\{([^}]+)\}/g, (_, name) => {
        if (!process.env[name]) {
          console.log(`Missing env var ${name}`);
        }
        return process.env[name];
      });

      const out = await kubectlApplyFromString(yamlContent, namespace);
      // console.log(out);
      console.log(`${p}.yaml applied successfully`);

    } catch (err) {
      console.error(`Failed to apply ${p}.yaml: `, err);
    }
  }
};

const checkOrgPeerDeployment = async () => {
  const deployments = [
    "org1-peer1",
    "org1-peer2",
    "org2-peer1",
    "org2-peer2"
  ];

  const orga = {
      "org1-peer1": "org1", 
      "org1-peer2": "org1", 
      "org2-peer1": "org2",
      "org2-peer2": "org2"
    };

  for (let name of deployments) {

    const namespace = orga[name];
    console.log(`Checking deployment: ${name}`);
    console.log(getType(name));

    const timeoutMs = 1 * 60 * 1000; // 5 minutes
    const intervalMs = 1 * 60 * 1000; // 1 minutes
    const endTime = Date.now() + timeoutMs;

    while (Date.now() < endTime) {
      try {
        // Must pass name and namespace as direct args
        const res = await k8sApi2.readNamespacedDeployment(name, namespace);
        // console.log(res.body.status);

        const status = res.body.status;
        const ready = status.readyReplicas || 0;
        const desired = status.replicas || 0;

        console.log(`${name}: ${ready}/${desired} ready`);

        // if (ready === desired && desired > 0) {
        //   console.log(`${name} rollout complete`);
        //   break; // move to next deployment
        // } else {
        //   console.log(`${name} initializing...`);
        // }

      } catch (err) {
        // Deployment not created yet
        const parsedErr = err.body || "{}";
        // const parsedErr = JSON.parse(err.body || "{}");
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

//<=============== Network channel setup start ========================>//

const registerOrgAdmins = async () => {

  const { DOMAIN, NGINX_HTTPS_PORT, RCAADMIN_USER } = process.env;
  const base = process.cwd();

  const orga = [
      "org0",
      "org1",
      "org2",
  ];

  for (let org of orga){

    const caClientPath = path.join(base, "bin", "fabric-ca-client");

    // Safety check
    await execAsync(`chmod +x ${caClientPath}`);
    
    const cmd = `${caClientPath}  register \
      --id.name       ${org}admin \
      --id.secret     ${org}pw \
      --id.type       admin \
      --url           https://${org}-ca.${DOMAIN}:${NGINX_HTTPS_PORT} \
      --tls.certfiles ${base}/build/cas/${org}-ca/tlsca-cert.pem \
      --mspdir        ${base}/build/enrollments/${org}/users/${RCAADMIN_USER}/msp \
      --id.attrs      "hf.Registrar.Roles=client,hf.Registrar.Attributes=*,hf.Revoker=true,hf.GenCRL=true,admin=true:ecert,abac.init=true:ecert"
    `;

    try {
      console.log("Executing registering admin...Done!");

      const { stdout } = await execAsync(cmd);

      console.log(stdout);

    } catch (err) {
      if (err.stderr?.includes("already registered")) {
        console.log(`${org} was already registered — continuing.`);
      } else{
        console.error("Registration failed: ", err);
      }
    };
}
};

const enrollOrgAdmins = async () => {

  const { DOMAIN, NGINX_HTTPS_PORT } = process.env;
  const base = process.cwd();

  ENROLLMENTS_DIR=`${base}/build/enrollments`
 
  const orga = [
      "org0",
      "org1",
      "org2",
  ];

  for (let org of orga) {
  const ORG_ADMIN_DIR = `${ENROLLMENTS_DIR}/${org}/users/rcaadmin`;

  // fs.mkdirSync(ORG_ADMIN_DIR, { recursive: true });

  if (
    fs.existsSync(`${ORG_ADMIN_DIR}/msp/keystore/key.pem`) &&
    fs.existsSync(`${ORG_ADMIN_DIR}/tls/keystore/key.pem`)
  ) {
    console.log(`Found existing admin enrollment at ${ORG_ADMIN_DIR}`);
    continue;
  }

  const CA_NAME = `${org}-ca`;
  const CA_DIR = `${base}/build/cas/${CA_NAME}`;
  const CA_AUTH = `${org}admin:${org}pw`;
  const CA_HOST = `${CA_NAME}.${DOMAIN}`;
  const CA_URL = `https://${CA_AUTH}@${CA_HOST}:${NGINX_HTTPS_PORT}`;

  // const mspDir = `${ORG_ADMIN_DIR}/msp`;
  // const tlsDir = `${ORG_ADMIN_DIR}/tls`;

  // fs.mkdirSync(tlsDir, { recursive: true });

  const caClientPath = path.join(base, "bin", "fabric-ca-client");

  // Safety check
  await execAsync(`chmod +x ${caClientPath}`);


  // MSP enrollment
  const {stdout, stderr} = await execAsync(
    `${caClientPath} enroll \
      --url ${CA_URL} \
      --tls.certfiles ${CA_DIR}/tlsca-cert.pem`,
    { env: { ...process.env, FABRIC_CA_CLIENT_HOME: ORG_ADMIN_DIR } }
  );

  console.log("MSP Output Error: ", stderr);
  console.log("MSP Output result: ", stdout);

  const CA_CERT_NAME = `${CA_NAME}-${DOMAIN.replace(/\./g, "-")}-${NGINX_HTTPS_PORT}.pem`;
  await createMspConfigYaml(CA_NAME, CA_CERT_NAME, `${ORG_ADMIN_DIR}/msp`);

  try {
    normalizeKey(`${ORG_ADMIN_DIR}/msp/keystore`);
    console.log(`✓ Normalized keys for ${org}`);
  } catch (err) {
    console.error(`✗ Failed to normalize keys for ${org}:`, err.message);
    throw err;
  }

  // TLS enrollment for osnadmin client certs
  const tlsDir = `${ORG_ADMIN_DIR}/tls`;
  fs.mkdirSync(tlsDir, { recursive: true });
  
  const tlsEnrollCmd = `${caClientPath} enroll \
    --url ${CA_URL} \
    --tls.certfiles ${CA_DIR}/tlsca-cert.pem \
    --enrollment.profile tls \
    --csr.hosts rcaadmin`;
  
  try {
    const {stdout: tlsStdout, stderr: tlsStderr} = await execAsync(
      tlsEnrollCmd,
      { env: { ...process.env, FABRIC_CA_CLIENT_HOME: tlsDir } }
    );
    
    console.log("TLS Enrollment Output Error: ", tlsStderr);
    console.log("TLS Enrollment Output result: ", tlsStdout);
    
    // Normalize TLS keys and certs
    try {
      normalizeKey(`${tlsDir}/msp/keystore`);
      console.log(`✓ Normalized TLS keys for ${org}`);
      
      normalizeCert(`${tlsDir}/msp/signcerts`);
      console.log(`✓ Normalized TLS certs for ${org}`);
    } catch (err) {
      console.error(`✗ Failed to normalize TLS files for ${org}:`, err.message);
      throw err;
    }
  } catch (err) {
    console.error(`TLS enrollment failed for ${org}:`, err.stderr || err.message);
    throw err;
  }
}

};


const normalizeKey = (dir) => {
  if (!fs.existsSync(dir)) {
    console.log(`  [normalizeKey] Directory does not exist: ${dir}`);
    return;
  }

  const files = fs.readdirSync(dir);
  console.log(`  [normalizeKey] Files in ${dir}:`, files);
  
  const sk = files.find(f => f.endsWith("_sk"));
  
  if (sk) {
    console.log(`  [normalizeKey] Found _sk file: ${sk}`);
    // If we have an _sk file, it's the fresh one from the latest enrollment
    // Remove the old key.pem if it exists and rename _sk to key.pem
    const keyPemPath = `${dir}/key.pem`;
    const skPath = `${dir}/${sk}`;
    
    if (fs.existsSync(keyPemPath)) {
      console.log(`  [normalizeKey] Removing old key.pem`);
      fs.unlinkSync(keyPemPath);
    }
    console.log(`  [normalizeKey] Renaming ${sk} to key.pem`);
    fs.renameSync(skPath, keyPemPath);
  } else if (!files.includes("key.pem")) {
    throw new Error(`No private key found in ${dir}`);
  } else {
    console.log(`  [normalizeKey] No _sk file found, key.pem exists`);
  }
}

const normalizeCert = (dir) => {
  if (!fs.existsSync(dir)) {
    console.log(`  [normalizeCert] Directory does not exist: ${dir}`);
    return;
  }

  const files = fs.readdirSync(dir);
  console.log(`  [normalizeCert] Files in ${dir}:`, files);
  
  // Look for certificate files (typically named like hostname-cert.pem or similar)
  const certFile = files.find(f => f.endsWith("-cert.pem") && f !== "ca-cert.pem");
  
  if (certFile) {
    console.log(`  [normalizeCert] Found cert file: ${certFile}`);
    const certPemPath = `${dir}/cert.pem`;
    const originalPath = `${dir}/${certFile}`;
    
    if (fs.existsSync(certPemPath)) {
      console.log(`  [normalizeCert] Removing old cert.pem`);
      fs.unlinkSync(certPemPath);
    }
    console.log(`  [normalizeCert] Renaming ${certFile} to cert.pem`);
    fs.renameSync(originalPath, certPemPath);
  } else if (!files.includes("cert.pem")) {
    throw new Error(`No certificate found in ${dir}`);
  } else {
    console.log(`  [normalizeCert] No cert file found, cert.pem exists`);
  }
}

async function createMspConfigYaml(caName, caCertName, mspDir) {
  const configPath = path.join(mspDir, "config.yaml");

  console.log(`Creating msp config ${configPath} with cert ${caCertName}`);

  // Ensure directory exists
  if (!fs.existsSync(mspDir)) {
    fs.mkdirSync(mspDir, { recursive: true });
  }

  const content = `
    NodeOUs:
      Enable: true
      ClientOUIdentifier:
        Certificate: cacerts/${caCertName}
        OrganizationalUnitIdentifier: client
      PeerOUIdentifier:
        Certificate: cacerts/${caCertName}
        OrganizationalUnitIdentifier: peer
      AdminOUIdentifier:
        Certificate: cacerts/${caCertName}
        OrganizationalUnitIdentifier: admin
      OrdererOUIdentifier:
        Certificate: cacerts/${caCertName}
        OrganizationalUnitIdentifier: orderer
  `;

  fs.writeFileSync(configPath, content, "utf8");
}

async function extractCASignAuth () {
  const base = process.cwd();
  const namespaces = ["org0", "org1", "org2"];

  for (const namespace of namespaces) {
    const { DOMAIN, NGINX_HTTPS_PORT } = process.env;

    const type = namespace === "org0" ? "orderer" : "peer";
    const caName = `${namespace}-ca`;

    const ORG_MSP_DIR =`${base}/build/channel-msp/${type}Organizations/${namespace}/msp`;

    //CREATE FULL DIRECTORY TREE
    await fsp.mkdir(`${ORG_MSP_DIR}/cacerts`, { recursive: true });
    // await fsp.mkdir(`${ORG_MSP_DIR}/tlscacerts`, { recursive: true });

    //Write files
    const cmd = `
      curl -s \
        --cacert ${base}/build/cas/${caName}/tlsca-cert.pem \
        https://${caName}.${DOMAIN}:${NGINX_HTTPS_PORT}/cainfo \
        | jq -r .result.CAChain \
        | base64 -d \
        > ${ORG_MSP_DIR}/cacerts/ca-signcert.pem
    `;

    try {
      await execAsync(cmd);
      console.log(`CA signing cert extracted for ${namespace}`);

      // <-- COPY it into the Fabric CA folder here
      await execAsync(`cp ${ORG_MSP_DIR}/cacerts/ca-signcert.pem ${base}/build/cas/${caName}/ca-cert.pem`);
      console.log(`Copied CA signing cert to build/cas/${caName}/ca-cert.pem`);

    } catch (err) {
      console.error(`CA extraction failed for ${namespace}`, err);
      console.log(err);
    }
  }
}

//Create channel org MSP   # extract the CA's TLS CA certificate from the cert-manager secret
async function extractCASecreteCreateMspConfig () {
  const base = process.cwd();
  const namespaces = ["org0", "org1", "org2"];

  for (const namespace of namespaces) {
    const type = namespace === "org0" ? "orderer" : "peer";
    const caName = `${namespace}-ca`;

    const ORG_MSP_DIR = `${base}/build/channel-msp/${type}Organizations/${namespace}/msp`;

    //Ensure directories exist (idempotent)
    await fsp.mkdir(`${ORG_MSP_DIR}/tlscacerts`, { recursive: true });

    const cmd = `
      kubectl -n ${namespace} get secret ${caName}-tls-cert -o json \
        | jq -r '.data["ca.crt"]' \
        | base64 -d \
        > ${ORG_MSP_DIR}/tlscacerts/tlsca-signcert.pem
    `;
    // const cmd = `
    //   kubectl -n ${namespace} get secret ${caName}-tls-cert -o json \
    //     | jq -r '.data["tls.crt"]' \
    //     | base64 -d \
    //     > ${ORG_MSP_DIR}/tlscacerts/tlsca-signcert.pem
    // `;
  

    try {
      await execAsync(cmd);
      console.log(`TLS CA cert extracted for ${namespace}`);
    } catch (err) {
      console.error(`TLS extraction failed for ${namespace}`, err);
      throw err;
    }

    await createMspConfigYaml(caName, "ca-signcert.pem", ORG_MSP_DIR);
  }
}

const createChannelOrgMSP = async () => {
  await extractCASignAuth();
  await extractCASecreteCreateMspConfig();
};

const extractOrdererCert = async () => {
  const base = process.cwd();
  const org="org0";

  const orderer = [
    "orderer1",
    "orderer2",
    "orderer3",
    "orderer4"
  ];

  for (ord of orderer){

    const ORDERER_TLS_DIR=`${base}/build/channel-msp/ordererOrganizations/${org}/orderers/${org}-${ord}/tls`;
    await fsp.mkdir(`${ORDERER_TLS_DIR}/signcerts`, { recursive: true });

    try {
      const cmd = `
        kubectl get secret -n ${org} ${org}-${ord}-tls-cert -o json \
          | jq -r '.data["tls.crt"]' \
          | base64 -d \
          > ${ORDERER_TLS_DIR}/signcerts/tls-cert.pem
      `;
      // const cmd = `
      //   kubectl get secret -n ${org} ${org}-${ord}-tls-cert -o json \
      //     | jq -r .data.\"tls.crt\" \
      //     | base64 -d \
      //     > ${ORDERER_TLS_DIR}/signcerts/tls-cert.pem
      // `;
      console.log('Executing get Secret');

      await execAsync(cmd);

      const cmdd = `kubectl get pods -n ${org} -l app=${org}-${ord} -o jsonpath='{.items[0].metadata.name}'`

      const output = await execAsync(cmdd);

      if(!output.stdout || output.stdout === undefined) { console.log(output, "is empty or undefined");};

      const POD_NAME = output.stdout;
      // console.log(POD_NAME);

      if(!POD_NAME) console.log(`Error: No Pod found with label app=${org}-${ord} in namespace ${org}`);

      //Copy the enrollment certificate from the pod to the local machine
      const cmd0 = `
        kubectl -n ${org} cp ${POD_NAME}:var/hyperledger/fabric/organizations/ordererOrganizations/${org}.example.com/orderers/${org}-${ord}.${org}.example.com/msp/signcerts/cert.pem ${base}/build/channel-msp/ordererOrganizations/${org}/orderers/${org}-${ord}/cert.pem`

      console.log('Executing copying the enrollment certificate from the pod to the local machine');

      const newOutput = await execAsync(cmd0);

      if (newOutput.stderr) console.error("stderr:", newOutput.stderr);

    } catch (err) {

      if(err.killed === false) {
        console.log("Error executing this command: ", err.cmd);
      }
    };
  };
};

const createGenesisBlock = async () => {
  console.log("Creating channel genesis block");

  const base = process.cwd();
  let profile;
  let inputFile;
  
  const outputFile = `${base}/build/configtx.yaml`;

  if (process.env.ORDERER_TYPE === "bft"){
    inputFile = `${base}/config/org0/bft/configtx-template.yaml`;
    profile = "ChannelUsingBFT";
  } else {
    inputFile = `${base}/config/org0/configtx-template.yaml`;
    profile = "TwoOrgsApplicationGenesis";
  }

  try {
    // 1. Read template
    const template = await fsp.readFile(inputFile, "utf8");

    // 2. Substitute environment variables
    const rendered = await substituteEnvVariables(template, process.env);

    // 3. Write output configtx.yaml
    await fsp.writeFile(outputFile, rendered, "utf8");
    console.log("configtx.yaml generated");

    // 4. Absolute path to configtxgen (IMPORTANT)
    const CONFIGTXGEN = path.join(base, "bin", "configtxgen");

    // Safety check
    await execAsync(`chmod +x ${CONFIGTXGEN}`);


    // 5. Run configtxgen
    const cmd = ` FABRIC_CFG_PATH=${base}/build \
        ${CONFIGTXGEN} \
        -profile ${profile} \
        -channelID ${process.env.CHANNEL_NAME} \
        -outputBlock ${base}/build/genesis_block.pb
      `;

    const anyOutput = await execAsync(cmd);
    console.log("genesis_block.pb generated");

    if(anyOutput.stdout) {
      console.log(anyOutput.stdout);
    } else if (anyOutput.stderr){
      console.log(anyOutput.stderr);
    }
  
  } catch (err) {
    console.error("Error creating genesis block:", err.stderr || err);
  }
};

// Below: Needs a little bit to settle before peers can join say sleep 10
const joinChannelOrderers = async () => {
  console.log(`Joining orderers to channel ${process.env.CHANNEL_NAME}`)
  const { DOMAIN, NGINX_HTTPS_PORT } = process.env;

  const base = process.cwd();
  const TEMP_DIR = `${base}/build`;
  const org="org0";

  const orderer = [
    "orderer1",
    "orderer2",
    "orderer3",
    "orderer4"
  ];

  const OSNADMIN = path.join(base, "bin", "osnadmin");
  await execAsync(`chmod +x ${OSNADMIN}`);

  for (let ord of orderer){

    if(ord !== "orderer4"){

      const cmd = `${OSNADMIN} channel join \
        --orderer-address ${org}-${ord}-admin.${DOMAIN}:${NGINX_HTTPS_PORT} \
        --ca-file         ${TEMP_DIR}/channel-msp/ordererOrganizations/${org}/orderers/${org}-${ord}/tls/signcerts/tls-cert.pem \
        --client-cert     ${TEMP_DIR}/enrollments/${org}/users/rcaadmin/tls/msp/signcerts/cert.pem \
        --client-key      ${TEMP_DIR}/enrollments/${org}/users/rcaadmin/tls/msp/keystore/key.pem \
        --channelID       ${process.env.CHANNEL_NAME} \
        --config-block    ${TEMP_DIR}/genesis_block.pb
      `;

      const { stdout, stderr } = await execAsync(cmd);

      if (stderr) console.error("stderr:", stderr);
      console.log("stdout:" ,stdout);

    } else if (ord === "orderer4" && process.env.ORDERER_TYPE === "bft") {
      
      const cmd = `${OSNADMIN} channel join \
        --orderer-address ${org}-${ord}-admin.${DOMAIN}:${NGINX_HTTPS_PORT} \
        --ca-file         ${TEMP_DIR}/channel-msp/ordererOrganizations/${org}/orderers/${org}-${ord}/tls/signcerts/tls-cert.pem \
        --client-cert     ${TEMP_DIR}/enrollments/${org}/users/rcaadmin/tls/msp/signcerts/cert.pem \
        --client-key      ${TEMP_DIR}/enrollments/${org}/users/rcaadmin/tls/msp/keystore/key.pem \
        --channelID       ${process.env.CHANNEL_NAME} \
        --config-block    ${TEMP_DIR}/genesis_block.pb
      `;

      const { stdout, stderr } = await execAsync(cmd);

      if (stderr) console.error("stderr:", stderr);
      console.log("stdout:" , stdout);
    }
  }
};

const joinChannelPeers = async () => {
  console.log(`Joining peers to channel ${process.env.CHANNEL_NAME}`)
  const { DOMAIN, NGINX_HTTPS_PORT, ORDERER_TIMEOUT } = process.env;

  const base = process.cwd();
  const TEMP_DIR = `${base}/build`;
  
  const peersOrgMap = [
    { peer: "peer1", org: "org1" },
    { peer: "peer2", org: "org1" },
    { peer: "peer1", org: "org2" },
    { peer: "peer2", org: "org2" },
  ];

  const PEER = path.join(base, "bin", "peer");
  await execAsync(`chmod +x ${PEER}`);

  for (let { peer, org } of peersOrgMap) {
    const cmd =`
      export FABRIC_CFG_PATH=${base}/config/${org}
      export CORE_PEER_ADDRESS=${org}-${peer}.${DOMAIN}:${NGINX_HTTPS_PORT}
      export CORE_PEER_MSPCONFIGPATH=${TEMP_DIR}/enrollments/${org}/users/rcaadmin/msp
      export CORE_PEER_TLS_ROOTCERT_FILE=${TEMP_DIR}/channel-msp/peerOrganizations/${org}/msp/tlscacerts/tlsca-signcert.pem
      ${PEER} channel join \
        --blockpath   ${TEMP_DIR}/genesis_block.pb \
        --orderer     org0-orderer1.${DOMAIN} \
        --connTimeout ${ORDERER_TIMEOUT} \
        --tls         \
        --cafile      ${TEMP_DIR}/channel-msp/ordererOrganizations/org0/orderers/org0-orderer1/tls/signcerts/tls-cert.pem
    `;

    const { stdout, stderr } = await execAsync(cmd);

    if (stderr) console.error("stderr:", stderr);
    console.log(stdout);
  };
};

const deployChaincode = async (ccPath) => {
  const cc_name = process.env.CC_NAME || "ductioncc";
  const cc_label = process.env.CC_LABEL || "ductioncclabel";
  
  const cc_folder = fs.realpathSync(path.join(__dirname, ccPath));
  const temp_folder = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-'));
  const cc_package=`${temp_folder}/${cc_name}.tgz`

  const runChaincodeSetup = async () => {
    try{
      await prepareChaincodeImage(cc_folder, cc_name);
      await packageChaincode(cc_name, cc_label, cc_package);
      await setChaincodeId(cc_package);
      await launchChaincodeService(cc_name);
      await activateChaincode(cc_name,cc_package);
    } catch (err) {
        console.error("CHAINCODE SETUP FAILED:", err);
        process.exit(1);
      }
  };

  await runChaincodeSetup();
  
};

/**
 * The below const q is a sample invoke query
 */

const q = {
  "Args":["CreateAsset","1","blue","35","tom","1000"]
};

/**
 *
 * @param q: A JSON string describing the function and arguments to invoke the chaincode with
 */

const invokeChaincode = async (q) => {
  const cc_name = process.env.CC_NAME || "ductioncc";
  const org = "org1";
  const peer = "peer1";
  const CHANNEL_NAME = process.env.CHANNEL_NAME || "duction_channel";
  const {DOMAIN, NGINX_HTTPS_PORT, ORDERER_TIMEOUT} = process.env;

  const base = process.cwd();
  const TEMP_DIR = `${base}/build`;

  const invokeQuery = q;

  const cmd =`
      export FABRIC_CFG_PATH=${base}/config/${org}
      export CORE_PEER_ADDRESS=${org}-${peer}.${DOMAIN}:${NGINX_HTTPS_PORT}
      export CORE_PEER_MSPCONFIGPATH=${TEMP_DIR}/enrollments/${org}/users/rcaadmin/msp
      export CORE_PEER_TLS_ROOTCERT_FILE=${TEMP_DIR}/channel-msp/peerOrganizations/${org}/msp/tlscacerts/tlsca-signcert.pem
    `;

    const { stdout, stderr } = await execAsync(cmd);

    if (stderr) console.error("stderr:", stderr);
    console.log(stdout);

  const cmd0 =`
      peer chaincode invoke \
        -n              ${cc_name} \
        -C              ${CHANNEL_NAME} \
        -c              ${invokeQuery} \
        --orderer       org0-orderer1.${DOMAIN}:${NGINX_HTTPS_PORT} \
        --connTimeout   ${ORDERER_TIMEOUT} \
        --tls --cafile  ${TEMP_DIR}/channel-msp/ordererOrganizations/org0/orderers/org0-orderer1/tls/signcerts/tls-cert.pem \
        ${INVOKE_EXTRA_ARGS}
    `;

    const { stdout0, stderr0 } = await execAsync(cmd0);

    if (stderr0) console.error("stderr:", stderr0);
    console.log(stdout0);

};

/**
 * The below const q0 is a sample invoke query
 */

const q0 = {
  "Args":["ReadAsset","1"]
};

const queryChaincode = async (q) => {
  const cc_name = process.env.CC_NAME || "ductionCC";
  const org = "org1";
  const peer = "peer1";
  const CHANNEL_NAME = process.env.CHANNEL_NAME || "duction_channel";
  const {DOMAIN, NGINX_HTTPS_PORT} = process.env;

  const base = process.cwd();
  const TEMP_DIR = `${base}/build`;

  const queryLedger = q0;

  const cmd =`
      export FABRIC_CFG_PATH=${base}/config/${org}
      export CORE_PEER_ADDRESS=${org}-${peer}.${DOMAIN}:${NGINX_HTTPS_PORT}
      export CORE_PEER_MSPCONFIGPATH=${TEMP_DIR}/enrollments/${org}/users/rcaadmin/msp
      export CORE_PEER_TLS_ROOTCERT_FILE=${TEMP_DIR}/channel-msp/peerOrganizations/${org}/msp/tlscacerts/tlsca-signcert.pem
    `;

    const { stdout, stderr } = await execAsync(cmd);

    if (stderr) console.error("stderr:", stderr);
    console.log(stdout);

  const cmd0 =`
      peer chaincode query \
        -n    ${cc_name} \
        -C    ${CHANNEL_NAME} \
        -c    ${queryLedger} \
        ${QUERY_EXTRA_ARGS}
    `;

    const { stdout0, stderr0 } = await execAsync(cmd0);

    if (stderr0) console.error("stderr:", stderr0);
    console.log(stdout0);

};

//<=============== Network channel setup ends ========================>//

//<=============== Network setup ends ========================>//

async function substituteEnvVariables(input, env) {
  return input.replace(/\$\{?([A-Za-z0-9_]+)\}?/g, (match, name) => {
    return env[name] ?? match; // keep original if undefined
  });
}

// async function prepareChaincodeImage(cc_folder, cc_name){
//   //build_chaincode_image

//   const cmd0 = `docker build -t ${cc_name}:latest ${cc_folder}`;
//   const cmd1 = `docker tag ${cc_name}:latest ${GHCR_IO}/${cc_name}:latest`;
//   const cmd2 = `docker push ${GHCR_IO}/${cc_name}:latest`;


//   const { stdout0, stderr0 } = await execAsync(cmd0);
//   const { stdout1, stderr1 } = await execAsync(cmd1);
//   const { stdout2, stderr2 } = await execAsync(cmd2);

//    process.env.CHAINCODE_IMAGE = `${GHCR_IO}/${cc_name}:latest`;


//   if (stderr0) console.error("stderr:", stderr0);
//   return {stdout0, stdout1, stdout2};
// };

async function prepareChaincodeImage(cc_folder, cc_name) {
  if (!process.env.GHCR_IO) {
    console.log("GHCR_IO env var not set (e.g. ghcr.io/osemuaimiosior)");
  }

  const imageLocal = `${cc_name}:latest`;
  const imageRemote = `${process.env.GHCR_IO}/${cc_name}:latest`; //you can use docker herer too

  console.log("Building chaincode image...");
  const { stdout: bOut, stderr: bErr } = await execAsync(
    `docker build -t ${imageLocal} ${cc_folder}`
  );
  if (bErr) console.error(bErr);

  console.log("Tagging image...");
  const { stderr: tErr } = await execAsync(
    `docker tag ${imageLocal} ${imageRemote}`
  );
  if (tErr) console.error(tErr);

  console.log("Pushing image to registry...");
  const { stdout: pOut, stderr: pErr } = await execAsync(
    `docker push ${imageRemote}`
  );
  if (pErr) console.error(pErr);

  process.env.CHAINCODE_IMAGE = imageRemote;

  console.log("Chaincode image ready:", imageRemote);

  return {
    image: imageRemote,
    build: bOut,
    push: pOut
  };
}


async function packageChaincode(cc_name, cc_label, cc_package){

  const cc_folder = path.dirname(cc_package);
  const archive_name = path.basename(cc_package);

  await fsp.mkdir(cc_folder, { recursive: true });

  console.log(`Packaging ccaas chaincode ${cc_label}`);

  const cc_default_address=`${cc_name}-ccaas-${cc_name}:9999`
  const cc_address = process.env.TEST_NETWORK_CHAINCODE_ADDRESS || cc_default_address;

   // Build paths
  const connectionJson = path.join(cc_folder, "connection.json");
  const metadataJson = path.join(cc_folder, "metadata.json");
  const codeTarGz = path.join(cc_folder, "code.tar.gz");

  // Write connection.json
  await fsp.writeFile(connectionJson, JSON.stringify({
      address: cc_address,
      dial_timeout: "10s",
      tls_required: false
  }, null, 2));

  // Write metadata.json
  await fsp.writeFile(metadataJson, JSON.stringify({
      type: "ccaas",
      label: cc_label
  }, null, 2));

  // Create code.tar.gz (contains only connection.json)
  await tar.create(
      {
          gzip: true,
          file: codeTarGz,
          cwd: cc_folder
      },
      ["connection.json"]
  );

  // Create final archive (contains code.tar.gz and metadata.json)
  await tar.create(
      {
          gzip: true,
          file: cc_package,
          cwd: cc_folder
      },
      ["code.tar.gz", "metadata.json"]
  );

  // Cleanup
  // await fs.rm(codeTarGz);

  // Cleanup (Node 22 safe)
  await fsp.rm(codeTarGz, { force: true });

  console.log("Chaincode package created:", cc_package);
};


async function setChaincodeId(cc_package) {
  const absPath = path.resolve(cc_package);

  // 1. Compute SHA-256
  const fileBuffer = await fsp.readFile(absPath);
  const ccSha256 = crypto
    .createHash("sha256")
    .update(fileBuffer)
    .digest("hex");

  // 2. Read metadata.json from tar.gz
  let metadataJsonContent = null;

  await tar.t({
    file: absPath,
    onReadEntry: entry => {
      if (entry.path === "metadata.json") {
        return new Promise((resolve, reject) => {
          let data = "";

          entry.on("data", chunk => {
            data += chunk.toString();
          });

          entry.on("end", () => {
            metadataJsonContent = data;
            resolve();
          });

          entry.on("error", reject);
        });
      }
    }
  });

  if (!metadataJsonContent) {
    console.log("metadata.json not found inside chaincode package");
  }

  const { label } = JSON.parse(metadataJsonContent);

  // 3. Build CHAINCODE_ID
  process.env.CHAINCODE_ID = `${label}:${ccSha256}`;

  return {
    ccSha256,
    label
  };
};


async function kubectlApply(namespace, yaml) {
  return new Promise((resolve, reject) => {
    const kubectl = spawn("kubectl", ["-n", namespace, "apply", "-f", "-"], {
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stderr = "";
    let stdout = "";

    kubectl.stdout.on("data", d => stdout += d);
    kubectl.stderr.on("data", d => stderr += d);

    kubectl.on("close", code => {
      if (code !== 0) {
        reject(new Error(stderr));
      } else {
        resolve(stdout);
      }
    });

    kubectl.stdin.write(yaml);
    kubectl.stdin.end();
  });
};

// async function applyRegistrySecret(){

//   const organisations = ["org0", "org1", "org2"];
//   const {GITHUB_TOKEN, GHCR_SECRET_NAME, GITHUB_USER_NAME, GITHUB_SERVER, GITHUB_EMAIL} = process.env;

//   for (let org of organisations){
      
//       const cmd = `kubectl create secret docker-registry ${GHCR_SECRET_NAME} \
//         --namespace ${org} \
//         --docker-server=${GITHUB_SERVER} \
//         --docker-username=${GITHUB_USER_NAME} \
//         --docker-password=${GITHUB_TOKEN} \
//         --docker-email=${GITHUB_EMAIL}
//       `
//     const {stdout, stderr} = await execAsync(cmd);

//     if(stderr) console.log(stderr)
//     if(stdout) console.log(stdout)

//     return stdout;
//   }
  
// };

async function applyRegistrySecret() {
  const organisations = ["org0", "org1", "org2"];
  const {
    GITHUB_TOKEN,
    GHCR_SECRET_NAME,
    GITHUB_USER_NAME,
    GITHUB_SERVER,
    GITHUB_EMAIL
  } = process.env;

  for (let org of organisations) {

    const cmd = `
      kubectl create secret docker-registry ${GHCR_SECRET_NAME} \
      --namespace=${org} \
      --docker-server=${GITHUB_SERVER} \
      --docker-username=${GITHUB_USER_NAME} \
      --docker-password=${GITHUB_TOKEN} \
      --docker-email=${GITHUB_EMAIL} \
      --dry-run=client -o yaml | kubectl apply -f -
    `;

    try {
      const { stdout, stderr } = await execAsync(cmd);

      if (stderr) console.log(stderr);
      if (stdout) console.log(`Secret applied in ${org}`);
    } catch (err) {
      console.error(`Failed in ${org}:`, err.stderr || err);
    }
  }
}


async function launchChaincodeService(cc_name){
  const org="org1";
  const peers = ["peer1", "peer2"];
  const {CHAINCODE_IMAGE, CHAINCODE_ID, ORG1_NS, GHCR_SECRET_NAME} = process.env;

  console.log(`Launching chaincode container ${CHAINCODE_IMAGE}`)

  for (let peer of peers){
    try {
      const templatePath = `kube/${org}/${org}-cc-template.yaml`;

      // Read the template file
      let content = await fsp.readFile(templatePath, "utf8");

      // Replace placeholders
      content = content
        .replace(/{{CHAINCODE_NAME}}/g, cc_name)
        .replace(/{{CHAINCODE_ID}}/g, CHAINCODE_ID)
        .replace(/{{CHAINCODE_IMAGE}}/g, CHAINCODE_IMAGE)
        .replace(/{{GHCR_SECRET_NAME}}/g, GHCR_SECRET_NAME)
        .replace(/{{PEER_NAME}}/g, peer);

      console.log("Applying chaincode deployment to Kubernetes...");

      // Apply YAML using kubectl stdin
      const applyCmd = `kubectl -n ${ORG1_NS} apply -f -`;

      // await execAsync(applyCmd, { input: content });
      await kubectlApply(ORG1_NS, content);

      console.log("YAML applied. Checking rollout status...");

      const rolloutCmd = `kubectl -n ${ORG1_NS} rollout status deploy/${org}${peer}-ccaas-${cc_name}`;

      await execAsync(rolloutCmd);

      console.log("Deployment rolled out successfully!");
    } catch (err) {
      console.error("Chaincode deployment failed:", err);
    }
  }
};

async function activateChaincode(cc_name, cc_package){
  const org="org1";
  const peers = ["peer1", "peer2"];
  const {CHAINCODE_IMAGE, DOMAIN, NGINX_HTTPS_PORT, ORDERER_TIMEOUT, CHAINCODE_ID, ORG1_NS, CHANNEL_NAME} = process.env;

  await setChaincodeId(cc_package);

  //Install chaincode
  for (let peer of peers){
    const base = process.cwd();
    const TEMP_DIR = `${base}/build`;
    
    console.log(`Installing chaincode for org ${org} peer ${peer}`);

      const cmd =`
        export FABRIC_CFG_PATH=${base}/config/${org}
        export CORE_PEER_ADDRESS=${org}-${peer}.${DOMAIN}:${NGINX_HTTPS_PORT}
        export CORE_PEER_MSPCONFIGPATH=${TEMP_DIR}/enrollments/${org}/users/rcaadmin/msp
        export CORE_PEER_TLS_ROOTCERT_FILE=${TEMP_DIR}/channel-msp/peerOrganizations/${org}/msp/tlscacerts/tlsca-signcert.pem
      `;

      const { stdout, stderr } = await execAsync(cmd);

      if (stderr) console.error("stderr:", stderr);
      console.log(stdout);

      const cmd0 =` peer lifecycle chaincode install ${cc_package} ${process.env.INSTALL_EXTRA_ARGS}`;

      const { stdout0, stderr0 } = await execAsync(cmd0);

      if (stderr0) console.error("stderr:", stderr0);
      console.log(stdout0);
  };

  const runLeg = async () => {

    try{
      //Approve and commit chaincode
      await approveChaincode(cc_name, DOMAIN, NGINX_HTTPS_PORT, CHANNEL_NAME, ORDERER_TIMEOUT, CHAINCODE_ID);
      await commitChaincode(cc_name);
      } catch (err) {
          console.error("Activate Chaincode Last Leg SETUP FAILED:", err);
          process.exit(1);
      }
  };

  await runLeg().catch(err => {
    console.log(err);
  })
    
};

async function approveChaincode(cc_name, DOMAIN, NGINX_HTTPS_PORT, CHANNEL_NAME, ORDERER_TIMEOUT, CHAINCODE_ID){
  const base = process.cwd();
  const TEMP_DIR = `${base}/build`;
  const org="org1"
  const peer="peer1"

  console.log(`Approving chaincode ${cc_name} with ID ${CHAINCODE_ID}`);

  const cmd =`
        export FABRIC_CFG_PATH=${base}/config/${org}
        export CORE_PEER_ADDRESS=${org}-${peer}.${DOMAIN}:${NGINX_HTTPS_PORT}
        export CORE_PEER_MSPCONFIGPATH=${TEMP_DIR}/enrollments/${org}/users/rcaadmin/msp
        export CORE_PEER_TLS_ROOTCERT_FILE=${TEMP_DIR}/channel-msp/peerOrganizations/${org}/msp/tlscacerts/tlsca-signcert.pem
      `;

      const { stdout, stderr } = await execAsync(cmd);

      if (stderr) console.error("stderr:", stderr);
      console.log(stdout);

  const cmd0 =`
    peer lifecycle \
      chaincode approveformyorg \
      --channelID     ${CHANNEL_NAME} \
      --name          ${cc_name} \
      --version       1 \
      --package-id    ${CHAINCODE_ID} \
      --sequence      1 \
      --orderer       org0-orderer1.${DOMAIN}:${NGINX_HTTPS_PORT} \
      --connTimeout   ${ORDERER_TIMEOUT} \
      --tls --cafile  ${TEMP_DIR}/channel-msp/ordererOrganizations/org0/orderers/org0-orderer1/tls/signcerts/tls-cert.pem \
      ${process.env.APPROVE_EXTRA_ARGS}
  `;

      const { stdout0, stderr0 } = await execAsync(cmd0);

      if (stderr0) console.error("stderr:", stderr0);
      console.log(stdout0);
};

async function commitChaincode(cc_name, DOMAIN, NGINX_HTTPS_PORT, CHANNEL_NAME, ORDERER_TIMEOUT, CHAINCODE_ID){
  const base = process.cwd();
  const TEMP_DIR = `${base}/build`;
  const org="org1"
  const peer="peer1"

  console.log(`Approving chaincode ${cc_name} with ID ${CHAINCODE_ID}`);

  const cmd =`
        export FABRIC_CFG_PATH=${base}/config/${org}
        export CORE_PEER_ADDRESS=${org}-${peer}.${DOMAIN}:${NGINX_HTTPS_PORT}
        export CORE_PEER_MSPCONFIGPATH=${TEMP_DIR}/enrollments/${org}/users/rcaadmin/msp
        export CORE_PEER_TLS_ROOTCERT_FILE=${TEMP_DIR}/channel-msp/peerOrganizations/${org}/msp/tlscacerts/tlsca-signcert.pem
      `;

      const { stdout, stderr } = await execAsync(cmd);

      if (stderr) console.error("stderr:", stderr);
      console.log(stdout);

  const cmd0 =`
    peer lifecycle \
      chaincode commit \
      --channelID     ${CHANNEL_NAME} \
      --name          ${cc_name} \
      --version       1 \
      --sequence      1 \
      --orderer       org0-orderer1.${DOMAIN}:${NGINX_HTTPS_PORT} \
      --connTimeout   ${ORDERER_TIMEOUT} \
      --tls --cafile  ${TEMP_DIR}/channel-msp/ordererOrganizations/org0/orderers/org0-orderer1/tls/signcerts/tls-cert.pem \
      ${process.env.COMMIT_EXTRA_ARGS}
  `;

      const { stdout0, stderr0 } = await execAsync(cmd0);

      if (stderr0) console.error("stderr:", stderr0);
      console.log(stdout0);
};

const runSetup = async () => {

  try {
    console.log("STEP 1a: Pre StartUp Config...");
    await preStartUpConfig();
    console.log("Created\n");

    await sleep(2 * 60 * 1000);

    // sh(`docker exec ${node} systemctl restart containerd || true`);

    // await sleep(1 * 60 * 1000);

    console.log("STEP 1b: launch Docker Registry...");
    await launchDockerRegistry();
    console.log("launched Docker Registry\n");

    await sleep(1 * 60 * 1000);

    console.log("STEP 1c: Creating namespace...");
    await createNS();
    console.log("Namespace created\n");

    await sleep(1 * 60 * 1000);

    console.log("STEP 1b: Apply PV to organisational namespace...");
    await pvApply();
    console.log("PV applied and ready\n");

    await sleep(1 * 60 * 1000);

    console.log("STEP 2: Apply PVC to organisational level...");
    await pvcApplyOrg();
    console.log("PVC applied and ready\n");

    console.log("STEP 3: Applying nginx ingress...");
    await initIngress();
    console.log("Ingress applied\n");

    // await sleep(1 * 60 * 1000);

    console.log("STEP 4: Applying Cert-Manager YAML...");
    await applyYamlFromUrl();
    console.log("Cert-Manager YAML applied\n");

    // await sleep(1 * 60 * 1000);

    // console.log("STEP 5: Checking Cert-Manager deployments...");
    // await checkCertMgDeployment();
    // console.log("Cert-Manager ready\n");

    await sleep(1 * 60 * 1000);

    // console.log("STEP 6: Waiting for nginx ingress controller...");
    // await waitForNginxIngress();
    // console.log("Ingress controller ready\n");

    // await sleep(1 * 60 * 1000);

    // await sleep(1 * 60 * 1000);

    console.log("STEP 8: Create configmap for organisations...");
    await recreateConfigMap();
    console.log("PVC applied and ready\n");

    await sleep(2 * 60 * 1000);

    console.log("STEP 5: Checking Cert-Manager deployments...");
    await checkCertMgDeployment();
    console.log("Cert-Manager ready\n");

    await sleep(1 * 60 * 1000);

    console.log("STEP 6: Waiting for nginx ingress controller...");
    await waitForNginxIngress();
    console.log("Ingress controller ready\n");

    // await sleep(1 * 60 * 1000);

    console.log("STEP 9: Initializing TLS certificate Issuers...");
    await initTLSCertIssuers();
    console.log("TLS certificate Issuer Initialized and ready\n");

    await sleep(1 * 60 * 1000);

    console.log("STEP 10: Initializing TLS certificate Issuers...");
    await waitForTLSIssuerReady();
    console.log("TLS certificate Issuer Initialized and ready\n");

    // await sleep(1 * 60 * 1000);

    console.log("STEP 11: Generate TLS Issuers...");
    await generateTLS();
    console.log("Generated TLS Issuers and now ready\n");

    await sleep(1 * 60 * 1000);

     console.log("STEP 12: Applying CA Yaml To Organisation Namespace...");
    await applyCAYamlToNamespace("kube/org0/org0-ca.yaml", process.env.ORG0_NS);
    await applyCAYamlToNamespace("kube/org1/org1-ca.yaml", process.env.ORG1_NS);
    await applyCAYamlToNamespace("kube/org2/org2-ca.yaml", process.env.ORG2_NS);
    console.log("DOne\n");

    await sleep(1 * 60 * 1000);

    console.log("STEP 12b: Check CA deployment...");
    await checkCADeployment();
    console.log("DOne\n");

    await sleep(1 * 60 * 1000);

    console.log("STEP 13: Waiting for CA certificate Issuers...");
    await waitForIssuerReady();
    console.log("CA certificate Issuer Initialized and ready\n");

    // await sleep(1 * 60 * 1000);

    console.log("STEP 14: Creating directory...");
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

    // await sleep(1 * 60 * 1000);

    console.log("STEP 15: Reading CA's TLS certificate from the cert-manager CA secret...");
    await extractCACert(process.env.ORG0_NS, "org0-ca-tls-cert",`${process.cwd()}/build/cas/org0-ca/tlsca-cert.pem`);
    await extractCACert(process.env.ORG1_NS, "org1-ca-tls-cert",`${process.cwd()}/build/cas/org1-ca/tlsca-cert.pem`);
    await extractCACert(process.env.ORG2_NS, "org2-ca-tls-cert",`${process.cwd()}/build/cas/org2-ca/tlsca-cert.pem`);
    console.log("DOne\n");

    await sleep(1 * 60 * 1000);

    console.log("STEP 16a: Enrolling root CA Org users...");
    await enrollOrgCA()
    console.log("DOne\n");

    // await sleep(1 * 60 * 1000);

    console.log("STEP 16b: Setup Org0 Orderers...");
    await setupOrg0Orderers()
    console.log("DOne\n");

    // await sleep(1 * 60 * 1000);

    console.log("STEP 17: Setup Org Peers...");
    await setupOrgPeers()
    console.log("DOne\n");

    // await sleep(1 * 60 * 1000);

    console.log("STEP 18: Apply Orderer Yaml...");
    await applyOrdererYaml()
    console.log("DOne\n");

    await sleep(1 * 60 * 1000);

    console.log("STEP 19: Checking Orderer Deployment...");
    await checkOrdererDeployment()
    console.log("DOne\n");

    await sleep(1 * 60 * 1000);

    console.log("DOne\n");

    console.log("STEP 20b: Applying Org Peer Yaml...");
    await applyOrgPeerYaml()
    console.log("DOne\n");

    await sleep(2 * 60 * 1000);

    //moved to after setupOrgPeers
    console.log("STEP 21: Checking Org Peer Deployment...");
    await checkOrgPeerDeployment()
    console.log("DOne\n");

    // await sleep(1 * 60 * 1000);

    console.log("STEP 22: Registering Org Admins...");
    await registerOrgAdmins()
    console.log("DOne\n");

    await sleep(1 * 60 * 1000);

    console.log("STEP 22: Enrolling Org Admins...");
    await enrollOrgAdmins()
    console.log("DOne\n");

    // await sleep(1 * 60 * 1000);

    console.log("STEP 24: Creating Channel Org MSP...");
    await createChannelOrgMSP()
    console.log("DOne\n");

    // await sleep(1 * 60 * 1000);

    console.log("STEP 25: Extracting Orderer Cert...");
    await extractOrdererCert()
    console.log("DOne\n");

    // await sleep(1 * 60 * 1000);

    console.log("STEP 26: Creating Genesis Block...");
    await createGenesisBlock()
    console.log("DOne\n");

    await sleep(1 * 60 * 1000);

    console.log("STEP 27: Joining Channel Orderers...");
    await joinChannelOrderers()
    console.log("DOne\n");

    // await sleep(1 * 60 * 1000);

    console.log("STEP 28: Joining Channel Peers...");
    await joinChannelPeers()
    console.log("DOne\n");

    // await sleep(1 * 60 * 1000);

    console.log("STEP 29a: Apply Registry Secret...");
    await applyRegistrySecret()
    console.log("Done\n");

    await sleep(1 * 60 * 1000);

    console.log("STEP 29b: Deploying Chaincode...");
    await deployChaincode("../ccaas/chaincode-go")
    console.log("Done\n");

    // await sleep(1 * 60 * 1000);

    console.log("STEP 30: Invoking Chaincode...");
    await invokeChaincode(q)
    console.log("DOne\n");

    // await sleep(1 * 60 * 1000);

    console.log("STEP 31: Querying Chaincode...");
    await queryChaincode()
    console.log("DOne\n");

    // await sleep(1 * 60 * 1000);

    console.log("\n🎉 ALL STEPS COMPLETED SUCCESSFULLY!\n");

  } catch (err) {
    console.error("SETUP FAILED:", err);
    process.exit(1);
  }
};

module.exports = {
    applyYamlFromUrl,
    preStartUpConfig,
    launchDockerRegistry, 
    initIngress,
    createNS,
    pvApply,
    // pvcApply,
    checkCertMgDeployment,
    waitForNginxIngress,
    recreateConfigMap,
    initTLSCertIssuers,
    waitForTLSIssuerReady,
    waitForIssuerReady,
    generateTLS,
    waitForGeneratedIssuerReady,
    applyCAYamlToNamespace,
    extractCACert,
    enrollOrgCA,
    setupOrg0Orderers,
    setupOrgPeers,
    applyOrdererYaml,
    checkOrdererDeployment,
    applyOrgPeerYaml,
    checkOrgPeerDeployment,
    registerOrgAdmins,
    enrollOrgAdmins,
    // createMspConfigYaml,
    createChannelOrgMSP,
    extractOrdererCert,
    createGenesisBlock,
    joinChannelOrderers,
    joinChannelPeers,
    deployChaincode,
    applyCertificate,
    invokeChaincode,
    queryChaincode,
    waitForTLSSecret,
    checkCADeployment,
    extractCASecreteCreateMspConfig,
    extractCASignAuth,
    mountMSPConfig,
    applyRegistrySecret,
    runSetup
};