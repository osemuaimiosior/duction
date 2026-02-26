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

async function applyYamlFromUrl() {
  
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
module.exports = {
	applyYamlFromUrl
}