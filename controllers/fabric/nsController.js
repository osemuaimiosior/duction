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

const createNewNamespace = async (req, res) => {
  const nsName = req.params.NAME_SPACE;
  
  try {
    // List existing namespaces
    const existingResponse = await k8sApi.listNamespace();

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

  module.exports = {
	createNewNamespace
}