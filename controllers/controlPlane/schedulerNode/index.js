/**
 * Node Heartbeat Model
 *
 * This database model stores the current status of compute nodes participating in the distributed simulation network.
 *
 * Example stored metrics:
 * - cpu cores
 * - cpu usage
 * - free RAM
 * - GPU memory
 * - node status
 * - job status
 * - last heartbeat timestamp
 */
const nodeState = require("../../../config/model/nodeHeartBeat");

/**
 * Sequelize operator helpers used for advanced filtering (>, <, etc)
 */

const { Op } = require("sequelize");

/**
 * RedisSMQ Message Queue: used as the distributed job queue system.
 *
 * Producer  -> sends jobs
 * Consumer  -> compute nodes receive jobs
 */
const { RedisSMQ, ProducibleMessage } = require('redis-smq');

/**
 * Redis configuration type IOREDIS is used as the Redis client implementation.
 */
const { ERedisConfigClient } = require('redis-smq-common') ;


/**
 * Initialize RedisSMQ: This connects the scheduler service to the Redis message queue. Redis acts as the central job distribution layer.
 */

RedisSMQ.initialize(
  {
    client: ERedisConfigClient.IOREDIS,
    options: { host: '127.0.0.1', port: 6379 } //Change host IP to where the redis server is running, '127.0.0.1' => Redis is running locally
  },
  (err) => {
    if (err) console.error('RedisSMQ init failed:', err);
  }
);

/**
 * Create a job producer: The producer is responsible for sending simulation tasks to worker nodes.
 */
const producer = RedisSMQ.createProducer();

/**
 * Heartbeat timeout: If a node has not sent a heartbeat within this time, it is considered offline.
 */

const HEARTBEAT_TIMEOUT_MS = 10000;

// Redis client
const client = createClient();

client.on("error", (err) => console.log("Redis Client Error", err));

(async () => {
  await client.connect();
})();

/**
 * Minimum simulation chunk per node
 *
 * Ensures nodes receive enough work to justify scheduling overhead.
 */
const MIN_NODE_RUN = 100000;


/**
 * Maximum simulation chunk per node
 *
 * Prevents a single node from receiving extremely large jobs.
 */
const MAX_NODE_RUN = 1000000;

/**
 * MAIN SCHEDULER FUNCTION: Responsible for distributing simulation work across nodes.
 *
 * Steps:
 * 1. Validate simulation parameters
 * 2. Fetch available nodes
 * 3. Split simulation runs into smaller chunks
 * 4. Assign chunks to nodes
 * 5. Dispatch jobs to Redis queues
 */

