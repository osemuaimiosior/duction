// ==============================
// Simulation Consumer Script
// ==============================

// Import RedisSMQ to consume messages from Redis queues
const { RedisSMQ } = require("redis-smq");

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
        console.log("Node code invalid")
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

    const handler = async (message, done) => {
      console.log('Received:', message.body);
      // Execute the simulation job
      await runSimulation(message.body);
      // Acknowledge message consumption
      done(); // Acknowledge
    };
    
    // Step 4 — Consume messages from node-specific queue
    consumer.consume(existingNode.nodeId, handler, (err) => {
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

async function runSimulation(job) {

  console.log("Running job:", job.modelType);

  // Arguments to pass to the simulation executable
  const args = [
    job.runs, // Number of simulation iterations
    // Add more parameters if needed, e.g., input file paths
  ];

  /**
   * Step 1 — Execute simulation binary
   *
   * - Uses execFile to run compiled simulation executable `mc`
   * - Non-blocking; stdout/stderr handled in callback
   */

  execFile("./mc", args, (error, stdout, stderr) => {

    if (error) {
      console.error("Simulation error:", error);
      return;
    }

    // Step 2 — Log the simulation results
    console.log("Result:", stdout);
  });

};

// ==============================
// Start the consumer
// ------------------------------
// Immediately run the simulation consumer when script starts
simulate();