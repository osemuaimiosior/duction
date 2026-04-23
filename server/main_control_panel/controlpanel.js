require('dotenv').config();

const fs = require('fs');
const path = require("path");
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const _ = require('lodash');
const { Queue, Worker} = require('bullmq');
const queueConnection = require('../../config/db/queue');
const { Op } = require("sequelize");
const nodeState = require("../../config/model/nodeHeartBeat");
const clientModel = require("../../config/model/client");
const nodeJobChunk = require("../../config/model/jobChunk");

const jobQueueNamesapce = process.env.JOB_QUEUE_NAME_SPACE;
const jobQueueJobName = process.env.JOB_QUEUE_JOB_NAME;

const nodeQueue = new Queue(jobQueueNamesapce, {
        connection: queueConnection
    });

async function dispatchJob(job) {

    const payload = {
      jobId: job.jobId,
      chunkId: job.chunkId,
      nodeId: job.nodeId,
      runs: job.runs,
      modelType: job.modelType,
      inputData: job.inputData,
      simulationType: job.simulationType
    };

    const payloadStr = JSON.stringify(payload);

    // console.log("Queue initialized:", "node-heartBeat");

    // Send heartbeat job
    await nodeQueue.add(jobQueueJobName, payloadStr, {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2000
      }
    });
  };

  /**
 * Split Simulation Runs into Chunks
 *
 * Example:
 *
 * totalRuns = 3,000,000
 *
 * Output:
 *
 * [
 *   1,000,000
 *   1,000,000
 *   1,000,000
 * ]
 *
 * This allows distributed execution.
 */


async function splitRuns(totalRuns, jobId) {

  const chunks = []
  let remaining = totalRuns

  while (remaining > 0) {

    const chunkSize = Math.min(MAX_NODE_RUN, remaining)

    chunks.push(chunkSize)

    remaining -= chunkSize
  }

  /**
   * Insert chunk rows
   */

  for (const runs of chunks) {

    await nodeJobChunk.create({
      jobId,
      runs,
      nodeId: null,
      status: "queued"
    });

  }

  return chunks.length
  };

///////////////////////////// SERVER METHODS ///////////////////////////////////////

/**
 * scheduleJob handler. schedules a job sent by a client to the respective capable node processor.
 * @param {EventEmitter} call Call object for the handler to process.
 * @param {function(Error, StatusMessage)} callback Response callback
 */

async function scheduleJob (call, callback) {
  const JobData = call.request;

  try {
    validateClientMetadata(call);

    const requireMinRuns = Number(process.env.MIN_RUN_SIMULATION);
    const inputData = JSON.parse(JobData.INPUT_DATA);

    if (JobData.RUNS < requireMinRuns) {
      throw new Error(`Minimum runs must be >= ${requireMinRuns}`);
    }
      
        /**
         * Split runs into chunk rows
         */
      
        const chunkCount = await splitRuns(JobData.RUNS, JobData.jobID);
      
        /**
         * Fetch queued chunks
         */
      
        const chunks = await nodeJobChunk.findAll({
          where: {
            jobId: JobData.jobID,
            status: "queued"
          }
        });
      
        /**
         * Get available nodes
         */
      
        const nodes = await nodeState.findAll({
          where: {
            nodeStatus: "online",
            jobStatus: "idle",
            ramFree: {
              [Op.gt]: 1
            }
          }
        });
      
        if (!nodes.length) {
          throw new Error("No nodes available");
        }
      
        /**
         * Round robin dispatch
         */
      
        for (let i = 0; i < chunks.length; i++) {
      
          const node = nodes[i % nodes.length]
      
          await dispatchJob({
            chunkId: chunks[i].id,
            jobId: JobData.jobID,
            nodeId: node.nodeId,
            runs: chunks[i].runs,
            modelType: JobData.MODEL_TYPE,
            inputData: inputData,
            simulationType: JobData.SIMULATION_TYPE
          });
      
        }
      
        callback(null, {
          message: "Job scheduled successfully",
          data: chunkCount
        });
    } catch (err) {

      console.error(err);

      callback({
        code: err.code || grpc.status.INTERNAL,
        message: err.message
      });
    };

  
  // call.on('end', () => {
  //   call.end();
  // });
};

