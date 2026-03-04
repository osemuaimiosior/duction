const nodeState = require("../../../config/model/nodeHeartBeat");
const { Op } = require("sequelize");
// const Redis = require("ioredis");
// const redis = new Redis();
const mqtt = require("mqtt");
const client = mqtt.connect("mqtt://test.mosquitto.org");

const HEARTBEAT_TIMEOUT_MS = 10000;
let bestCandidate = null;

const scheduleJob = async (MODEL_TYPE, INPUT_DATA, min_Runs, SIMULATION_TYPE) => {

   /**
   * step 1. Check database of node information.
   * step 2. Identify best canditate(s) for the job
   * step 3. score node performance
   * step 4. Store job schedule node details
   * */ 

  const nodes = await nodeState.findAll({
    where: {
      nodeStatus: "online",
      jobStatus: "idle",
      ramFree: {
        [Op.gt]: 4
      }
    }
  });
  
  let bestScore = -Infinity;

  for (const n of nodes) {

    const heartbeatAge = Date.now() - new Date(n.lastHeartbeat).getTime();
    if (heartbeatAge > HEARTBEAT_TIMEOUT_MS) continue;

    const nodeScore = (n.cpuCores * (1 - n.cpuUsage)) * 2 + n.ramFree + ( n.gpuMemoryFree || 0 );

    if (nodeScore > bestScore) {

      bestScore = nodeScore;

      bestCandidate = {
        nodeId: n.nodeId,
        memoryFree: n.gpuMemoryFree
      };
    }
  }

  if (!bestCandidate) {
    throw new Error("No suitable GPU available");
  };

  const job = {
    NODEID: bestCandidate.nodeId,
    JOB: {
      MODELTYPE: MODEL_TYPE,
      INPUTDATA: INPUT_DATA,
      minRuns: min_Runs,
      SIMULATIONTYPE: SIMULATION_TYPE
    }
  };

  await dispatchJob(job)

  return {
    message: "Job scheduled",
    bestCandidate
  };

};


async function dispatchJob(obj) {

  const channel = `node:${obj.NODEID}:jobs`;

  // await redis.lpush(channel, JSON.stringify(obj.JOB));

  client.publish(channel, obj.JOB);

  // client.on("connect", () => {
  //   client.subscribe(`node:${obj.NODEID}:jobs`, (err) => {
  //     if (!err) {
  //       console.log("Error messagee");
  //     }
  //   });
  // });

  // client.on("message", (topic, message) => {
  //   // message is Buffer
  //   console.log(message.toString());
  //   client.end();
  // });

  await nodeState.update(
    { jobStatus: "busy" },
    { where: { nodeId: bestCandidate.nodeId } }
  );

}

module.exports = { scheduleJob };