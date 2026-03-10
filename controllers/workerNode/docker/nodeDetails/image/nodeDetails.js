const {OSUtils} = require("node-os-utils");
const osu = new OSUtils();
// const nvml = require('node-nvml');
const os = require("os")
const { execSync } = require("child_process");
const crypto = require("crypto")
const nodeState = require("../../../../../config/model/nodeHeartBeat");
const { RedisSMQ, EQueueType, EQueueDeliveryModel, ProducibleMessage } = require('redis-smq') ;
const { ERedisConfigClient } = require('redis-smq-common') ;

// Simple initialization
RedisSMQ.initialize(
  {
    client: ERedisConfigClient.IOREDIS,
    options: { host: '127.0.0.1', port: 6379 }
  },
  (err) => {
    if (err) console.error('RedisSMQ init failed:', err);
  }
);

// Unique node ID
const NODE_ID =
  os.hostname() + "-" + crypto.randomBytes(4).toString("hex")

const NODE_CHANNEL = `node:${NODE_ID}`;



/////Process flow

/**
 * step 1. Detect working OS
 * step 2. Detect GPU vendor
 * 
 * Node Start
      │
      ▼
    Detect OS
      │
      ▼
    Detect GPU vendor
      │
      ▼
    Load monitoring module
      │
      ▼
    Start heartbeat loop
      │
      ▼
    Send metrics → scheduler

| --------- | ----------------------------------------------- |
| CPU node  | Monte Carlo simulations, scientific simulations |
| GPU node  | AI inference, ML training, CUDA simulations     |

 */

//Detection Logic

const logicDetection = async () => {

  let gpuType = "none"

  try {
    execSync("nvidia-smi", { stdio: "ignore" })
    gpuType = "nvidia"
  } catch {}

  if (gpuType === "none") {
    try {
      execSync("rocm-smi", { stdio: "ignore" })
      gpuType = "amd"
    } catch {}
  }

  console.log("GPU Type:", gpuType)

  if (gpuType === "nvidia") {
    const nvml = require("node-nvml")
    nvml.init()
    console.log("NVIDIA GPU detected")
    await getNvidiaStats(nvml)
  }

  else if (gpuType === "amd") {
    console.log("AMD GPU detected")
    await getAMDStats()
  }

  else {
    console.log("CPU node")
    await getCPUStat()
  }

}


//////////////////////// CPU Monitoring ////////////////////////////////

const cpu = osu.cpu
const mem = osu.memory
const overV = osu.overview()

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

    const cpuInfo = await cpu.usage();
    // console.log("CPU Info success:", cpuInfo.success);
    // console.log("CPU Usage:", cpuInfo.data);
    // console.log("CPU Usage Timestamp:", cpuInfo.timestamp);
    // console.log("CPU Cached:", cpuInfo.cached);
    // console.log("CPU OS Platform:", cpuInfo.platform);

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

    const memInfo = await mem.info();
    // console.log("Memory Data success:", memInfo.success);
    // console.log("Memory Data Platform:", memInfo.platform);
    // console.log("Memory total RAM:", memInfo.data.total);
    // console.log("Memory total RAM available:", memInfo.data.available);
    // console.log("Memory total RAM used:", memInfo.data.used);
    // console.log("Memory total RAM free:", memInfo.data.free);
    // console.log("Memory total RAM cached:", memInfo.data.cached);
    // console.log("Memory RAM timestamp:", memInfo.timestamp);
    // console.log("Memory cached:", memInfo.cached);
  

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

    const overVInfo = await overV;
    // console.log("Processes Information",overVInfo.processes);
    // console.log("System hostname:", overVInfo.system.hostname);
    // console.log("System distro:", overVInfo.system.distro);
    // console.log("System release:", overVInfo.system.release);
    // console.log("System kernel:", overVInfo.system.kernel);
    // console.log("System arch:", overVInfo.system.arch);
    // console.log("System uptime:", overVInfo.system.uptime);
    // console.log("System bootTime:", overVInfo.system.bootTime);
    // console.log("System time:", overVInfo.system.time);
    // console.log("System timezone:", overVInfo.system.timezone);
    // console.log("System disk total:", overVInfo.disk.total);
    // console.log("System disk used:", overVInfo.disk.used);
    // console.log("System disk available:", overVInfo.disk.available);
    // console.log("System disk usagePercentage:", overVInfo.disk.usagePercentage);
    // console.log("System disks:", overVInfo.disk.disks);

  try {

    const nodeId = NODE_CHANNEL

    // Convert bytes → GB
    const ramTotalGB = memInfo.data.total.bytes / (1024 ** 3)
    const ramFreeGB = memInfo.data.free.bytes / (1024 ** 3)

    const cpuCores = os.cpus().length

    const uptimeSeconds = Math.floor(overVInfo.system.uptimeSeconds)

    const now = new Date()
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

    await nodeRegistry(nodePayload);

    console.log("Node heartbeat saved:", nodeId)

  } catch (error) {

    console.error("Error saving node stats:", error)

  }
  /**
   * Scalling model - When you reach 10k+ nodes, storing heartbeats directly in SQL becomes slow. Instead use below:
   * 
   * Worker Nodes
        ↓
      Redis (live node state)
        ↓
      Postgres (periodic snapshot)
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

//////////////////////////////////////////////////////////////
// MQTT CONNECTION
//////////////////////////////////////////////////////////////

// client.on("connect", () => {

//   console.log("MQTT Connected")
//   console.log("Node Channel:", NODE_CHANNEL)

//   client.subscribe(`${NODE_CHANNEL}`)

//   // setInterval(getCPUStat, HEARTBEAT_INTERVAL)
// })

// client.on("message", (topic, message) => {

//   if (topic === `${NODE_CHANNEL}`) {
//     const job = JSON.parse(message.toString())

//     console.log("Received Job:", job)
//   }

// })

async function nodeRegistry(nodePayload) {

  const existingNode = await nodeState.findOne({
    where: { nodeId: nodePayload.nodeId }
  }).exec();

  if (existingNode) {
    // await existingNode.update(nodePayload);
    console.log("Node details already exsit...Invalid registration")
  } else {
    await nodeState.create(nodePayload);

    //Create Queue
  const queueManager = RedisSMQ.createQueueManager();
  queueManager.save(
    `${NODE_CHANNEL}`,
    EQueueType.LIFO_QUEUE,
    EQueueDeliveryModel.POINT_TO_POINT,
    (err) => {
      if (err) console.error('Queue creation failed:', err);
      else console.log('Queue created');
    }
  );
  };
}

// const runSetup = async () => {

//   try {
//     await logicDetection();

//   } catch (err) {
//     console.error("SETUP FAILED:", err);
//     process.exit(1);
//   }
// };

logicDetection();

//Docker container monitoring tool: cAdvisor, Prometheus etc


