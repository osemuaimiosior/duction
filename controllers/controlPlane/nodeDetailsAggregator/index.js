const nodeState = require("../../../config/model/nodeHeartBeat");
const queueConnection = require('../../../config/db/queue');
const { Worker} = require('bullmq');
const os = require("os"); 

const NODE_HEARTBEAT_QUEUE = "node-heartBeat";
const NODE_HEARTBEAT_QUEUE_JOB_NAME = "node-HeartBeat-job";

const nodeCode = process.env.NODE_CODE;
const hostName = process.env.HOST_CODE;

// const nodeID =  `node-${hostName}-${nodeCode}`;


const heartBeatWorkerQueue = async () => {
  const worker = new Worker(
    NODE_HEARTBEAT_QUEUE,
    async job => {

      if (job.name === NODE_HEARTBEAT_QUEUE_JOB_NAME) {

        const payload = job.data;

        console.log("Node details recieved:", payload);

       try {

            await nodeState.upsert(payload);

        } catch (error) {

            console.error("Node details aggregator error:", error);

        };
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
};

module.exports = {
  heartBeatWorkerQueue
};
