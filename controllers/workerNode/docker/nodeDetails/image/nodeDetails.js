const fs = require('fs');
const path = require("path");

const localEnvPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(localEnvPath)) {
  require('dotenv').config({ path: localEnvPath });
} else {
  throw new Error(`Missing local .env file for nodeDetails container: ${localEnvPath}`);
}

// ==============================
// Node Environment & Heartbeat Script
// ==============================

// Import OS utilities for monitoring CPU, memory, disk, and system stats
const {OSUtils} = require("node-os-utils");
const osu = new OSUtils();

// Import standard Node.js modules
const os = require("os"); // For hostname, CPU cores, etc.
const { execSync } = require("child_process"); // For running shell commands
const crypto = require("crypto"); // For generating unique node IDs
const { exit } = require('process');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { ConsoleLogger } = require('redis-smq-common');

/**
 * Function: run
 * A helper to run shell commands synchronously and print output. Useful for setup scripts or testing GPU availability
 */

function run(cmd) {
  console.log(`Running: ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

const NODE_ID =
  os.hostname() + "-" + crypto.randomBytes(4).toString("hex")

const NODE_CHANNEL = `node-${NODE_ID}`;


// ==============================
// Node Detection & Monitoring Flow
// ------------------------------
/**
 * Logic:
 *
 * 1. Detect Operating System
 * 2. Detect GPU vendor (NVIDIA / AMD / none)
 * 3. Load the appropriate monitoring module
 * 4. Start heartbeat loop to send system metrics to scheduler
 *
 * CPU nodes handle:
 * - Monte Carlo simulations
 * - Scientific simulations
 *
 * GPU nodes handle:
 * - AI inference
 * - ML training
 * - CUDA-based simulations
 */

const logicDetection = async () => {

  let gpuType = "none"

  // Check if NVIDIA GPU is present
  try {
    execSync("nvidia-smi", { stdio: "ignore" })
    gpuType = "nvidia"
  } catch {}

   // If no NVIDIA, check for AMD GPU
  if (gpuType === "none") {
    try {
      execSync("rocm-smi", { stdio: "ignore" })
      gpuType = "amd"
    } catch {}
  }

  console.log("GPU Type:", gpuType)

  // Load monitoring based on detected GPU type
  if (gpuType === "nvidia") {
    const nvml = require("node-nvml") // NVIDIA GPU library

    nvml.init()
    console.log("NVIDIA GPU detected")
    await getNvidiaStats(nvml) // Function to collect NVIDIA stats (GPU utilization, memory, temperature)
  }

  else if (gpuType === "amd") {
    console.log("AMD GPU detected")
    await getAMDStats()  // Function to collect AMD GPU stats
  }

  else {
    console.log("CPU node")
    await getCPUStat() // Default CPU monitoring
  }

}


// ==============================
// CPU Monitoring
// ------------------------------

const cpu = osu.cpu
const mem = osu.memory
const overV = osu.overview()

const PROTO_PATH = path.join(__dirname, "..", 'registry.proto');
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
const registryServerClient = new protoDescriptor.Registry(registryServerAddr, grpc.credentials.createInsecure());



// const client = new WorkerService(
//   "grpc.mycompute.com:50051",
//   creds
// );

/**
 * Function: getCPUStat
 * ------------------
 * 1. Collect CPU, memory, and system stats
 * 2. Prepare node heartbeat payload
 * 3. Persist node info in database if first registration
 * 4. Send metrics to Redis queue for scheduler consumption
 */


async function getCPUStat ()  {

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

    // Get CPU utilization
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

    
    // Get memory utilization
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

    // Get full system overview (hostname, uptime, disk, processes, network, etc.)
    const overVInfo = await overV;

  try {

    // Prepare payload for this node
    const node_Id = NODE_CHANNEL

    // Convert bytes → GB
    const ramTotalGB = +(memInfo.data.total.bytes / (1024 ** 3)).toFixed(2)
    const ramFreeGB  = +(memInfo.data.available.bytes / (1024 ** 3)).toFixed(2)

    const cpuCores = os.cpus().length

    const uptimeSeconds = Math.floor(overVInfo.system.uptimeSeconds)

    const now = new Date();

    // Node scoring system for scheduling and load balancing
    const node_Score = (cpuCores * 5) + (ramFreeGB * 3) + (100 - cpuInfo.data) * 0.5

    const nodeSystemInfo = overVInfo.system; 
    const nodePlatformInfo = overVInfo.platform;
    
    const nodeFingerprint = crypto
      .createHash("sha256")
      .update(node_Id)
      .digest("hex");

    const userToken = {
      USER_AUTH: process.env.USER_AUTH,
      ID: node_Id
    };
    // console.log('USER_AUTH token loaded:', !!userToken);

    if (!process.env.USER_AUTH || process.env.USER_AUTH === undefined) {
      console.error('Missing USER_AUTH env value in nodeDetails container .env');
      process.exit(1);
    };

    const nodePayload = {

      nodeId: node_Id,

      cpuUsage: cpuInfo.data,

      systemInfo: JSON.stringify(nodeSystemInfo),

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

      jobStatus: "idle",

      nodeScore: node_Score,

      lastHeartbeat: now

    }

    // console.log("nodePayload: ", nodePayload);

    const feedback = await new Promise((resolve, reject) => {

      registryServerClient.checkAuthClientDetails(userToken, (err, response) => {

          if (err) {
            return reject(err);
          }
          resolve(response);
        });

    });

    // console.log('Registry auth response:', feedback);

    if (!feedback || feedback.message !== "Client auth details found") {
      console.error('Registry auth failed or returned unexpected response:', feedback);
      process.exit(1);
    }

    // Register node in DB and setup environment if not already registered

     const fb = await new Promise((resolve, reject) => {

      registryServerClient.registerNodeDetails({nodePayload, userToken}, (err, response) => {

          if (err) {
            return reject(err);
          }
          resolve(response);
        });

    });

    // console.log(fb);

    if(fb.message === "Internal server error"){
      console.log("Internal server error")
      exit(1)
    };

    const [prefix, owner, id] = nodePayload.nodeId.split("-");

    console.log("Your HOST_NAME: ", owner);
    console.log("Your NODE_CODE: ", id);

  } catch (error) {

    console.error("Error saving node stats:", error);

  }
    
};

logicDetection();