const path = require("path");
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// ==============================
// Node Heartbeat Monitoring Script
// ==============================

// Import necessary modules
const axios = require("axios"); // For sending HTTP requests (currently unused)
const os = require("os"); // Node.js built-in module for OS info
const { OSUtils } = require("node-os-utils"); // Provides CPU, memory, disk stats easily
const osu = new OSUtils(); // Initialize OS utilities
// const nodeState = require("../config/model/nodeHeartBeat"); // Database model for node heartbeats
// const queueConnection = require('../config/db/queue');
// const { Queue, Worker} = require('bullmq');

const { exit } = require("process");
const { exec } = require("child_process");
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');


// ==============================
// Global Variables
// ==============================

const PROTO_PATH = path.join(__dirname, '..', 'registry.proto');
const packageDefinition = protoLoader.loadSync(
    PROTO_PATH,
    {keepCase: true,
     longs: String,
     enums: String,
     defaults: true,
     oneofs: true
    });
const protoDescriptor = grpc.loadPackageDefinition(packageDefinition).registry;
const registryServerAddr = process.env.REGISTRY_SERVER_ADDRESS;
if (!registryServerAddr || typeof registryServerAddr !== 'string') {
  throw new Error('Missing or invalid REGISTRY_SERVER_ADDRESS; verify the .env file is loaded from the repository root and contains a valid string');
}
const client = new protoDescriptor.Registry(registryServerAddr, grpc.credentials.createInsecure());


const QUEU_SERVER_PROTO_PATH = path.join(__dirname, '..', 'queue.proto');
const queueServerpackageDefinition = protoLoader.loadSync(
    QUEU_SERVER_PROTO_PATH,
    {keepCase: true,
     longs: String,
     enums: String,
     defaults: true,
     oneofs: true
    });
const queueServerprotoDescriptor = grpc.loadPackageDefinition(queueServerpackageDefinition).nodeDetails;
const queueServerAddr = process.env.QUEUE_SERVER_ADDRESS;
if (!queueServerAddr || typeof queueServerAddr !== 'string') {
  throw new Error('Missing or invalid QUEUE_SERVER_ADDRESS; verify the .env file is loaded from the repository root and contains a valid string');
}
const queueServerClient = new queueServerprotoDescriptor.NodeDetails(queueServerAddr, grpc.credentials.createInsecure());


let NODE_CHANNEL =""; // Redis queue for this node
const url = "http://localhost:3000/api/v1/send-heartBeat-queue";
const cpuCores = os.cpus().length; // Number of CPU cores on the machine


// ==============================
// Function: getCPUStat
// Purpose: Collect system stats and send heartbeat
// ==============================

