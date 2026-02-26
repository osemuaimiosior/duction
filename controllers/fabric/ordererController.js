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

async function registerNewOrderer (domain, rcaadmin_user, nginx_https_port, organisation, orderer_number, orderer_password) {

    const DOMAIN = domain;
    const RCAADMIN_USER  = rcaadmin_user;
    const NGINX_HTTPS_PORT = nginx_https_port;
    const org = organisation;
    const ord_number = orderer_number;

    const base = process.cwd();

    const od = `${org}-orderer${ord_number}`;
    const ordPwd = orderer_password;

    const tlsCert = `${base}/build/cas/${org}-ca/tlsca-cert.pem`;
    const adminMsp = `${base}/build/enrollments/${org}/users/${RCAADMIN_USER}/msp`;

    const caClientPath = path.join(base, "bin", "fabric-ca-client");

    // Safety check
    await execAsync(`chmod +x ${caClientPath}`);

    const cmd = `${caClientPath} register \
        --id.name ${od} \
        --id.secret ${ordPwd} \
        --id.type orderer \
        --url https://${org}-ca.${DOMAIN}:${NGINX_HTTPS_PORT} \
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
    };
};

async function enrollNewOrdererInsidePod (organisation, orderer_number, orderer_password) {

    const org = organisation;
    const ord_number = orderer_number;
    const ordPwd = orderer_password;
    
    const od = `${org}-orderer${ord_number}`;

    const podCmd = `
      set -x
      export FABRIC_CA_CLIENT_HOME=/var/hyperledger/fabric-ca-client
      export FABRIC_CA_CLIENT_TLS_CERTFILES=/var/hyperledger/fabric/config/tls/ca.crt

      MSP_DIR=/var/hyperledger/fabric/organizations/ordererOrganizations/${org}.example.com/orderers/${od}.${org}.example.com/msp

      mkdir -p $MSP_DIR

      fabric-ca-client enroll \
        --url https://${od}:${ordPwd}@${org}-ca \
        --csr.hosts ${org}-orderer \
        --mspdir $MSP_DIR

      # Write config.yaml
      echo "NodeOUs:
        Enable: true
        ClientOUIdentifier:
          Certificate: cacerts/${org}-ca.pem
          OrganizationalUnitIdentifier: client
        PeerOUIdentifier:
          Certificate: cacerts/${org}-ca.pem
          OrganizationalUnitIdentifier: peer
        AdminOUIdentifier:
          Certificate: cacerts/${org}-ca.pem
          OrganizationalUnitIdentifier: admin
        OrdererOUIdentifier:
          Certificate: cacerts/${org}-ca.pem
          OrganizationalUnitIdentifier: orderer" > /var/hyperledger/fabric/organizations/ordererOrganizations/${org}.example.com/orderers/${od}.${org}.example.com/msp/config.yaml
    `;

    try {
      console.log(`Executing enrollment of ${od} inside pod...`);

      const com = `kubectl -n ${org} exec deploy/${org}-ca -i -- /bin/sh << 'EOF'\n${podCmd}\nEOF`;

      const { stdout } = await execAsync(com);
      console.log("Orderer enrollment completed inside pod");

    } catch (err) {
      console.log("Enrollment inside CA pod failed ", err.stderr);
      // throw err;
    };
};

const setupNewOrg0Orderers = async (req, res) => {
  const domain = req.body.DOMAIN
  const rcaadmin_user  = req.body.RCAADMIN_USER
  const nginx_https_port = req.body.NGINX_HTTPS_PORT
  const orderer_password = req.body.ORDERER_PASSWORD;
  const organisation = req.body.ORGANISATION;
  const orderer_number = req.body.ORDERER_NUMBER;
  
  await registerNewOrderer(domain, rcaadmin_user, nginx_https_port, organisation, orderer_number, orderer_password);
  await enrollNewOrdererInsidePod(organisation, orderer_number, orderer_password);
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

const applyNewOrdererYaml = async (req, res) => {
  
  const namespace = req.params.NAME_SPACE;
  const org = req.params.ORGANISATION;
  const ordererNumber = req.params.ORDERER_NUMBER;
  const orderer = `${org}-orderer${ordererNumber}`;
  
  const yamlPath = path.join(__dirname, "..", "kube", "orderer-template", "org-orderer.yaml");
  let yamlContent = fs.readFileSync(yamlPath, "utf8");

  yamlContent = yamlContent.replace();

  const out = await kubectlApplyFromString(yamlContent, namespace);
  // console.log(out);
  console.log(`${orderer}.yaml applied successfully`);
};

const checkNewOrdererDeployment = async (req, res) => {
    
    const ordererNumber = req.params.ORDEERER_NUMBER;
    const org = req.params.ORGANISATION;

    const name = `${org}-orderer${ordererNumber}`;

    const namespace = req.params.NAME_SPACE;


    if(process.env.ORDERER_TYPE === "bft" && name === "org0-orderer4"){

    };

    console.log(`Checking deployment: ${name}`);
    // console.log(getType(name));

    const timeoutMs = 5 * 60 * 1000; // 5 minutes
    // const intervalMs = 1 * 60 * 1000; // 2 minutes
    // const endTime = Date.now() + timeoutMs;

    try {
      // Must pass name and namespace as direct args

      // if(process.env.ORDERER_TYPE === "bft" && name === "org0-orderer4"){

      //   const res = await k8sApi2.readNamespacedDeployment(name, namespace);
      //   console.log("from orderer: ", res.body.status);
      //   console.log("from orderer: ", res.body.status.conditions);

      //   const status = res.body.status;
      //   const ready = status.readyReplicas || 0;
      //   const desired = status.replicas || 0;

      //   console.log(`${name}: ${ready}/${desired} ready`);

      //   if (ready === desired && desired > 0) {
      //     console.log(`${name} rollout complete`);
      //   } else {
      //     console.log(`${name} initializing...`);
      //   }
      // };

      const res = await k8sApi2.readNamespacedDeployment(name, namespace);
      // console.log("from orderer: ", res.body.status);
      // console.log("from orderer: ", res.body.status.conditions);

      const status = res.body.status;
      const ready = status.readyReplicas || 0;
      const desired = status.replicas || 0;

      console.log(`${name}: ${ready}/${desired} ready`);

      if (ready === desired && desired > 0) {
        console.log(`${name} rollout complete`);
        
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


  return true;
};

const extractNewOrdererCert = async (req, res) => {
    const org = req.params.ORGANISATION;
    const namespace = req.params.NAME_SPACE;
    const ordererNumber = req.params.ORDERER_NUMBER;
    const base = process.cwd();

    const ord = `orderer${ordererNumber}`;

    const ORDERER_TLS_DIR=`${base}/build/channel-msp/ordererOrganizations/${org}/orderers/${org}-${ord}/tls`;
    await fsp.mkdir(`${ORDERER_TLS_DIR}/signcerts`, { recursive: true });

    try {
      const cmd = `
        kubectl get secret -n ${namespace} ${org}-${ord}-tls-cert -o json \
          | jq -r '.data["tls.crt"]' \
          | base64 -d \
          > ${ORDERER_TLS_DIR}/signcerts/tls-cert.pem
      `;
     
      console.log('Executing get Secret');

      await execAsync(cmd);

      const cmdd = `kubectl get pods -n ${namespace} -l app=${org}-${ord} -o jsonpath='{.items[0].metadata.name}'`

      const output = await execAsync(cmdd);

      if(!output.stdout || output.stdout === undefined) { console.log(output, "is empty or undefined");};

      const POD_NAME = output.stdout;
      // console.log(POD_NAME);

      if(!POD_NAME) console.log(`Error: No Pod found with label app=${org}-${ord} in namespace ${org}`);

      //Copy the enrollment certificate from the pod to the local machine
      const cmd0 = `
        kubectl -n ${namespace} cp ${POD_NAME}:var/hyperledger/fabric/organizations/ordererOrganizations/${org}.example.com/orderers/${org}-${ord}.${org}.example.com/msp/signcerts/cert.pem ${base}/build/channel-msp/ordererOrganizations/${org}/orderers/${org}-${ord}/cert.pem`

      console.log('Executing copying the enrollment certificate from the pod to the local machine');

      const newOutput = await execAsync(cmd0);

      if (newOutput.stderr) console.error("stderr:", newOutput.stderr);

    } catch (err) {

      if(err.killed === false) {
        console.log("Error executing this command: ", err.cmd);
      }
    };
};

const joinChannelNewOrderer = async (req, res) => {
    const {CHANNEL_NAME, DOMAIN, NGINX_HTTPS_PORT, ORGANISATION, RCAADMIN_NAME} = req.body;
    console.log(`Joining orderers to channel ${CHANNEL_NAME}`);

    const base = process.cwd();
    const TEMP_DIR = `${base}/build`;
    const org = ORGANISATION;

    const ord = `orderer${ORDERER_NUMBER}`;

    const OSNADMIN = path.join(base, "bin", "osnadmin");
    await execAsync(`chmod +x ${OSNADMIN}`);

    const cmd = `${OSNADMIN} channel join \
      --orderer-address ${org}-${ord}-admin.${DOMAIN}:${NGINX_HTTPS_PORT} \
      --ca-file         ${TEMP_DIR}/channel-msp/ordererOrganizations/${org}/orderers/${org}-${ord}/tls/signcerts/tls-cert.pem \
      --client-cert     ${TEMP_DIR}/enrollments/${org}/users/${RCAADMIN_NAME}/tls/msp/signcerts/cert.pem \
      --client-key      ${TEMP_DIR}/enrollments/${org}/users/${RCAADMIN_NAME}/tls/msp/keystore/key.pem \
      --channelID       ${CHANNEL_NAME} \
      --config-block    ${TEMP_DIR}/genesis_block.pb
    `;

    const { stdout, stderr } = await execAsync(cmd);

    if (stderr) console.error("stderr:", stderr);
    console.log("stdout:" , stdout);
  };

module.exports = {
    setupNewOrg0Orderers,
    applyNewOrdererYaml,
    checkNewOrdererDeployment,
    extractNewOrdererCert,
    joinChannelNewOrderer
}