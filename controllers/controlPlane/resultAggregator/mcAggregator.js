const JobChunk = require("../../../config/model/jobChunk");
const queueConnection = require("../../../config/db/queue");
const { Worker} = require('bullmq');
const os = require("os"); 


/**
 * Expected result from Node: 
    * {
      "jobId": "job-8473",
      "chunkId": 21,
      "nodeId": "node-4",
      "runs": 10000000,
      "simResult": 0.51231
    }
 */

const RESULTS_QUEUE = "node-result";
const RESULTS_QUEUE_JOB_NAME = "node-mc-result";

const nodeCode = process.env.NODE_CODE;
const hostName = process.env.HOST_CODE;

// const nodeID =  `node-${hostName}-${nodeCode}`;

const resultAggregatorQueueWorker = async () => {
    const worker = new Worker(
        RESULTS_QUEUE,
        async job => {

        if (job.name === RESULTS_QUEUE_JOB_NAME) {

            const payload = job.data;

            console.log("MC job received:", payload);

            await newJob.upsert(payload);

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
}

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

module.exports = {
  resultAggregatorQueueWorker
}