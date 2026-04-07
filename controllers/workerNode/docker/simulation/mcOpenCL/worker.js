// ==============================
// Simulation Consumer Script
// ==============================

// Import Node.js modules for executing external programs
const { execFile, exec } = require("child_process");

/** 
 * Import database model to verify node job chunks 
*/
const nodeJobChunk = require("../mcOpenCL/config/model/jobChunk");
// const nodeState = require("../mcOpenCL/config//model/nodeHeartBeat");

const { spawn } = require("child_process");

// Import OS module to get hostname
const os = require("os");

const path = require("path");
const { Queue, Worker} = require('bullmq');
const { exit } = require("process");

// ==============================
// Node Identification
// ------------------------------
// Each node has a unique node ID combining hostname and NODE_CODE environment variable: This ensures messages are routed to the correct compute node
const nodeCode = process.env.NODE_CODE;
const hostName = process.env.HOST_CODE;
// const RESULTS_QUEUE = "node-result";
// const RESULTS_QUEUE_JOB_NAME = "node-mc-result";

// const nodeQueue = new Queue(RESULTS_QUEUE, {
//   connection: queueConnection
// });

const nodeID =  `node-${hostName}-${nodeCode}`;
const jobQueueNamesapce = process.env.JOB_QUEUE_NAME_SPACE;
const jobQueueJobName = process.env.JOB_QUEUE_JOB_NAME;
const url = "http://localhost:3000/job/result";
const detailsURL = "http://localhost:3000/check-node-details";



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

  // const existingNode = await nodeState.findOne({
  //   where: { nodeId: nodeID }
  // })

  const payload = {
    HOST_NAME: hostName,
    NODE_CODE: nodeCode
  };

  try {

        // ===== POST Result Request =====
        const postResponse = await fetch(detailsURL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!postResponse.ok) {
            console.log(`POST request failed from line 80 of worker.js file: ${postResponse.status} ${postResponse.statusText}`);
        }

        const postData = await postResponse.json();

        if (!postData) {
          console.log("Node code invalid");
          process.exit(1);
        }
        console.log('POST Response:', postData);

    } catch (error) {
        console.error('Error:', error.message);
    }

  console.log("Node verified:", nodeID);

  const worker = new Worker(
    jobQueueNamesapce,
    async job => {

      if (job.name === jobQueueJobName && job.data.nodeId === nodeID) {

        const payload = job.data;

        console.log("MC job received:", payload);

        // await newJob.upsert(payload);

        try {
          result = await runSimulation(payload);

          console.log("Worker result:", result);

          return result;

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

  worker.on("completed", async (job) => {
    console.log("Job completed ID: ", `${job.id}\n`);
    console.log("Job completed result: " , `${job.returnvalue}\n`);

    const result = job.returnvalue;

    await nodeJobChunk.update(
      {
        status: "completed",
        result: result
      },
      {
        where: { id: job.data.chunkId }
      }
    );
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

    const sim = spawn("./mc");

    const data = payload.inputData;

    const input = `${Number(data.runs)} ${data.S0} ${data.K} ${data.r} ${data.sigma} ${data.T}\n`;

    sim.stdin.write(input);

    let output = "";

    sim.stdout.on("data", chunk => {
      output += chunk.toString();
    });

    sim.stderr.on("data", err => {
      console.error("MC stderr:", err.toString());
    });

    sim.on("error", err => {
      reject(err);
    });

    sim.on("close", (code) => {

      if (code !== 0) {
        return reject(new Error(`Simulation exited with code ${code}`));
      };

      const result = parseFloat(output.trim());

      console.log("Simulation result:", result);

      if (!isFinite(result)) {
        return reject(new Error("Invalid result"));
      }

      resolve(result);

    });

    sim.stdin.end();

  });

  }

startSimulationEngine();
simulate();