require('dotenv').config();
const path = require("path");
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');


const PROTO_PATH = path.join(__dirname, 'monitoring.proto');
const packageDefinition = protoLoader.loadSync(
    PROTO_PATH,
    {keepCase: true,
     longs: String,
     enums: String,
     defaults: true,
     oneofs: true
    });
const protoDescriptor = grpc.loadPackageDefinition(packageDefinition).systemState;
const systemStateServerAddr = process.env.SYSTEM_STATE_SERVER_ADDRESS;
const client = new protoDescriptor.SystemState(systemStateServerAddr, grpc.credentials.createInsecure());

/** 
 * getSystemState: Get system information of all participating grid computing node details.
*/

const getSystemState = async(req, res) => {
    const feedback = await new Promise((resolve, reject) => {

      client.getSystemState({}, (err, response) => {

          if (err) {
            return reject(err);
          }
          resolve(response);
        });

    });

    return res.status(201).json({
        mesage: feedback.message,
        details: JSON.parse(feedback.details)
    });
};

module.exports = {
  getSystemState
};


    