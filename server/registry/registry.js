require('dotenv').config();

const path = require("path");
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { Queue} = require('bullmq');
const queueConnection = require('../../config/db/queue');
const nodeState = require("../../config/model/nodeHeartBeat");
const userModel = require("../../config/model/client");

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
    // console.log("NODEID: ", NODEID);

    const existingNode = await nodeState.findOne({
      where: { nodeId: NODEID }
    });
    
    // console.log(existingNode.dataValues);
    // console.log("existingNode: ", existingNode);

    if (existingNode) {

        callback(null, {
          message: `Node ${NODEID} found`,
          details: "done"
          // details: existingNode
        });

        // return null;

    } else {

      callback(null, {
          message: "No node details",
          details: "404"
        });
      }


    } catch (error) {

      if (error.name === "SequelizeConnectionError") {

        console.error("Database connection failed");

        callback(null, {
          message: "Database unavailable",
          details: "error"
        });

      } else {
        console.error("Unexpected error:", error);

        callback(null, {
          message: "Internal server error",
          details: error.message
        });
      }

    }
};

async function checkAuthClientDetails (call, callback) {
    const details = call.request;
    const _token = details.USER_AUTH;
    const ID = details.ID;

    const _clientAuth = {
      auth: _token,
      nodeID: ID
    };
    // console.log("_token:", _token)

    try {

      if (!_token || typeof _token !== 'string') {
        return callback(null, {
          message: 'No auth token provided',
          details: '401'
        });
      }

      const existingClientAuth = await userModel.findOne({
        where: { token: _token }
      });

      if (!existingClientAuth || !existingClientAuth.dataValues) {
        return callback(null, {
          message: "No client with auth detail",
          details: "404"
        });
      }

      // const prefix = "dc_live";

      // // Public ID (short lookup identifier)
      // const publicId = existingClientAuth.tokenPublicId; 
      // // 8 hex chars

      // // Secret (high entropy)
      // const secretHash = existingClientAuth.tokenSecretHash;


      // // Full token sent to client
      // const rawToken = `${prefix}_${publicId}.${secret}`;

      // if(existingClientAuth.token !==  rawToken){
        
      //   return callback(null, {
      //     message: "Invalid Auth token sent",
      //     details: "404"
      //   });

      // };

      return callback(null, {
        message: "Client auth details found",
        details: "done"
      });

    } catch (error) {

      if (error.name === "SequelizeConnectionError") {

        console.error("Database connection failed");

        callback(null, {
          message: "Database unavailable",
          details: "error"
        });

      } else {
        console.error("Unexpected error:", error);

        callback(null, {
          message: "Internal server error",
          details: error.message
        });
      }

    }
};

async function registerNodeDetails (call, callback) {
    
    const details = call.request;

    if (!details || !details.nodePayload || !details.userToken) {
      console.error('Invalid registerNodeDetails request payload:', details);
      return callback(null, {
        message: "Invalid registerNodeDetails payload",
        details: "400"
      });
    }

    try {

    const registeredNode = await nodeState.create(details.nodePayload);
    
    // console.log(registeredNode.dataValues);
    // console.log("registeredNode: ", registeredNode);

    if (registeredNode) {
        const savedNodeDetails = await userModel.findOne({
          where: { token: details.userToken.USER_AUTH }
        });

        if (!savedNodeDetails) {
          return callback(null, {
            message: "Client not found for auth token",
            details: "404"
          });
        }

        const existingRegNodes = Array.isArray(savedNodeDetails.regNodes)
          ? savedNodeDetails.regNodes
          : [];

        if (!existingRegNodes.includes(details.userToken.ID)) {
          existingRegNodes.push(details.userToken.ID);
          savedNodeDetails.regNodes = existingRegNodes;
          await savedNodeDetails.save();
        }

        return callback(null, {
          message: "Client node details saved",
          details: "done"
        });

        // return null;

    } else {

      return callback(null, {
          message: "No client saved",
          details: "404"
        });
      }


    } catch (error) {

      if (error.name === "SequelizeConnectionError") {

        console.error("Database connection failed");

        return callback(null, {
          message: "Database unavailable",
          details: "error"
        });

      } else {
        console.error("Unexpected error:", error);

        return callback(null, {
          message: "Internal server error",
          details: error.message
        });
      }

    }
};


// Start Controller Panel Server
function getServer() {
  const registryServer = new grpc.Server();
  registryServer.addService(registryPackage.Registry.service, {
    checkNodeDetails,
    checkAuthClientDetails,
    registerNodeDetails
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
    routeServer.start();
    console.log(`Registry gRPC server started on ${registryServerAddr} port ${port}`);
  });
};

module.exports = { 
  startRegistryServer 
};