// ==============================
// Simulation Consumer Script
// ==============================

// Import RedisSMQ to consume messages from Redis queues
const { RedisSMQ, ProducibleMessage } = require("redis-smq");

// Import Node.js modules for executing external programs
const { execFile } = require("child_process");

// Import database model to verify node registration and heartbeat: This ensures only valid nodes can run simulation jobs
const nodeState = require("../../../../../config/model/nodeHeartBeat");

// Import OS module to get hostname
const os = require("os");

// ==============================
// Node Identification
// ------------------------------
// Each node has a unique node ID combining hostname and NODE_CODE environment variable: This ensures messages are routed to the correct compute node
const nodeCode = process.env.NODE_CODE;
const nodeID =  os.hostname() + "-" + `${nodeCode}`;


// ==============================
// RedisSMQ Consumer Setup
// ------------------------------
// The consumer listens for jobs assigned to this node

const consumer = RedisSMQ.createConsumer();

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
  // Step 1 — Verify node registration
  const existingNode = await nodeState.findOne({
        where: { nodeId: nodeID }
      }).exec();
    
      if (!existingNode) {
        // Node is not registered or code is invalid
        console.log("Node code invalid line 50 from worker.js");
        process.exit(1);
      };
  
  // Step 2 — Start RedisSMQ consumer
  consumer.run((err) => {
    if (err) return console.error('Consumer failed:', err);
    
     /**
     * Step 3 — Message handler for incoming simulation jobs
     *
     * Each message contains job parameters:
     * - modelType: identifies which simulation model to run
     * - runs: number of iterations or samples
     * - inputData: optional input data for the simulation
     *
     * `done()` acknowledges successful processing to Redis
     */

    // const handler = async (message, done) => {
    //   console.log('Received:', message.body);
    //   // Execute the simulation job
    //   await runSimulation(message.body);
    //   // Acknowledge message consumption
    //   done(); // Acknowledge
    // };

    const handler = async (message, done) => {

    const job = JSON.parse(message.body);

    try {

      console.log("Received job:", job);

      await runSimulation(job);

    } catch (err) {

      console.error("Job failed:", err);

    }

    done();

  };
    
    // Step 4 — Consume messages from node-specific queue
    consumer.consume(`node:${existingNode.nodeId}`, handler, (err) => {
      if (err) console.error('Consume failed:', err);
      else console.log(`Listening on ${existingNode.nodeId}...`);
    });
  });
};

/**
 * Function: runSimulation
 * ------------------------------
 * Executes the simulation for the job received.
 *
 * 1. Logs the job details
 * 2. Passes parameters to an external simulation binary (e.g., Monte Carlo executable `mc`)
 * 3. Handles output and errors
 */

// Create a RedisSMQ producer for sending results
const producer = RedisSMQ.createProducer();

// Send the result to the aggregator via RedisSMQ
producer.run((err) => {
  if (err) return console.error("Producer failed:", err);

});

/**
 * Run a simulation job and send results to the aggregator
 * @param {Object} job - Job object containing simulation parameters
 *  Example: { id: "job123", modelType: "monte_carlo", runs: 1000000, S0: 100, K: 110, r: 0.05, sigma: 0.2, T: 1 }
 */


function runSimulation(job) {

  return new Promise((resolve, reject) => {

    const args = [
      job.runs,
      job.S0,
      job.K,
      job.r,
      job.sigma,
      job.T
    ];

    execFile("./mc", args, (error, stdout, stderr) => {

      if (error) {
        console.error("Simulation error:", error);
        return reject(error);
      }

      const result = parseFloat(stdout.trim());

      if (isNaN(result)) {
        return reject(new Error("Invalid simulation output from line 154 from worker.js"));
      }

      console.log("Simulation result:", result);

      const resultPayload = {
        jobId: job.jobId,
        chunkId: job.chunkId,
        nodeId: nodeID,
        result: result,
        runs: job.runs,
        timestamp: new Date()
      };

      const msg = new ProducibleMessage()
        .setQueue("simulation-job-result")
        .setBody(JSON.stringify(resultPayload));

      producer.produce(msg, (err, ids) => {

        if (err) {
          console.error("Send failed:", err);
          return reject(err);
        }

        console.log(`Result sent: ${ids}`);

        resolve();

      });

    });

  });

}

simulate();