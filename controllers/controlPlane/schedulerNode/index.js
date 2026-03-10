const nodeState = require("../../../config/model/nodeHeartBeat");
const { Op } = require("sequelize");
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

const HEARTBEAT_TIMEOUT_MS = 10000;

// Redis client
const client = createClient();

client.on("error", (err) => console.log("Redis Client Error", err));

(async () => {
  await client.connect();
})();

const scheduleJob = async (MODEL_TYPE, INPUT_DATA, min_Runs, SIMULATION_TYPE) => {

   /**
   * step 1. Check database of node information.
   * step 2. Identify best canditate(s) for the job
   * step 3. score node performance
   * step 4. Store job schedule node details
   * */ 
  
   const nodes = await nodeState.findAll({
    where: {
      nodeStatus: "online",
      jobStatus: "idle",
      ramFree: {
        [Op.gt]: 4
      }
    }
  });

  let bestCandidate = null;
  let bestScore = -Infinity;

  for (const n of nodes) {

    if (!n.lastHeartbeat) continue;

    const heartbeatAge = Date.now() - new Date(n.lastHeartbeat).getTime();
    if (heartbeatAge > HEARTBEAT_TIMEOUT_MS) continue;

    const nodeScore = (n.cpuCores * (1 - n.cpuUsage)) * 2 + n.ramFree + (n.gpuMemoryFree || 0);

    if (nodeScore > bestScore) {

      bestScore = nodeScore;

      bestCandidate = {
        nodeId: n.nodeId,
        gpuMemoryFree: n.gpuMemoryFree
      };
    }
  }

  if (!bestCandidate) {
    throw new Error("No suitable node available");
  }

  const job = {
    nodeId: bestCandidate.nodeId,
    Job: {
      modelType: MODEL_TYPE,
      inputData: INPUT_DATA,
      minRuns: min_Runs,
      simulationType: SIMULATION_TYPE
    }
  };

  await dispatchJob(job);

  return {
    message: "Job scheduled",
    node: bestCandidate
  };
};

async function dispatchJob(job) {

  const channel = `${job.nodeId}`;

  // push job to redis queue
  producer.run((err) => {
    if (err) return console.error('Producer failed:', err);
    
    const msg = new ProducibleMessage()
      .setQueue(`${channel}`)
      .setBody(`${job.Job}`);
    
    producer.produce(msg, async (err, ids) => {
      if (err) {
        console.error('Send failed:', err)
      } else {

        await nodeState.update(
          { jobStatus: "busy" },
          { where: { nodeId: job.nodeId } }
        );

        console.log(`📨 Sent message: ${ids.join(', ')}`);
      }; 
    });
  })
};

module.exports = { scheduleJob };