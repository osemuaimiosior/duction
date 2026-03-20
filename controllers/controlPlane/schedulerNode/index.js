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

const nodeJob = require("../../../config/model/job");

const nodeJobChunk = require("../../../config/model/jobChunk");

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

const scheduleJob = async (MODEL_TYPE, CLIENT_ID, jobID, INPUT_DATA, RUNS, SIMULATION_TYPE) => {

  const requireMinRuns = process.env.MIN_RUN_SIMULATION;

  if (RUNS < requireMinRuns) {
    throw new Error(`Minimum runs must be >= ${requireMinRuns}`);
  }

  /**
   * Create job row
   */

  await nodeJob.create({
    clientId: CLIENT_ID,
    jobId: jobID,
    modelType: MODEL_TYPE,
    simulationType: SIMULATION_TYPE,
    inputData: INPUT_DATA,
    totalRuns: RUNS,
    status: "splitting"
  });

  /**
   * Split runs into chunk rows
   */

  const chunkCount = await splitRuns(RUNS, jobID);

  /**
   * Fetch queued chunks
   */

  const chunks = await nodeJobChunk.findAll({
    where: {
      jobId: jobID,
      status: "queued"
    }
  });

  /**
   * Get available nodes
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

  if (!nodes.length) {
    throw new Error("No nodes available");
  }

  /**
   * Round robin dispatch
   */

  for (let i = 0; i < chunks.length; i++) {

    const node = nodes[i % nodes.length]

    await dispatchJob({
      chunkId: chunks[i].id,
      jobId: jobID,
      nodeId: node.nodeId,
      runs: chunks[i].runs,
      modelType: MODEL_TYPE,
      inputData: INPUT_DATA,
      simulationType: SIMULATION_TYPE
    });

  }

  return {
    message: "Job scheduled",
    chunkCount
  }

};
/**
 * Dispatch Job to Redis Queue. Each node has its own queue:
 *
 * queue name = nodeId
 *
 * This allows targeted job delivery.
 */

async function dispatchJob(job) {

  const queue = "node-job";

  const payload = {
    jobId: job.jobId,
    chunkId: job.chunkId,
    nodeId: job.nodeId,
    runs: job.runs,
    modelType: job.modelType,
    inputData: job.inputData,
    simulationType: job.simulationType
  };

  const payloadStr = JSON.stringify(payload);


}

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

// async function splitRuns(totalRuns, job_ID) {

//   const chunks = []
//   let remaining = totalRuns

//   while (remaining > 0) {

//     const chunkSize = Math.min(MAX_NODE_RUN, remaining)

//     chunks.push(chunkSize)

//     remaining -= chunkSize
//   }

//   const nodeJobChunkDetails = await nodeJobChunk.findOne({
//     where: { jobId: job_ID}
//   });

//   if(nodeJobChunkDetails) console.log("Invalid job split line 383");

//   const jobChunkPayload = {
//     jobId: job_ID,
//     chunkCount: chunks.length,
//   };

//   await nodeJobChunk.create(jobChunkPayload);

//   return chunks
// };

async function splitRuns(totalRuns, jobId) {

  const chunks = []
  let remaining = totalRuns

  while (remaining > 0) {

    const chunkSize = Math.min(MAX_NODE_RUN, remaining)

    chunks.push(chunkSize)

    remaining -= chunkSize
  }

  /**
   * Insert chunk rows
   */

  for (const runs of chunks) {

    await nodeJobChunk.create({
      jobId,
      runs,
      nodeId: null,
      status: "queued"
    });

  }

  return chunks.length
  };

/**
 * Export scheduler function
 */

module.exports = { scheduleJob };