async function errorLogger (call, callback) {
  const errorDetails = call.request;

  try {
   
      
        callback(null, {
          message: "error logged",
        });
    } catch (err) {

      console.error(err);

      callback({
        code: err.code || grpc.status.INTERNAL,
        message: err.message
      });
    };

  
  // call.on('end', () => {
  //   call.end();
  // });
};

const PROTO_PATH = path.join(__dirname, 'controlpanel.proto');
const packageDefinition = protoLoader.loadSync(
    PROTO_PATH,
    {keepCase: true,
     longs: String,
     enums: String,
     defaults: true,
     oneofs: true
    });
const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
// The protoDescriptor object has the full package hierarchy
const controlpanelPackage = protoDescriptor.controlpanel;

// Start Controll Panel Server
function getServer() {
  const controllpanelServer = new grpc.Server();
  controllpanelServer.addService(controlpanelPackage.Controlpanel.service, {
    scheduleJob,
    errorLogger
  });
  return controllpanelServer;
}


const GRPC_TLS_ENABLED = process.env.GRPC_TLS_ENABLED === 'true';
const GRPC_ROOT_CERT = process.env.GRPC_ROOT_CERT || path.resolve(__dirname, '../../certs/ca.crt');
const GRPC_SERVER_CERT = process.env.GRPC_SERVER_CERT || path.resolve(__dirname, '../../certs/server.crt');
const GRPC_SERVER_KEY = process.env.GRPC_SERVER_KEY || path.resolve(__dirname, '../../certs/server.key');
const GRPC_AUTH_TOKEN = process.env.GRPC_AUTH_TOKEN || process.env.CONTROL_PANEL_API_TOKEN || '';

const GRPC_CLIENT_CERT_REQUIRED = process.env.GRPC_CLIENT_CERT_REQUIRED === 'true';
const serverCreds = (() => {
  if (!GRPC_TLS_ENABLED) {
    return grpc.ServerCredentials.createInsecure();
  }

  const certChain = fs.readFileSync(GRPC_SERVER_CERT);
  const privateKey = fs.readFileSync(GRPC_SERVER_KEY);
  const rootCert = GRPC_CLIENT_CERT_REQUIRED ? fs.readFileSync(GRPC_ROOT_CERT) : null;

  return grpc.ServerCredentials.createSsl(rootCert, [
    {
      cert_chain: certChain,
      private_key: privateKey
    }
  ], GRPC_CLIENT_CERT_REQUIRED);
})();

function validateClientMetadata(call) {
  if (!GRPC_AUTH_TOKEN) {
    return;
  }

  const authHeader = (call.metadata.get('authorization') || [])[0] || (call.metadata.get('x-api-key') || [])[0];
  if (!authHeader || authHeader !== GRPC_AUTH_TOKEN) {
    const err = new Error('Unauthenticated: invalid or missing authentication token');
    err.code = grpc.status.UNAUTHENTICATED;
    throw err;
  }
}

const startControlPanelServer = () => {
  const routeServer = getServer();
  const controlPanellServerAddr = process.env.CONTROLL_PANEL_SERVER_ADDRESS;
  const credentials = serverCreds;

  if (!controlPanellServerAddr) {
    console.error('CONTROLL_PANEL_SERVER_ADDRESS is not configured. Control panel gRPC server will not start.');
    return;
  }

  routeServer.bindAsync(controlPanellServerAddr, credentials, (err, port) => {
    if (err) {
      console.error(`Failed to bind control panel server at ${controlPanellServerAddr}:`, err);
      return;
    }

    routeServer.start();
    console.log(`Control panel gRPC server started on ${controlPanellServerAddr} port ${port} using ${GRPC_TLS_ENABLED ? 'TLS' : 'insecure'} credentials`);
  });
};


module.exports = { 
  startControlPanelServer 
};