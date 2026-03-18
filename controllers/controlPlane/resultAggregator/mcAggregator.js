// Import RedisSMQ for message queue communication
const { RedisSMQ, ProducibleMessage } = require("redis-smq");
const { ERedisConfigClient } = require("redis-smq-common");

// Map to store results for each job
// jobId -> { expectedBatches: number, receivedResults: [], resolveCallback }
const jobResults = {};

// Initialize RedisSMQ
RedisSMQ.initialize(
  {
    client: ERedisConfigClient.IOREDIS,
    options: { host: "127.0.0.1", port: 6379 },
  },
  (err) => {
    if (err) console.error("RedisSMQ init failed:", err);
    else console.log("RedisSMQ initialized!");
  }
);

// Create a consumer for the aggregator
const consumer = RedisSMQ.createConsumer();

/**
 * Function to start listening to results from worker nodes
 * @param {string} jobId - The unique ID for the simulation job
 * @param {number} expectedBatches - Number of node batches for this job
 * @returns {Promise<number>} - Resolves to final aggregated result
 */
function aggregateJobResults(expectedBatches) {
  const RESULTS_QUEUE = "simulation-job-result";
  
  return new Promise((resolve, reject) => {
    // Store state for this job
    jobResults[jobId] = {
      expectedBatches,
      receivedResults: [],
      resolveCallback: resolve,
    };

    // Start consuming messages
    consumer.run((err) => {
      if (err) return console.error("Consumer failed:", err);

      consumer.consume(RESULTS_QUEUE, (message, done) => {
        const msg = JSON.parse(message.body);
        const jobId = msg.jobId;

        if (!jobResults[jobId]) return done(); // Ignore unknown jobs

        const state = jobResults[jobId];
        state.receivedResults.push(msg.result);

        if (state.receivedResults.length === state.expectedBatches) {
          const finalResult = state.receivedResults.reduce((a, b) => a + b, 0) / state.receivedResults.length;
          state.resolveCallback(finalResult);
          delete jobResults[jobId];
        }

        done();
      }, (err) => {
        if (err) console.error("Consume failed:", err);
      });
    });
    
  });
  }

// Example usage
async function runExample() {
  // const jobId = "job-123";

  // Unique queue where aggregator listens for results
  
  const expectedBatches = 3; // Suppose 3 nodes were used

  console.log("Waiting for results from nodes...");

  const finalResult = await aggregateJobResults(expectedBatches);
  // const finalResult = await aggregateJobResults(jobId, expectedBatches);

  console.log("Aggregated Monte Carlo result:", finalResult);
}

runExample();