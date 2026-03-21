// ==============================
// Simulation Consumer Script
// ==============================

// Import Node.js modules for executing external programs
const { execFile } = require("child_process");

// Import database model to verify node registration and heartbeat: This ensures only valid nodes can run simulation jobs
const newJob = require("../mcOpenCL/config//model/job");
const nodeState = require("../mcOpenCL/config//model/nodeHeartBeat");

const { spawn } = require("child_process");

// Import OS module to get hostname
const os = require("os");

const queueConnection = require('./config/db/queue');
const { Queue, Worker} = require('bullmq');
const { exit } = require("process");

// ==============================
// Node Identification
// ------------------------------
// Each node has a unique node ID combining hostname and NODE_CODE environment variable: This ensures messages are routed to the correct compute node
const nodeCode = process.env.NODE_CODE;
const hostName = process.env.HOST_CODE;

const nodeQueue = new Queue("node-mc-result", {
  connection: queueConnection
});

const nodeID =  `node-${hostName}-${nodeCode}`;
const QUEUE = "node-jobs";


// ==============================
// RedisSMQ Consumer Setup
// ------------------------------
// The consumer listens for jobs assigned to this node


/**
 * Function: simulate
 * ------------------------------
 * Main loop for consuming simulation jobs:
 *
 * 1. Check if this node is registered in the database
 * 2. If node is valid, start consuming messages from Redis queue
 * 3. For each job, call `runSimulation` function
 */

async function simulate() {

  const existingNode = await nodeState.findOne({
    where: { nodeId: nodeID }
  });

  if (!existingNode) {
    console.log("Node code invalid");
    process.exit(1);
  }

  console.log("Node verified:", nodeID);

  const worker = new Worker(
    QUEUE,
    async job => {

      if (job.name === "node-dispathed-jobs" && job.data.nodeId === nodeID) {

        const payload = job.data;

        console.log("MC job received:", payload);

        await newJob.upsert(payload);

        try {
          await runSimulation(payload);
        } catch (err) {
          console.error("Simulation failed:", err);
          throw err;
        }

      }

    },
    {
      connection: queueConnection,
      concurrency: os.cpus().length
    }
  );

  worker.on("completed", job => {
    console.log(`Job completed ${job.id}`);
  });

  worker.on("failed", (job, err) => {
    console.error(`Job failed ${job?.id}`, err);
  });

}


let mcProcess = null;

function startSimulationEngine() {

  mcProcess = spawn("./mc");

  mcProcess.stdout.on("data", data => {
    const result = data.toString().trim();
    console.log("Simulation output:", result);
  });

  mcProcess.stderr.on("data", data => {
    console.error("Simulation error:", data.toString());
  });

  mcProcess.on("close", code => {
    console.log("MC process exited", code);
  });

}

/**
 * Function: runSimulation
 * ------------------------------
 * Executes the simulation for the job received.
 *
 * 1. Logs the job details
 * 2. Passes parameters to an external simulation binary (e.g., Monte Carlo executable `mc`)
 * 3. Handles output and errors
 */

/**
 * Run a simulation job and send results to the aggregator
 * @param {Object} payload - payload object containing simulation parameters
 *  Example: { id: "job123", modelType: "monte_carlo", runs: 1000000, S0: 100, K: 110, r: 0.05, sigma: 0.2, T: 1 }
 */


function runSimulation(payload) {

  return new Promise((resolve, reject) => {

    const input = `${payload.runs} ${payload.S0} ${payload.K} ${payload.r} ${payload.sigma} ${payload.T}\n`;
    
    mcProcess.stdin.write(input);

    mcProcess.stdout.once("data", async data => {

      const result = parseFloat(data.toString().trim());

      if (isNaN(result)) {
        return reject(new Error("Invalid result"));
      }

      const resultPayload = {
        jobId: payload.jobId,
        chunkId: payload.chunkId,
        nodeId: nodeID,
        result,
        runs: payload.runs,
        timestamp: new Date()
      };

      await nodeQueue.add("node-mc-result", resultPayload);

      resolve(resultPayload);

    });

  });

}

startSimulationEngine();
simulate();