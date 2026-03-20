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

// Import database model to store node heartbeat information: This table tracks all active nodes and their health metrics
const nodeState = require("../config/model/nodeHeartBeat");

// Import RedisSMQ modules for sending node metrics to queues
// const { RedisSMQ, EQueueType, EQueueDeliveryModel, ProducibleMessage } = require('redis-smq');
// const { ERedisConfigClient } = require('redis-smq-common');
const { Queue, Worker} = require('bullmq');
const sequelize = require('../config/db/postgresLocal');
const queueConnection = require('../config/db/queue');


/**
 * Function: run
 * ------------------
 * A helper to run shell commands synchronously and print output. Useful for setup scripts or testing GPU availability
 */

function run(cmd) {
  console.log(`Running: ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

async function startPostgresServer() {
  try {
    await sequelize.authenticate();
    console.log("PostgreSQL connected");

     await sequelize.sync({ alter: true }); //dev mode
    //  await db.sequelize.sync({ alter: true }); //prod mode
    console.log("Models synchronized");

    // app.listen(3000, () => {
    //   console.log("Server running on port 3000");
    // });

  } catch (err) {
    console.error("DB connection failed:", err);
  }
}

startPostgresServer();

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
    const nodeId = NODE_CHANNEL

    // Convert bytes → GB
    const ramTotalGB = +(memInfo.data.total.bytes / (1024 ** 3)).toFixed(2)
    const ramFreeGB  = +(memInfo.data.available.bytes / (1024 ** 3)).toFixed(2)

    const cpuCores = os.cpus().length

    const uptimeSeconds = Math.floor(overVInfo.system.uptimeSeconds)

    const now = new Date();

    // Node scoring system for scheduling and load balancing
    const node_Score = (cpuCores * 5) + (ramFreeGB * 3) + (100 - cpuInfo.data) * 0.5

    const nodePayload = {

      nodeId: nodeId,

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

    // Register node in DB and setup environment if not already registered
    await nodeEnvSetupAndRegistry(nodePayload);

    console.log("Node heartbeat saved:", nodeId)

  } catch (error) {

    console.error("Error saving node stats:", error)

  }
  /**
   * Scaling note:
   * ----------------
   * When you have 10k+ nodes, storing each heartbeat directly in SQL becomes slow.
   * Instead:
   * - Worker nodes → Redis (live state)
   * - Periodic snapshot → Postgres
   */
    
};

//////////////////////// GPU Monitoring ////////////////////////////////

// nvml.init();

// const deviceCount = nvml.deviceGetCount();

// for (let i = 0; i < deviceCount; i++) {

//   const handle = nvml.deviceGetHandleByIndex(i);

//   const util = nvml.deviceGetUtilizationRates(handle);
//   const mem = nvml.deviceGetMemoryInfo(handle);
//   const temp = nvml.deviceGetTemperature(handle, 0);

//   console.log({
//     gpuUtilization: util.gpu,
//     memoryUsed: mem.used,
//     memoryFree: mem.free,
//     temperature: temp
//   });

// }

// nvml.shutdown();

async function nodeEnvSetupAndRegistry(nodePayload) {

  const existingNode = await nodeState.findOne({
    where: { nodeId: nodePayload.nodeId }
  });

  if (existingNode) {
    console.log("Node already exists. Invalid registration");
    return;
  }

  await nodeState.create(nodePayload);

  console.log("Setting up node environment...");
  console.log(nodePayload);

  // try {
  //   // Install GPU drivers and test GPU availability
  //   // Step 1: Install GPU drivers
  //   execSync("sudo apt update", { stdio: "inherit" });
  //   execSync("sudo apt install -y nvidia-driver-535", { stdio: "inherit" });
  //   execSync("nvidia-smi", { stdio: "inherit" });

  //   // Step 2: Install Docker
  //   execSync("sudo apt install -y docker.io", { stdio: "inherit" });
  //   execSync("sudo systemctl start docker", { stdio: "inherit" });
  //   execSync("sudo systemctl enable docker", { stdio: "inherit" });
  //   execSync("docker --version", { stdio: "inherit" });

  //   // Step 3: Install NVIDIA container runtime
  //   execSync(
  //     `distribution=$(. /etc/os-release;echo $ID$VERSION_ID) && \
  //     curl -s -L https://nvidia.github.io/libnvidia-container/gpgkey | sudo apt-key add - && \
  //     curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list \
  //     | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list`,
  //     { shell: "/bin/bash", stdio: "inherit" }
  //   );

  //   execSync("sudo apt update", { stdio: "inherit" });
  //   execSync("sudo apt install -y nvidia-container-toolkit", { stdio: "inherit" });
  //   execSync("sudo nvidia-ctk runtime configure --runtime=docker", { stdio: "inherit" });
  //   execSync("sudo systemctl restart docker", { stdio: "inherit" });

  //   // Step 4: Test GPU docker
  //   execSync(
  //     "docker run --rm --gpus all nvidia/cuda:12.2.0-base nvidia-smi",
  //     { stdio: "inherit" }
  //   );

  //   console.log("Node successfully configured!");

  // } catch (err) {
  //   console.error("Node setup failed:", err.message);
  // }

  // ==============================
  // Queue Initialization
  // ------------------------------
  
  new Queue(NODE_CHANNEL, {connection: queueConnection});

  // Producer (Adding Jobs)
  // await nodeQueue.add('nodeDetailsRegistration', nodePayload);

  // const worker = new Worker(
  //   `${NODE_CHANNEL}`,
  //   async job => {
  //     // Will print { foo: 'bar'} for the first job
  //     // and { qux: 'baz' } for the second.
  //     console.log(job.data);
  //   },
  //   { connection: queueConnection },
  // );
  
};

// ==============================
// Start Node Detection & Monitoring
// ------------------------------
logicDetection();

//Docker container monitoring tool: cAdvisor, Prometheus etc


