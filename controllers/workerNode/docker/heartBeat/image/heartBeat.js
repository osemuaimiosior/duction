// ==============================
// Node Heartbeat Monitoring Script
// ==============================

// Import necessary modules
const axios = require("axios"); // For sending HTTP requests (currently unused)
const os = require("os"); // Node.js built-in module for OS info
const { OSUtils } = require("node-os-utils"); // Provides CPU, memory, disk stats easily
const osu = new OSUtils(); // Initialize OS utilities
const nodeState = require("../config/model/nodeHeartBeat"); // Database model for node heartbeats
const queueConnection = require('../config/db/queue');
const { Queue, Worker} = require('bullmq');
const { exit } = require("process");

// ==============================
// Global Variables
// ==============================

let NODE_CHANNEL =""; // Redis queue for this node
// Global queue
let nodeQueue = null;
const cpuCores = os.cpus().length; // Number of CPU cores on the machine


// ==============================
// Function: getCPUStat
// Purpose: Collect system stats and send heartbeat
// ==============================

async function getCPUStat(NODE_CODE, HOST_NAME){

  const checkID = `node-${HOST_NAME}-${NODE_CODE}`;
  console.log(checkID);
  const senderNodeDetails =await nodeState.findOne({
    where: { nodeId: checkID}
  });

  if(!senderNodeDetails) {
    console.log("Invalid node sender details from linw 38 of heartBeat.js")
    exit(1)
  }

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
    console.log("System hostname:", overVInfo.system.hostname);

    NODE_CHANNEL =  overVInfo.system.hostname + "-" + NODE_CODE;
    const expectedID = `${HOST_NAME}-${NODE_CODE}`;

    if( expectedID !== NODE_CHANNEL){
        console.log(`Invalid from ${NODE_CHANNEL}`);

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
    
        // Heartbeat payload to send to Redis queue or DB
        const nodePayload = {
    
          nodeId: nodeId,
          
          state: "heartBeat",
    
          cpuUsage: cpuInfo.data,
    
          cpuCores: cpuCores,
    
          ramTotal: ramTotalGB,
    
          ramFree: ramFreeGB,
    
          gpuUtilization: null,
          gpuMemoryFree: null,
          temperature: null,
    
          simulationsPerSecond: null,
    
          uptime: uptimeSeconds,
    
          nodeStatus: "online",
    
          jobStatus: "idle",
    
          nodeScore: node_Score,
    
          lastHeartbeat: now
    
        }
    
        // Upsert instead of create (important for heartbeats)
        console.log("Node payload", nodePayload);
        
        // ------------------------------
        // Send Heartbeat to Redis Queue
        // ------------------------------

       if (!nodeQueue) {

            nodeQueue = new Queue("node-heartBeat", {
                connection: queueConnection
            });

            console.log("Queue initialized:", "node-heartBeat");
        }

        // Send heartbeat job
        await nodeQueue.add("nodeHeartBeat", nodePayload, {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 2000
          }
        });

        console.log("Node heartbeat saved:", nodeId)
    
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

// ==============================
// Run the heartbeat every 60 seconds
// ==============================
setInterval(sendHeartBeat, 60000);