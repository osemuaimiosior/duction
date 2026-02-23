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

const initNewTLSCertIssuer = async (req, res) => {

    const namespace = req.params.NAME_SPACE;
    
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();

    const customApi = kc.makeApiClient(k8s.CustomObjectsApi);
   

    const b = process.cwd();
    const filePath = `${b}/kube/root-tls-cert-issuer.yaml`;
    const base = yaml.load(fs.readFileSync(filePath, "utf8"));

    try {
        const issuer = JSON.parse(JSON.stringify(base)); 
        issuer.metadata.namespace = namespace;

        await customApi.createNamespacedCustomObject(
        "cert-manager.io",   // group
        "v1",                // version
        namespace,           // namespace
        "issuers",           // plural
        issuer               // body
        );

        console.log(`Created Issuer in namespace: ${namespace}`);

    } catch (err) {

        console.error(`Error creating issuer in ${namespace}: `, err.message);
    };
};

const waitForNewTLSIssuerReady = async (req, res) => {

    const timeoutMs = 3000;
    const intervalMs = 2000;
    
    const issuerName = "root-tls-cert-issuer";

    const namespace = req.params.NAME_SPACE;

    console.log(`\n=== Checking Issuer in namespace: ${namespace} ===`);

    const start = Date.now();  // timeout resets for each namespace

    while (Date.now() - start < timeoutMs) {
      try {
        const res = await customApi.getNamespacedCustomObject(
          "cert-manager.io",
          "v1",
          namespace,
          "issuers",
          issuerName
        );

        const conditions = res.body.status?.conditions || [];
        const ready = conditions.find(c => c.type === "Ready" && c.status === "True");

        if (ready) {
          console.log(`Issuer "${issuerName}" is Ready in namespace ${namespace}`);
        //   break;  // go to next namespace
        }

        console.log(`Issuer in ${namespace} not ready yet...`);
        } catch (err) {
            console.log(`Issuer "${issuerName}" not found yet in ${namespace}`);
        }

      await new Promise(res => setTimeout(res, intervalMs));
    }

    // Did we fail to become ready?
    if (Date.now() - start >= timeoutMs) {
       console.log(`Timeout: Issuer "${issuerName}" not Ready in namespace ${namespace}`);
    };

    return true;
};

const generateNewTLS = async (req, res) => {

    const ns = req.params.NAME_SPACE;
    const org = req.params.ORGANIZATION;
    const commonNameDomainName = req.params.COMMON_NAME_DOMAIN_NAME;

    try {
            let yamlFilePath = path.join(__dirname,`../kube/org-template/tls-cert-issuer.yaml`);
            console.log(`Applying: ${yamlFilePath}`);

            const fileContent = fs.readFileSync(yamlFilePath, "utf8");
            let docs = yaml.loadAll(fileContent);

             // Replace placeholders
            docs = docs
                .replace(/{{ORG}}/g, org)
                .replace(/{{DOMAIN_NAME}}/g, commonNameDomainName);

            for (const doc of docs) {
            // Ensures namespace is set
            if (!doc.metadata.namespace) {
                doc.metadata.namespace = ns;
            }

            await client.create(doc);
            console.log(`Created ${doc.kind}: ${doc.metadata.name}`);
            }
        } catch (err) {
            console.error("TLS creation error:", err.body.reason || err.body.status);
        };  
};

module.exports = {
	initIngress,
    initNewTLSCertIssuer,
    waitForNewTLSIssuerReady,
    generateNewTLS
}