async function getCPUStat(NODE_CODE, HOST_NAME){

  try {
   const feedback = await new Promise((resolve, reject) => {
   
         client.checkNodeDetails({ 
             NODE_CODE, HOST_NAME
           }, (err, response) => {
   
             if (err) {
               return reject(err);
             }
             resolve(response);
           });
   
       });
    
      // console.log(feedback);
      // console.log("checkNodeDetails: ", feedback);

    if(feedback.details !== "done") {
      console.log("Invalid node sender details from heartBeat.js")
      // exit(1)
    };

  } catch (error){

    console.error("Failed:", error.response?.data || error.message);
  };
  

  // Shortcuts for OS utilities
  const cpu = osu.cpu
  const mem = osu.memory
  const overV = osu.overview() // Full overview of system stats
    /**
     * CPU Usage ouput data
     * {
        success: true,
        data: 4.651162790697675, // CPU usage % utilization
        timestamp: 1772802409876, // Measurement time
        cached: false,
        platform: 'linux' // OS
      }
     */

  // ------------------------------
  // Get CPU Usage
  // ------------------------------

    const cpuInfo = await cpu.usage();

    /**
     * Memory Output data
     * {
        success: true,
        data: {
          total: DataSize { bytes: 5158723584 }, // Total RAM
          available: DataSize { bytes: 2806730752 }, // Available RAM
          used: DataSize { bytes: 2351992832 }, // Used RAM
          free: DataSize { bytes: 2369638400 }, // Free RAM
          cached: DataSize { bytes: 407662592 },
          buffers: DataSize { bytes: 128364544 },
          usagePercentage: 45.5925345427463
        },
        timestamp: 1772802409878,
        cached: false,
        platform: 'linux'
      }
     */

  // ------------------------------
  // Get Memory Usage
  // ------------------------------

    const memInfo = await mem.info();

    /**
     *   {
          platform: 'linux',
          timestamp: 1772802409876,
          system: {
            hostname: 'Osemudiamhen',
            platform: 'linux',
            distro: 'linux',
            release: '6.6.87.2-microsoft-standard-WSL2',
            kernel: 'unknown',
            arch: 'x86_64',
            uptime: 198408360,
            uptimeSeconds: 198408.36,
            bootTime: 1772604001294,
            loadAverage: [Object],
            userCount: undefined,
            processCount: undefined,
            time: 1772802409655,
            timezone: 'Africa/Lagos'
          },
          cpu: { usage: 4.651162790697675 },
          memory: {
            total: '4.80 GB',
            used: '2.19 GB',
            available: '2.61 GB',
            usagePercentage: 45.57,
            swap: [Object]
          },
          disk: {
            total: [DataSize],
            used: [DataSize],
            available: [DataSize],
            usagePercentage: 30.73,
            disks: 31
          },
          network: {
            interfaces: 6,
            activeInterfaces: 1,
            totalRxBytes: [DataSize],
            totalTxBytes: [DataSize],
            totalPackets: 4949294,
            totalErrors: 0
          },
          processes: {
            total: 0,
            running: 0,
            sleeping: 0,
            waiting: 0,
            zombie: 0,
            stopped: 0,
            unknown: 0,
            totalCpuUsage: 0,
            totalMemoryUsage: [DataSize]
          }
        }
     */

  // ------------------------------
  // Get Full System Overview
  // Includes disk, network, processes, uptime, etc.
  // ------------------------------

    const overVInfo = await overV;
    // console.log("Processes Information",overVInfo.processes);
    // console.log("System hostname:", overVInfo.system.hostname);

    NODE_CHANNEL =  "node" + "-" + overVInfo.system.hostname + "-" + NODE_CODE;
    const expectedID = `node-${HOST_NAME}-${NODE_CODE}`;

    if( expectedID !== NODE_CHANNEL){
        console.log(`Invalid from ${expectedID}`);

        // TODO: Disable this node in the database if it doesn't match
    }

    try {
    
      // ------------------------------
      // Prepare Node Heartbeat Payload
      // ------------------------------

      const nodeId = NODE_CHANNEL
    
        // Convert bytes → GB
        const ramTotalGB = +(memInfo.data.total.bytes / (1024 ** 3)).toFixed(2)
        const ramFreeGB  = +(memInfo.data.available.bytes / (1024 ** 3)).toFixed(2)
    
        const uptimeSeconds = Math.floor(overVInfo.system.uptimeSeconds)
    
        const now = new Date();

        // Node score calculation based on CPU cores, free RAM, and CPU usage
        const node_Score = (cpuCores * 5) + (ramFreeGB * 3) + (100 - cpuInfo.data) * 0.5

        const nodeSystemInfo = overVInfo.system; 
        const nodePlatformInfo = overVInfo.platform;
        const clIResult = await getOpenCLInfo();
        const clInformation = parseCLInfo(clIResult);
        // console.log("CL Information: ", clInformation)
    
        // Heartbeat payload to send to Redis queue or DB
        const nodePayload = {
    
          nodeId: nodeId,
          
          state: "heartBeat",
    
          cpuUsage: cpuInfo.data,

          systemInfo: nodeSystemInfo,

          clInfo: clInformation,

          platform: nodePlatformInfo,
    
          cpuCores: cpuCores,
    
          ramTotal: ramTotalGB,
    
          ramFree: ramFreeGB,
    
          gpuUtilization: null,

          gpuMemoryFree: null,
          
          temperature: null,
    
          simulationsPerSecond: null,
    
          uptime: uptimeSeconds,
    
          nodeStatus: "online",
    
          // jobStatus: "idle",
    
          nodeScore: node_Score,
    
          lastHeartbeat: now
    
        }

      // ===== Send heartbeat Request =====

      const feedback = await new Promise((resolve, reject) => {

      queueServerClient.heartBeatSignal({
          QUEUE_NAME: NODE_CHANNEL,
          QUEUE_PAYLOAD: JSON.stringify(nodePayload),
          NODE_ID: nodeId
        }, (err, response) => {

          if (err) {
            return reject(err);
          }
          resolve(response);
        });

    });

    // console.log("heartBeatSignal: ", feedback)
     
    // if (!feedback.data) {
    //     console.log(`POST request failed from line 251 of heartBeat.js file: ${feedback.status} ${feedback.statusText}`);
    // }

    // if(feedback.data.status === 200){
    //   console.log("Node heartbeat saved:", nodeId)
    // };

    // if(feedback.data.status === 400){
    //   console.log("Node heartbeat failed:", nodeId)
    //   exit(1);
    // };

    return feedback;
    
    } catch (error) {
  
      console.error("Error saving node stats:", error)
  
    }
    
};

