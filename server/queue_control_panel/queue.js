require('dotenv').config();

const path = require("path");
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { Queue} = require('bullmq');
const queueConnection = require('../../config/db/queue');
const nodeState = require("../../config/model/nodeHeartBeat");

const NODE_HEARTBEAT_QUEUE = "node-heartBeat";
const NODE_HEARTBEAT_QUEUE_JOB_NAME = "node-HeartBeat-job";

const nodeResultQueue = new Queue(RESULTS_QUEUE, {
  connection: queueConnection
});

const nodeHeartBeatQueue = new Queue(NODE_HEARTBEAT_QUEUE, {
  connection: queueConnection
});


const PROTO_PATH = path.join(__dirname, 'queue.proto');
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
const nodeDetailsPackage = protoDescriptor.nodeDetails;

///////////////////////////// SERVER METHODS ///////////////////////////////////////

/**
 * check Node Details and Creat New Queue handler.
 * @param {EventEmitter} call Call object for the handler to process.
 * @param {function(Error, StatusMessage)} callback Response callback
 */

async function checkNodeDetailsCreatNewQueueAndSave (call, callback) {
    
    const requestData = call.request;

    try {

    const queueName = requestData.QUEUE_NAME;
    let nodeDetails = requestData.QUEUE_PAYLOAD;
    const NODEID = requestData.NODE_ID;

    if (typeof nodeDetails === "string") {
      try {
        nodeDetails = JSON.parse(nodeDetails);
      } catch (parseErr) {
        console.warn("Failed to parse QUEUE_PAYLOAD JSON string:", parseErr.message);
      }
    }

    const effectiveNodeId = NODEID || nodeDetails?.nodeId;
    const effectiveQueueName = queueName || nodeDetails?.nodeId;

    console.log("Registering node:", effectiveNodeId, "queue:", effectiveQueueName)

    if (!nodeDetails || typeof nodeDetails !== "object") {
      throw new Error("Invalid node details payload");
    }

    const existingNode = await nodeState.findOne({
      where: { nodeId: effectiveNodeId }
    });

    if (!existingNode) {

      try {

        await nodeState.create(nodeDetails);

        new Queue(effectiveQueueName, { connection: queueConnection });

        console.log(`Queue initialized for node: ${queueName}`);

        
        callback(null, {
          message: "Node registered",
          details: queueName
        });
        
        return;

      } catch (err) {

        console.error("Failed to initialize Redis queue and register node:", err.message);

        callback(null, {
          message: "Error message",
          details: err.message
        });

      }
    }

    callback(null, {
        message: "Node details already exist",
        details: 404
    });

  } catch (error) {

    console.error("Error checking node:", error);

    callback(error, null);

  }
};

async function heartBeatSignal (call, callback) {
    
    const requestData = call.request;

    try {

    let nodeDetails = requestData.nodeId;

    if (typeof nodeDetails === "string") {
      try {
        nodeDetails = JSON.parse(nodeDetails);
      } catch (parseErr) {
        console.warn("Failed to parse QUEUE_PAYLOAD JSON string:", parseErr.message);
      }
    };

    const effectiveNodeId = NODEID || nodeDetails?.nodeId;

    console.log("Checking node:", effectiveNodeId)

    if (!nodeDetails || typeof nodeDetails !== "object") {
      throw new Error("Invalid node details payload");
    }

    const existingNode = await nodeState.findOne({
      where: { nodeId: effectiveNodeId }
    });

    if (!existingNode) {

      try {

        const feedback = await nodeState.update(nodeDetails);

        await nodeHeartBeatQueue.add(NODE_HEARTBEAT_QUEUE_JOB_NAME, nodePayload, {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 2000
          }
        });

        callback(null, {
          message: "Node hertbeat saved",
          details: feedback
        });

      } catch (err) {

        console.error("Failed to update node heart beat:", err.message);

        callback(null, {
          message: "Error message",
          details: err.message
        });

      }
    }

    callback(null, {
        message: "Node details does not exist",
        details: 404
    });

  } catch (error) {

    console.error("Error checking node:", error);

    callback(error, null);

  }
};


// Start Controller Panel Server
function getServer() {
  const queueServer = new grpc.Server();
  queueServer.addService(nodeDetailsPackage.NodeDetails.service, {
    checkNodeDetailsCreatNewQueueAndSave,
    heartBeatSignal
  });
  return queueServer;
}

const startQueueServer = () =>{
  const routeServer = getServer();
  const queueServerAddr = process.env.QUEUE_SERVER_ADDRESS;

  routeServer.bindAsync(queueServerAddr, grpc.ServerCredentials.createInsecure(), (err, port) => {
    if (err) {
      console.error(`Failed to bind queue server at ${queueServerAddr}:`, err);
      return;
    }
    routeServer;
    console.log(`Queue gRPC server started on ${queueServerAddr}`);
  });
};

module.exports = { 
  startQueueServer 
};