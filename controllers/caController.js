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

const applyNewCAYamlToNamespace = async (req, res) => {
  const filePath = "kube/orderer-template/ca.yaml";
  const _namespace = req.params.NAME_SPACE;
  
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

const checkNewCADeployment = async (req, res) => {
    const org = req.params.ORGANISATION;
    const intervalMs = 60_000; // 1 minute

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
};

module.exports = {
    applyNewCAYamlToNamespace,
    checkNewCADeployment
}