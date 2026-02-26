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

const createNewConfigMap = async (req, res) => {
  const {ORG, NAME_SPACE, TYPE} = req.body
  let org;

  if(TYPE == "orderer") {
     org = { 
        name: `${ORG}`, 
        namespace: `${NAME_SPACE}`, 
        folder: "config/ordererOrg-template"
      };
  } else if(TYPE == "peer") {
     org = { 
        name: `${ORG}`, 
        namespace: `${NAME_SPACE}`, 
        folder: "config/peerOrg-template"
      };
  
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
};

const creatingCABuildDirectory = async (req, res) => {
  const org = req.params.ORGANISATION;
  fs.mkdir(`${process.cwd()}/build/cas/${org}-ca`, { recursive: true }, (err) => {
        if (err) console.log(`Error while creating directory ${org}-ca\n`);
      });
}

// const createNewGenesisBlock = async (req, res) => {
//   console.log("Creating channel genesis block");

//   const CHANNEL_NAME = req.params.CHANNEL_NAME;
//   const base = process.cwd();
//   let profile;
//   let inputFile;
  
//   const outputFile = `${base}/build/configtx.yaml`;

//   if (process.env.ORDERER_TYPE === "bft"){
//     inputFile = `${base}/config/ordererOrg-template/bft/configtx-template.yaml`;
//     profile = "ChannelUsingBFT";
//   } else {
//     inputFile = `${base}/config/ordererOrg-template/configtx-template.yaml`;
//     profile = "TwoOrgsApplicationGenesis";
//   }

//   try {
//     // 1. Read template
//     let template = await fsp.readFile(inputFile, "utf8");

//     // 2. Substitute environment variables
//     // const rendered = await substituteEnvVariables(template, process.env);

//     template = template
//         .replace(/{{CHAINCODE_NAME}}/g, cc_name)
//         .replace(/{{CHAINCODE_ID}}/g, CHAINCODE_ID)
//         .replace(/{{CHAINCODE_IMAGE}}/g, CHAINCODE_IMAGE)
//         .replace(/{{GHCR_SECRET_NAME}}/g, GHCR_SECRET_NAME)
//         .replace(/{{PEER_NAME}}/g, peer);

//     // 3. Write output configtx.yaml
//     await fsp.writeFile(outputFile, template, "utf8");
//     console.log("configtx.yaml generated");

//     // 4. Absolute path to configtxgen (IMPORTANT)
//     const CONFIGTXGEN = path.join(base, "bin", "configtxgen");

//     // Safety check
//     await execAsync(`chmod +x ${CONFIGTXGEN}`);


//     // 5. Run configtxgen
//     const cmd = ` FABRIC_CFG_PATH=${base}/build \
//         ${CONFIGTXGEN} \
//         -profile ${profile} \
//         -channelID ${CHANNEL_NAME} \
//         -outputBlock ${base}/build/genesis_block.pb
//       `;

//     const anyOutput = await execAsync(cmd);
//     console.log("genesis_block.pb generated");

//     if(anyOutput.stdout) {
//       console.log(anyOutput.stdout);
//     } else if (anyOutput.stderr){
//       console.log(anyOutput.stderr);
//     }
  
//   } catch (err) {
//     console.error("Error creating genesis block:", err.stderr || err);
//   }
// };



module.exports = {
	createNewConfigMap,
  creatingCABuildDirectory,
  // createNewGenesisBlock
}