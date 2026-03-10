const axios = require("axios");
const os = require("os");
const {OSUtils} = require("node-os-utils");
const osu = new OSUtils();
const nodeState = require("../../../config/model/nodeHeartBeat");
const { RedisSMQ, ProducibleMessage } = require('redis-smq') ;
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

//Create producer
const producer = RedisSMQ.createProducer();

// const cpu = osu.cpu
// const mem = osu.memory
// const overV = osu.overview()

let NODE_CHANNEL ="";
const cpuCores = os.cpus().length

async function getCPUStat(NODE_CODE, HOST_NAME){

  const cpu = osu.cpu
  const mem = osu.memory
  const overV = osu.overview()
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
    console.log("CPU Info success:", cpuInfo.success);
    console.log("CPU Usage:", cpuInfo.data);
    console.log("CPU Usage Timestamp:", cpuInfo.timestamp);
    console.log("CPU Cached:", cpuInfo.cached);
    console.log("CPU OS Platform:", cpuInfo.platform);

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
    console.log("Memory Data success:", memInfo.success);
    console.log("Memory Data Platform:", memInfo.platform);
    console.log("Memory total RAM:", memInfo.data.total);
    console.log("Memory total RAM available:", memInfo.data.available);
    console.log("Memory total RAM used:", memInfo.data.used);
    console.log("Memory total RAM free:", memInfo.data.free);
    console.log("Memory total RAM cached:", memInfo.data.cached);
    console.log("Memory RAM timestamp:", memInfo.timestamp);
    console.log("Memory cached:", memInfo.cached);
  

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
    console.log("System hostname:", overVInfo.system.hostname);

    NODE_CHANNEL =  overVInfo.system.hostname + "-" + NODE_CODE;
    const expectedID = `${HOST_NAME} + "-" + ${NODE_CODE}`;

    if( expectedID !== NODE_CHANNEL){
        console.log(`Invalid from ${NODE_CHANNEL}`);

        //Disable node in db
    }

    console.log("System distro:", overVInfo.system.distro);
    console.log("System release:", overVInfo.system.release);
    console.log("System kernel:", overVInfo.system.kernel);
    console.log("System arch:", overVInfo.system.arch);
    console.log("System uptime:", overVInfo.system.uptime);
    console.log("System bootTime:", overVInfo.system.bootTime);
    console.log("System time:", overVInfo.system.time);
    console.log("System timezone:", overVInfo.system.timezone);
    console.log("System disk total:", overVInfo.disk.total);
    console.log("System disk used:", overVInfo.disk.used);
    console.log("System disk available:", overVInfo.disk.available);
    console.log("System disk usagePercentage:", overVInfo.disk.usagePercentage);
    console.log("System disks:", overVInfo.disk.disks);

    try {
    
        const nodeId = NODE_CHANNEL
    
        // Convert bytes → GB
        const ramTotalGB = memInfo.data.total.bytes / (1024 ** 3)
        const ramFreeGB = memInfo.data.free.bytes / (1024 ** 3)
    
        const uptimeSeconds = Math.floor(overVInfo.system.uptimeSeconds)
    
        const now = new Date()
        const node_Score = (cpuCores * 5) + (ramFreeGB * 3) + (100 - cpuInfo.data) * 0.5
    
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
        
        producer.run((err) => {
          if (err) return console.error('Producer failed:', err);
          
          const msg = new ProducibleMessage()
            .setQueue(`${nodeId}`)
            .setBody(`${nodePayload}`);
          
          producer.produce(msg, (err, ids) => {
            if (err) console.error('Send failed:', err);
            else console.log(`📨 Sent message: ${ids.join(', ')}`);
          });
        });

    
        console.log("Node heartbeat saved:", nodeId)
    
      } catch (error) {
    
        console.error("Error saving node stats:", error)
    
      }
    
};

async function sendHeartBeat(){
  const nodeCode = process.env.NODE_CODE;
  //make sure node-code exist in directory and get registered hostname

  const hostName = process.env.Host_NAME;
  await getCPUStat(nodeCode, hostName);
};

// Run every 5 seconds
setInterval(sendHeartBeat, 60000);