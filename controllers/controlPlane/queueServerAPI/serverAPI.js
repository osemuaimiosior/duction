const queueConnection = require('../../../config/db/queue');
const { Queue, Worker} = require('bullmq');

const RESULTS_QUEUE = "node-result";
const RESULTS_QUEUE_JOB_NAME = "node-mc-result";

const nodeQueue = new Queue(RESULTS_QUEUE, {
  connection: queueConnection
});

const sendResultToQueue = async (req, res) => {
  const resultPayload = req.body.RESULT_PAYLOAD;
  
  await nodeQueue.add(RESULTS_QUEUE_JOB_NAME, resultPayload);
};

// Export controller so it can be used in route definitions
module.exports = {
  sendResultToQueue
};