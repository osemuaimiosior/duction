const queueConnection = require('../../../config/db/queue');
const { Queue, Worker} = require('bullmq');
const nodeState = require("../../../config/model/nodeHeartBeat");
const newJob = require("../../../config/model/newJob");

const RESULTS_QUEUE = "node-result";
const RESULTS_QUEUE_JOB_NAME = "node-mc-result";

const NODE_HEARTBEAT_QUEUE = "node-heartBeat";
const NODE_HEARTBEAT_QUEUE_JOB_NAME = "node-HeartBeat-job";

const nodeResultQueue = new Queue(RESULTS_QUEUE, {
  connection: queueConnection
});

const nodeHeartBeatQueue = new Queue(NODE_HEARTBEAT_QUEUE, {
  connection: queueConnection
});

const sendResultToQueue = async (req, res) => {
  const resultPayload = req.body.RESULT_PAYLOAD;
  
  try {
    await nodeResultQueue.add(RESULTS_QUEUE_JOB_NAME, resultPayload);
    // console.log(`Queue initialized for node: ${NODE_CHANNEL}`);
  } catch (err) {
    console.error(err.message);
  }
  
};

const heartBeatQueue = async (req, res) => {
  // const nodePayload = req.body.NODE_PAYLOAD;
  // const node_ID = nodePayload.nodeId;

  // const nodeDetails = await nodeState.findOne({
  //   where: {nodeID: node_ID }
  // })

  // if(!nodeDetails) {
  //   return res.status(400).json({
  //       status: 400,
  //       message: "Failed",
  //       details: "Invalid node ID detail"
  //     });
  // }
  
  try {
       await nodeHeartBeatQueue.add(NODE_HEARTBEAT_QUEUE_JOB_NAME, nodePayload, {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 2000
          }
        });
      // console.log("sent");

    } catch (err) {
      return res.status(400).json({
        status: 400,
        message: "Failed",
        details: err.message
      });
    }

    return res.status(200).json({
         status: 200,
         message: "Sent Heart beat",
        details: "done"
      });
};


// Export controller so it can be used in route definitions
module.exports = {
  sendResultToQueue,
  heartBeatQueue
};