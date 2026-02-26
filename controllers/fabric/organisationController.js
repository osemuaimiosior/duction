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

const registerNewOrgAdmin = async (req, res) => {

  const { DOMAIN, ORG, NGINX_HTTPS_PORT, RCAADMIN_USER_NAME, ADMIN_NAME, ADMIN_PASSWORD} = req.body;
  const base = process.cwd();

  const org = ORG;
  const orgAdmin = ADMIN_NAME;
  const adminPwd = ADMIN_PASSWORD;

  const caClientPath = path.join(base, "bin", "fabric-ca-client");

  // Safety check
  await execAsync(`chmod +x ${caClientPath}`);
  
  const cmd = `${caClientPath}  register \
    --id.name       ${orgAdmin} \
    --id.secret     ${adminPwd} \
    --id.type       admin \
    --url           https://${org}-ca.${DOMAIN}:${NGINX_HTTPS_PORT} \
    --tls.certfiles ${base}/build/cas/${org}-ca/tlsca-cert.pem \
    --mspdir        ${base}/build/enrollments/${org}/users/${RCAADMIN_USER_NAME}/msp \
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
};

const enrollNewOrgAdmin = async (req, res) => {

  const { DOMAIN, ORGANISATION, RCAADMIN_USER_NAME, ADMIN_NAME, ADMIN_PASSWORD, NGINX_HTTPS_PORT} = req.body;
  const base = process.cwd();

  ENROLLMENTS_DIR=`${base}/build/enrollments`
 
  const org = ORGANISATION;

  const ORG_ADMIN_DIR = `${ENROLLMENTS_DIR}/${org}/users/${RCAADMIN_USER_NAME}`;


  if (
    fs.existsSync(`${ORG_ADMIN_DIR}/msp/keystore/key.pem`) &&
    fs.existsSync(`${ORG_ADMIN_DIR}/tls/keystore/key.pem`)
  ) {
    console.log(`Found existing admin enrollment at ${ORG_ADMIN_DIR}`);
  }

  const CA_NAME = `${org}-ca`;
  const CA_DIR = `${base}/build/cas/${CA_NAME}`;
  const CA_AUTH = `${ADMIN_NAME}:${ADMIN_PASSWORD}`;
  const CA_HOST = `${CA_NAME}.${DOMAIN}`;
  const CA_URL = `https://${CA_AUTH}@${CA_HOST}:${NGINX_HTTPS_PORT}`;

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


module.exports = {
    registerNewOrgAdmin,
    enrollNewOrgAdmin
}