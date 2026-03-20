const { Worker } = require('bullmq');
const queueConnection = require('../config/db/queue');
const nodeState = require("../../../config/model/nodeHeartBeat");
const { Op } = require("sequelize");

const NODE_CHANNEL = "node-heartbeat";

// const nodeHeartBeatTrackerWorker = new Worker(
const nodeHeartBeatTrackerWorker = new Worker(
  NODE_CHANNEL,
  async job => {

    if (job.name === "nodeHeartBeat") {

      const payload = job.data;

      console.log("Heartbeat received:", payload);

      try {

        // UPSERT node heartbeat
        const [node, created] = await nodeState.findOrCreate({
          where: { nodeId: payload.nodeId },
          defaults: payload
        });

        if (!created) {
          await node.update({
            cpuUsage: payload.cpuUsage,
            cpuCores: payload.cpuCores,
            ramTotal: payload.ramTotal,
            ramFree: payload.ramFree,
            gpuUtilization: payload.gpuUtilization,
            gpuMemoryFree: payload.gpuMemoryFree,
            temperature: payload.temperature,
            simulationsPerSecond: payload.simulationsPerSecond,
            uptime: payload.uptime,
            nodeStatus: payload.nodeStatus,
            jobStatus: payload.jobStatus,
            nodeScore: payload.nodeScore,
            lastHeartbeat: payload.lastHeartbeat
          });

          console.log(`Node updated: ${payload.nodeId}`);
        } else {
          console.log(`New node registered: ${payload.nodeId}`);
        }

      } catch (err) {

        console.error("Heartbeat processing failed:", err);

      }

    }

  },
  {
    connection: queueConnection
  }
);

nodeHeartBeatTrackerWorker.on("completed", job => {
  console.log(`Job completed ${job.id}`);
});

nodeHeartBeatTrackerWorker.on("failed", (job, err) => {
  console.error(`Job failed ${job?.id}`, err);
});

/**Terminates node and its details from the db if no heartbeat is recieved after 61secs*/

const nodeHeartBeatDetailsTerminator = async () => {

  const cutoff = new Date(Date.now() - 60 * 1000);

  const [updated] = await nodeState.update(
    { nodeStatus: "offline" },
    {
      where: {
        lastHeartbeat: { [Op.lt]: cutoff },
        nodeStatus: "online"
      }
    }
  );

  console.log(`${updated} nodes terminated`);

};

// ==============================
// Run the nodeHeartBeatDetailsTerminator every 30 seconds
// ==============================
setInterval(nodeHeartBeatDetailsTerminator, 30000);