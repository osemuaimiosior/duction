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

function shOutput(cmd) {
  return execSync(cmd, { encoding: "utf-8" }).trim();
}

function sh(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

async function registerNewPeer (DOMAIN, NGINX_HTTPS_PORT, RCAADMIN_USER, ORG, PEER_NUMBER, PEER_PASSWORD) {
  // const { DOMAIN, NGINX_HTTPS_PORT, RCAADMIN_USER } = process.env;
    const base = process.cwd();

    const peer = `${ORG}-peer${PEER_NUMBER}`;
    const orgCA = `${ORG}-ca`
    const peerPw = PEER_PASSWORD;

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

    const tlsCert = `${base}/build/cas/${orgCA}/tlsca-cert.pem`;
    const adminMsp = `${base}/build/enrollments/${ORG}/users/${RCAADMIN_USER}/msp`;

    const caClientPath = path.join(base, "bin", "fabric-ca-client");

    // Safety check
    await execAsync(`chmod +x ${caClientPath}`);

    const cmd = `${caClientPath} register \
        --id.name ${peer} \
        --id.secret ${peerPw} \
        --id.type peer \
        --url https://${orgCA}.${DOMAIN}:${NGINX_HTTPS_PORT} \
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
};

// async function mountMSPConfig(ORG, PEER_NUMBER) {

//     const peer = `${ORG}-peer${PEER_NUMBER}`;
//     const org = ORG

//     //Load file, replace content and use that for the next process step.
//     const localFile = path.join(__dirname, "..", "kube", "org-template", "msp-config.yaml");
    
//     // Read the template file
//     let content = await fsp.readFile(localFile, "utf8");

//     content = content
//         .replace(/{{CHAINCODE_NAME}}/g, cc_name)
//         .replace(/{{CHAINCODE_ID}}/g, CHAINCODE_ID)
//         .replace(/{{CHAINCODE_IMAGE}}/g, CHAINCODE_IMAGE)
//         .replace(/{{GHCR_SECRET_NAME}}/g, GHCR_SECRET_NAME)
//         .replace(/{{PEER_NAME}}/g, peer);

//     const outputPath = path.join(__dirname, "..", "kube", "org-template", `msp-config${peer}.yaml`);
//     await fsp.writeFile(outputPath, content);

//     const cmd = `kubectl -n ${org} create configmap ${peer}-msp-config --from-file=config.yaml=${outputPath} --dry-run=client -o yaml | kubectl apply -f - `;

//     try {
//       const { stdout, stderr } = await execAsync(cmd);

//       if (stdout) {
//         console.log(`[${org}] MSP ConfigMap applied:\n`, stdout);
//       }

//       if (stderr) {
//         console.error(`[${org}] STDERR:\n`, stderr);
//       }

//     } catch (err) {
//       console.error(`[${org}] Failed to apply MSP ConfigMap`, err);
//       throw err;
//     };

//     await fsp.unlink(outputPath);
// }

async function mountMSPConfig(ORG, PEER_NUMBER) {
  const peer = `${ORG}-peer${PEER_NUMBER}`;
  const org = ORG;

  const localFile = path.join(__dirname, "..", "kube", "org-template", "msp-config.yaml");

  let content = await fsp.readFile(localFile, "utf8");

  content = content.replace(/{{ORG}}/g, org)

  const createCmd = `kubectl -n ${org} create configmap ${peer}-msp-config \
    --from-file=config.yaml=/dev/stdin \
    --dry-run=client -o yaml | kubectl apply -f -`;

  try {
    const { stdout, stderr } = await execAsync(createCmd, {
      input: content
    });

    if (stdout) console.log(`[${org}] MSP ConfigMap applied:\n`, stdout);
    if (stderr) console.error(`[${org}] STDERR:\n`, stderr);

  } catch (err) {
    console.error(`[${org}] Failed to apply MSP ConfigMap`, err);
    throw err;
  }
}

async function enrollPeerInsidePod(ORG, PEER_NUMBER, PEER_PASSWORD) {

    const org = ORG;
    const peerNumber = PEER_NUMBER;
    const peerPwd = PEER_PASSWORD;


    const podCmd = `
      set -x
      export FABRIC_CA_CLIENT_HOME=/var/hyperledger/fabric-ca-client
      export FABRIC_CA_CLIENT_TLS_CERTFILES=/var/hyperledger/fabric/config/tls/ca.crt

      MSP_DIR=/var/hyperledger/fabric/organizations/peerOrganizations/${org}.example.com/peers/${org}-peer${peerNumber}.${org}.example.com/msp

      mkdir -p "$MSP_DIR"

      fabric-ca-client enroll \
        --url https://${org}-peer${peerNumber}:${peerPwd}@${org}-ca \
        --csr.hosts localhost,${org}-peer,${org}-peer-gateway-svc \
        --mspdir "$MSP_DIR"
      `;

    try {
      const ocm =  `kubectl -n ${org} exec deploy/${org}-ca -i -- /bin/sh << 'EOF'\n${podCmd}\nEOF`

      const stdout1 = await execAsync(ocm);

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
};

const setupNewOrgPeers = async (req, res) => {
  const { DOMAIN, NGINX_HTTPS_PORT, RCAADMIN_USER, ORG, PEER_NUMBER, PEER_PASSWORD} = req.body;
  
  await registerNewPeer(DOMAIN, NGINX_HTTPS_PORT, RCAADMIN_USER, ORG, PEER_NUMBER, PEER_PASSWORD);
  await enrollPeerInsidePod(ORG, PEER_NUMBER, PEER_PASSWORD);
  await mountMSPConfig(ORG, PEER_NUMBER);
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

const applyNewOrgPeerYaml = async (req, res) => {

  const namespace = req.params.NAME_SPACE;
  const org = req.params.ORGANISATION;
  const peerNumber = req.params.PEER_NUMBER;
  const peer = `${org}-peer${peerNumber}`;

  try {
    // const yamlPath = `kube/${namespace}/${p}.yaml`;
    const yamlPath = path.join(__dirname, "..", "kube", "org-template", "org-peer.yaml");

    let yamlContent = fs.readFileSync(yamlPath, "utf8");

    yamlContent = yamlContent.replace();

    const out = await kubectlApplyFromString(yamlContent, namespace);
    // console.log(out);
    console.log(`${peer} applied successfully`);

  } catch (err) {
    console.error(`Failed to apply ${peer}.yaml: `, err);
  }
};

const checkNewOrgPeerDeployment = async () => {
  const peerNumber = req.params.PEER_NUMBER;
  const org = req.params.ORGANISATION;
  const name = `${org}-peer${peerNumber}`;
  const namespace = req.params.NAME_SPACE;

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

    } catch (err) {
      // Deployment not created yet
      const parsedErr = err.body || "{}";

      if (parsedErr.reason === "NotFound") {
        console.log(`${name} not found yet, waiting...`);
      } else {
        console.error("Unexpected error:", err);
      }
    }
  }
};


module.exports = {
    setupNewOrgPeers,
    applyNewOrgPeerYaml,
    checkNewOrgPeerDeployment
}