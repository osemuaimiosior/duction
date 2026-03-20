const { Worker } = require('bullmq');
const queueConnection = require('../config/db/queue');
const nodeHeartBeatDetails = require("../../../config/model/nodeHeartBeat")

// const NODE_ID = process.env.NODE_ID;
const NODE_CHANNEL = "node:HeartBeat";

const nodeHeartBeatWorker = new Worker(
  NODE_CHANNEL,
  async job => {

    if (job.name === "nodeHeartBeat") {

        //Save heartbeat details to postgress db
        console.log("Heartbeat received:", job.data);
    }

  },
  {
    connection: queueConnection
  }
);