const scheduleJob = async (MODEL_TYPE, INPUT_DATA, RUNS, SIMULATION_TYPE) => {

  /**
   * Step 1 — Validate minimum simulation runs
   */
  const requireMinRuns = process.env.MIN_RUN_SIMULATION;

  if(RUNS < requireMinRuns){
    console.log(`Minimum simulation runds must be greater or equall to ${requireMinRuns}`)
  };

  /**
   * Step 2 — Query available compute nodes
   *
   * Only select nodes that:
   * - are online
   * - are currently idle
   * - have at least 4GB free RAM
   */
  
  const nodes = await nodeState.findAll({
    where: {
      nodeStatus: "online",
      jobStatus: "idle",
      ramFree: {
        [Op.gt]: 4
      }
    }
  });

  /**
   * Step 3 — Node scoring (optional advanced scheduler)
   *
   * This section is currently commented out but demonstrates how nodes could be scored based on performance metrics.
   *
   * Example scoring formula:
   *
   * score =
   *   CPU power +
   *   available RAM +
   *   available GPU memory
   *
   * This allows intelligent node selection.
   */

  let bestCandidate = null;
  let bestScore = -Infinity;

  // for (const n of nodes) {

  //   if (!n.lastHeartbeat) continue;

  //   const heartbeatAge = Date.now() - new Date(n.lastHeartbeat).getTime();

  //   if (heartbeatAge > HEARTBEAT_TIMEOUT_MS) continue;

  //   const nodeScore =
  //     (n.cpuCores * (1 - n.cpuUsage)) * 2 +
  //     n.ramFree +
  //     (n.gpuMemoryFree || 0);

  //   if (nodeScore > bestScore) {

  //     bestScore = nodeScore;

  //     bestCandidate = {
  //       nodeId: n.nodeId,
  //       gpuMemoryFree: n.gpuMemoryFree
  //     };
  //   }
  // };

  /**
   * Step 4 — Split simulation runs into chunks
   *
   * Example:
   *
   * totalRuns = 10,000,000
   *
   * becomes
   *
   * [
   *   1,000,000,
   *   1,000,000,
   *   1,000,000,
   *   ...
   * ]
   *
   * Each chunk can be processed by a different node.
   */

  const chunks = splitRuns(RUNS);

  /**
   * Step 5 — Assign chunks to nodes
   *
   * Jobs are distributed using round-robin scheduling.
   *
   * Example:
   *
   * Node1 -> chunk1
   * Node2 -> chunk2
   * Node3 -> chunk3
   * Node1 -> chunk4
   */

  const jobs = []

  for (let i = 0; i < chunks.length; i++) {

    const node = nodes[i % nodes.length]

    jobs.push({
      nodeId: node.nodeId,
      runs: chunks[i],
      modelType: MODEL_TYPE,
      inputData: INPUT_DATA,
      simulationType: SIMULATION_TYPE
    })

  }

  // if (!bestCandidate) {
  //   throw new Error("No suitable node available");
  // }

  /**
   * Safety check
   *
   * If no nodes are available the job cannot run.
   */

  if (!nodes.length) {
    throw new Error("No suitable node available");
  };

  /**
   * Step 6 — Dispatch jobs to nodes
   *
   * Each job chunk is pushed into the node's Redis queue. The compute node will consume this queue and run the simulation.
   */
  for (const job of jobs) {

    await dispatchJob(job);

  };

  /**
   * Step 7 — Return scheduling result
   */
  return {
    message: "Job scheduled",
    nodesUsed: nodes.length
  };
};

/**
 * Dispatch Job to Redis Queue. Each node has its own queue:
 *
 * queue name = nodeId
 *
 * This allows targeted job delivery.
 */
async function dispatchJob(job) {

  const queue = `${job.nodeId}`;

  /**
   * Serialize job payload
   */

  const payload = JSON.stringify({
    nodeId: job.nodeId,
    runs: job.runs,
    modelType: job.modelType,
    inputData: job.inputData,
    simulationType: job.simulationType
  });

  /**
   * Start producer and push message
   */
  producer.run((err) => {
    if (err) return console.error('Producer failed:', err);
    
    const msg = new ProducibleMessage()
      .setQueue(`${queue}`)
      .setBody(`${payload}`);
    
    producer.produce(msg, async (err, ids) => {
      if (err) {
        console.error('Send failed:', err)
      } else {

        /**
         * Update node status to busy
         */

        await nodeState.update(
          { jobStatus: "busy" },
          { where: { nodeId: job.nodeId } }
        );

        console.log(`Sent message: ${ids.join(', ')}`);
      }; 
    });
  })

};

/**
 * Split Simulation Runs into Chunks
 *
 * Example:
 *
 * totalRuns = 3,000,000
 *
 * Output:
 *
 * [
 *   1,000,000
 *   1,000,000
 *   1,000,000
 * ]
 *
 * This allows distributed execution.
 */

function splitRuns(totalRuns) {

  const chunks = []
  let remaining = totalRuns

  while (remaining > 0) {

    const chunkSize = Math.min(MAX_NODE_RUN, remaining)

    chunks.push(chunkSize)

    remaining -= chunkSize
  }

  return chunks
};

/**
 * Export scheduler function
 */

module.exports = { scheduleJob };