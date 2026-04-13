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

const newJobModel = require("../../../config/model/newJob");

const nodeJobChunk = require("../../../config/model/jobChunk");

/**
 * Sequelize operator helpers used for advanced filtering (>, <, etc)
 */

const { Op } = require("sequelize");
const path = require("path");
const { Queue, Worker} = require('bullmq');
const queueConnection = require('../../../config/db/queue');
const grpc = require("@grpc/grpc-js")
const protoLoader = require("@grpc/proto-loader")

const PROTO_PATH = path.join(__dirname, "job.proto");

const packageDef = protoLoader.loadSync(PROTO_PATH);
const grpcObject = grpc.loadPackageDefinition(packageDef)
const WorkerService = grpcObject.WorkerService


/**
 * Heartbeat timeout: If a node has not sent a heartbeat within this time, it is considered offline.
 */

const HEARTBEAT_TIMEOUT_MS = 10000;

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

const scheduleJob = async (MODEL_TYPE, clinetAUTH, jobID, INPUT_DATA, RUNS, SIMULATION_TYPE) => {

  const requireMinRuns = process.env.MIN_RUN_SIMULATION;

  if (RUNS < requireMinRuns) {
    throw new Error(`Minimum runs must be >= ${requireMinRuns}`);
  }

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
        [Op.gt]: 1
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

const nodeQueue = new Queue("node-jobs", {
        connection: queueConnection
    });
/**
 * Dispatch Job to Redis Queue. Each node has its own queue:
 *
 * queue name = nodeId
 *
 * This allows targeted job delivery.
 */

async function dispatchJob(job) {

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

    // console.log("Queue initialized:", "node-heartBeat");

    // Send heartbeat job
    await nodeQueue.add("node-dispathed-jobs", payloadStr, {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2000
      }
    });
  };

async function getJobFromQueue() {
  const jobs = await nodeQueue.getJobs(["waiting"], 0, 0);

  if (!jobs.length) return null;

  const job = jobs[0];

  return {
    job_id: job.data.jobId,
    payload: JSON.stringify(job.data)
  };
}

// gRPC Implementation below

function JobStream(call) {

  console.log("Worker connected");

  // Worker sends data
  call.on("data", async (workerMessage) => {

    if (workerMessage.job_result) {
      console.log("Job result received:", workerMessage);
    }

  });

  // Send jobs to worker
  const interval = setInterval(async () => {

    const job = await getJobFromQueue();

    if (job) {
      call.write(job);
    }

  }, 500);

  call.on("end", () => {
    clearInterval(interval);
    call.end();
  });

}

function getServer() {
  const server = new grpc.Server();
  server.addService(WorkerService.service, {
    JobStream
  });
  return server;
};

// NOTE: This module exports scheduler helper functions and should not
// automatically bind a gRPC server during import. Start the scheduler
// gRPC service from a dedicated startup script if needed.



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