const { RedisSMQ } = require("redis-smq");
const { ERedisConfigClient } = require("redis-smq-common");

const JobChunk = require("../../../config/model/jobChunk");

RedisSMQ.initialize(
{
    client: ERedisConfigClient.IOREDIS,
    options: { host: "127.0.0.1", port: 6379 }
},
(err) => {

    if (err) console.error("RedisSMQ init failed:", err);
    else console.log("RedisSMQ initialized");

});

/**
 * Expected result from Node: 
    * {
      "jobId": "job-8473",
      "chunkId": 21,
      "nodeId": "node-4",
      "runs": 10000000,
      "result": 0.51231
    }
 */

const consumer = RedisSMQ.createConsumer();

const RESULTS_QUEUE = "simulation-job-result";

consumer.run((err) => {

    if (err) return console.error("Consumer failed:", err);

    consumer.consume(RESULTS_QUEUE, async (message, done) => {

        try {

            const msg = JSON.parse(message.body);

            const { jobId, nodeId, chunkId, result, runs } = msg;

            console.log("Result received:", msg);

            await updateChunkResult(msg);

            const complete = await isJobComplete(jobId);

            if (complete) {

                const finalResult = await aggregateJob(jobId);

                console.log("Final Monte Carlo result:", finalResult);

            }

        } catch (error) {

            console.error("Aggregator error:", error);

        }

        done();

    });

});

async function updateChunkResult(msg) {

    await JobChunk.update(
      {
          result: msg.result,
          status: "completed",
          completedAt: new Date()
      },
      {
          where: {
              // id: msg.chunkId
              id: msg.nodeId
          }
    });

};

async function isJobComplete(jobId) {

    const pending = await JobChunk.count({
        where: {
            jobId,
            status: ["queued","assigned","running"]
        }
    });

    return pending === 0;

};

async function aggregateJob(jobId) {

    const chunks = await JobChunk.findAll({
        where: {
            jobId,
            status: "completed"
        }
    });

    let weightedSum = 0;
    let totalRuns = 0;

    for (const chunk of chunks) {

        weightedSum += chunk.result * chunk.runs;
        totalRuns += chunk.runs;

    }

    return weightedSum / totalRuns;

}