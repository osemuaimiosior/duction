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
};

function sh(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
};

async function extractCASignAuth ( DOMAIN, NGINX_HTTPS_PORT, NAME_SPACE, ORGANISATION, TYPE) {
    const base = process.cwd();
    const namespace = NAME_SPACE;
    const org = ORGANISATION;

    const type = TYPE; //peer or orderer
    const caName = `${org}-ca`;

    const ORG_MSP_DIR =`${base}/build/channel-msp/${type}Organizations/${namespace}/msp`;

    //CREATE FULL DIRECTORY TREE
    await fsp.mkdir(`${ORG_MSP_DIR}/cacerts`, { recursive: true });

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

//Create channel org MSP   # extract the CA's TLS CA certificate from the cert-manager secret
async function extractCASecreteCreateMspConfig (NAME_SPACE, ORGANISATION, TYPE) {
    const base = process.cwd();
    const namespace = NAME_SPACE;
    const org = ORGANISATION;

    const type = TYPE; //orderer or peer;
    const caName = `${org}-ca`;

    const ORG_MSP_DIR = `${base}/build/channel-msp/${type}Organizations/${namespace}/msp`;

    //Ensure directories exist (idempotent)
    await fsp.mkdir(`${ORG_MSP_DIR}/tlscacerts`, { recursive: true });

    const cmd = `
      kubectl -n ${namespace} get secret ${caName}-tls-cert -o json \
        | jq -r '.data["ca.crt"]' \
        | base64 -d \
        > ${ORG_MSP_DIR}/tlscacerts/tlsca-signcert.pem
    `;

    try {
      await execAsync(cmd);
      console.log(`TLS CA cert extracted for ${namespace}`);
    } catch (err) {
      console.error(`TLS extraction failed for ${namespace}`, err);
      throw err;
    }

    await createMspConfigYaml(caName, "ca-signcert.pem", ORG_MSP_DIR);
}

const createNewChannelOrgMSP = async (req, res) => {
  const {DOMAIN, NGINX_HTTPS_PORT, NAME_SPACE, ORGANISATION, TYPE} = req.body;
  
  await extractCASignAuth(DOMAIN, NGINX_HTTPS_PORT, NAME_SPACE, ORGANISATION, TYPE);
  await extractCASecreteCreateMspConfig(NAME_SPACE, ORGANISATION, TYPE);
};


module.exports = {
    createNewChannelOrgMSP
}