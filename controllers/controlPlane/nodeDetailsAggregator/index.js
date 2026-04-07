const nodeState = require("../../../config/model/nodeHeartBeat");
const queueConnection = require('../../../config/db/queue');
const { Worker} = require('bullmq');
const os = require("os");
const path = require("path");
const grpc = require("@grpc/grpc-js")
const protoLoader = require("@grpc/proto-loader")

const PROTO_PATH = path.join(__dirname, "clInfo.proto");

const packageDef = protoLoader.loadSync(PROTO_PATH);
const grpcObject = grpc.loadPackageDefinition(packageDef)
const CLInfoService = grpcObject.CLInfoService

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

        // console.log("Node details recieved:", payload);

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

// gRPC Implementation below

function SendCLinfoDetails(call) {

  };

function getServer() {
  const server = new grpc.Server();
  server.addService(CLInfoService.service, {
    SendCLinfoDetails
  });
  return server;
};

// NOTE: This module exports heartbeat aggregation helpers and should not
// automatically bind a gRPC server during import. Start the gRPC service
// from a dedicated entrypoint if needed.

module.exports = {
  heartBeatWorkerQueue
};