// ==============================
// Function: sendHeartBeat
// Purpose: Read environment variables and trigger heartbeat
// ==============================

async function sendHeartBeat(){
  const nodeCode = process.env.NODE_CODE; // Unique code for this node
  //make sure node-code exist in directory and get registered hostname

  const hostName = process.env.HOST_NAME; // Hostname registration
  await getCPUStat(nodeCode, hostName);
};

function getOpenCLInfo() {
  return new Promise((resolve, reject) => {
    exec("clinfo", (error, stdout, stderr) => {
      if (error) {
        console.warn("clinfo failed, continuing without OpenCL info:", error.message || stderr || error);
        return resolve("");
      }

      resolve(stdout || "");
    });
  });
};

function parseCLInfo(data) {
  const result = {};

  if (!data || typeof data !== "string") {
    return result;
  }

  const lines = data.split("\n");
  const separatorRegex = /^(.+?)(?:\s{2,}|:\s*)(.+)$/;

  for (let line of lines) {
    if (typeof line !== "string") {
      continue;
    }

    const trimmedLine = line.trim();
    if (!trimmedLine) {
      continue;
    }

    const match = trimmedLine.match(separatorRegex);
    if (!match) {
      continue;
    }

    const key = match[1].trim();
    const value = match[2].trim();
    if (!key || !value) {
      continue;
    }

    switch (key) {
      case "Number of platforms":
        result.platformCount = parseInt(value, 10);
        break;
      case "Platform Name":
        if (!result.platformName) {
          result.platformName = value;
        }
        break;
      case "Platform Vendor":
        result.platformVendor = value;
        break;
      case "Platform Version":
        result.platformVersion = value;
        break;
      case "Number of devices":
        result.deviceCount = parseInt(value, 10);
        break;
      case "Device Name":
        if (!result.deviceName) {
          result.deviceName = value;
        }
        break;
      case "Device Vendor":
        result.deviceVendor = value;
        break;
      case "Device Version":
        result.deviceVersion = value;
        break;
      case "Device Type":
        result.deviceType = value;
        break;
      case "Max compute units":
        result.computeUnits = parseInt(value, 10);
        break;
      case "Global memory size":
        result.globalMemory = value;
        break;
      case "Max clock frequency":
        result.clockMHz = parseInt(value, 10);
        break;
      default:
        break;
    }
  }

  return result;
}

// ==============================
// Run the heartbeat every 60 seconds
// ==============================
setInterval(sendHeartBeat, 60000);