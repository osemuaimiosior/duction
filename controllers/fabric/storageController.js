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

const applyNewPV = async (req, res) => {

  const org = req.params.ORGANIZATION;
  const pvFile = './kube/pv-fabric-org-template.yaml'
  
  let content = fs.readFileSync(pvFile, 'utf8');
  content = content.replace(/{{ORG}}/g, org);
  const obj = yaml.load(content);

    try {

      await client.create(obj);
      console.log(`Resource created: ${obj.metadata.name}`);
      return;

    } catch (err) {

      if (err.body && err.body.reason === 'AlreadyExists') {
        try {
        
          await client.patch(

            {
              apiVersion: obj.apiVersion,
              kind: obj.kind,
              metadata: { 
                name: obj.metadata.name, 
              }
            },
            obj,
            undefined,
            undefined,
            undefined,
            {
              headers: { "Content-Type": "application/merge-patch+json" }
            }
          );

          console.log(`Resource patched: ${obj.metadata.name}`);
          
        } catch (patchErr) {
          // console.error(`Failed to patch ${obj.metadata.name}, ${obj.metadata.name} already exist`);
          console.error(`Failed to patch ${obj.metadata.name}:`, patchErr.body || patchErr);
        }
      } else {
        console.error(`${obj.metadata.name} already exist`);
        // console.error(`Failed to create ${dps[i].metadata.name}:`, err.body || err);
      }
    }
};

const applyNewOrgPVC = async (req, res) => {
  const org = req.params.ORGANIZATION;
  const file = "./kube/pvc-fabric-template.yaml";

  await createOrgNS();
  await sleep(0.5 * 60 * 1000);

  let content = fs.readFileSync(file, "utf8");
  content = content.replace(/{{ORG}}/g, org);
  const docs = yaml.loadAll(content);
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

      } catch (patchErr) {
        console.log(`Failed to skip ${name}:`, patchErr.response?.body || patchErr);
      }
    } else {
      console.log(`${name} already exsit in the cluster`);
    }
  };
};

module.exports = {
	applyNewPV,
  applyNewOrgPVC
}