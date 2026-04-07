require('dotenv').config();

const path = require("path");
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { Queue} = require('bullmq');
const queueConnection = require('../../config/db/queue');
const nodeState = require("../../config/model/nodeHeartBeat");

const PROTO_PATH = path.join(__dirname, 'registry.proto');
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
const registryPackage = protoDescriptor.registry;

///////////////////////////// SERVER METHODS ///////////////////////////////////////

/**
 * check Node Details and Creat New Queue handler.
 * @param {EventEmitter} call Call object for the handler to process.
 * @param {function(Error, StatusMessage)} callback Response callback
 */

async function checkNodeDetails (call, callback) {
    
    const requestData = call.request;

    try {

    const nodeCode = requestData.NODE_CODE;
    const hostName = requestData.HOST_NAME;

    const NODEID = `node-${hostName}-${nodeCode}`

    const existingNode = await nodeState.findOne({
      where: { nodeId: NODEID }
    });
    
    // console.log(existingNode.dataValues);

    if (existingNode.dataValues) {

        callback(null, {
          message: `Node ${NODEID} found`,
          details: "done"
          // details: existingNode
        });

        // return null;

    } else {

      callback(null, {
          result: "No node details",
          status: 404
        });
      }


    } catch (error) {

      if (error.name === "SequelizeConnectionError") {

        console.error("Database connection failed");

        callback(null, {
          message: "Database unavailable"
        });

      }

      console.error("Unexpected error:", error);

      callback(error, "Internal server error");

    }
};


// Start Controller Panel Server
function getServer() {
  const registryServer = new grpc.Server();
  registryServer.addService(registryPackage.Registry.service, {
    checkNodeDetails
  });
  return registryServer;
}

const startRegistryServer = () =>{
  const routeServer = getServer();
  const registryServerAddr = process.env.REGISTRY_SERVER_ADDRESS;

  routeServer.bindAsync(registryServerAddr, grpc.ServerCredentials.createInsecure(), (err, port) => {
    if (err) {
      console.error(`Failed to bind registry server at ${registryServerAddr}:`, err);
      return;
    }
    routeServer;
    console.log(`Registry gRPC server started on ${registryServerAddr}`);
  });
};

module.exports = { 
  startRegistryServer 
};