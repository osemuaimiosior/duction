require('dotenv').config();

const path = require("path");
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
// const { Queue, Worker} = require('bullmq');
// const queueConnection = require('../../config/db/queue');
const nodeState = require("../../config/model/nodeHeartBeat");
const { Sequelize } = require('sequelize');
// const os = require("os");
// const { exit } = require('process');


const PROTO_PATH = path.join(__dirname, 'monitoring.proto');
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
const systemStatePackage = protoDescriptor.systemState;

///////////////////////////// SERVER METHODS ///////////////////////////////////////

/**
 * Retrieve current system state details for all registered nodes.
 * @param {EventEmitter} call Call object for the handler to process.
 * @param {function(Error, StatusMessage)} callback Response callback
 */

async function getSystemState (call, callback) {

  try {
    // const systemStateDetails = await nodeState.findAll();
    const summary = await nodeState.findOne({
      attributes: [
        [Sequelize.fn('COUNT', Sequelize.col('nodeId')), 'totalNodes'],
        [Sequelize.fn('SUM', Sequelize.col('cpuCores')), 'totalCpuCores'],
        [Sequelize.fn('SUM', Sequelize.col('ramTotal')), 'totalRam'],
        [Sequelize.fn('SUM', Sequelize.col('ramFree')), 'totalRamFree']
      ],
      raw: true
    });

    // if (!Array.isArray(systemStateDetails) || systemStateDetails.length === 0) {
    //   return callback(null, {
    //     message: "No nodes found",
    //     details: JSON.stringify([])
    //   });
    // }

    // const result = systemStateDetails.map(node => {
    //   const json = node.toJSON ? node.toJSON() : node;
    //   return {
    //     nodeId: json.nodeId,
    //     cpuUsage: json.cpuUsage,
    //     cpuCores: json.cpuCores,
    //     ramTotal: json.ramTotal,
    //     ramFree: json.ramFree,
    //     gpuUtilization: json.gpuUtilization,
    //     gpuMemoryFree: json.gpuMemoryFree,
    //     temperature: json.temperature,
    //     simulationsPerSecond: json.simulationsPerSecond,
    //     uptime: json.uptime,
    //     nodeStatus: json.nodeStatus,
    //     jobStatus: json.jobStatus,
    //     nodeScore: json.nodeScore,
    //     lastHeartbeat: json.lastHeartbeat,
    //     systemInfo: json.systemInfo,
    //     platform: json.platform
    //   };
    // });

    // const totals = result.reduce((acc, node) => {
    //   acc.totalNodes += 1;
    //   acc.totalCpuCores += Number(node.cpuCores) || 0;
    //   acc.totalRam += Number(node.ramTotal) || 0;
    //   acc.totalRamFree += Number(node.ramFree) || 0;
    //   acc.totalGpuMemoryFree += Number(node.gpuMemoryFree) || 0;
    //   acc.totalGpuUtilization += Number(node.gpuUtilization) || 0;
    //   return acc;
    // }, {
    //   totalNodes: 0,
    //   totalCpuCores: 0,
    //   totalRam: 0,
    //   totalRamFree: 0,
    //   totalGpuMemoryFree: 0,
    //   totalGpuUtilization: 0
    // });

    // const summary = {
    //   totalNodes: totals.totalNodes,
    //   totalCpuCores: totals.totalCpuCores,
    //   totalRam: totals.totalRam,
    //   totalRamFree: totals.totalRamFree,
    //   totalGpuMemoryFree: totals.totalGpuMemoryFree,
    //   totalGpuUtilization: totals.totalGpuUtilization,
    //   averageCpuUsage: totals.totalNodes > 0 ? result.reduce((sum, node) => sum + (Number(node.cpuUsage) || 0), 0) / totals.totalNodes : 0,
    //   averageUptime: totals.totalNodes > 0 ? result.reduce((sum, node) => sum + (Number(node.uptime) || 0), 0) / totals.totalNodes : 0
    // };

    return callback(null, {
      message: "OK",
      details: JSON.stringify(summary)
    });

  } catch (error) {
    console.error("Error retrieving system state details:", error?.original?.code || error.message);
    return callback(error, null);
  }
};


// Start Controller Panel Server
function getServer() {
  const systemStateServer = new grpc.Server();
  systemStateServer.addService(systemStatePackage.SystemState.service, {
    getSystemState
  });
  return systemStateServer;
}

const startMonitoringServer = () =>{
  const systemSateServer = getServer();
  const systemSateAddr = process.env.SYSTEM_STATE_SERVER_ADDRESS;

  systemSateServer.bindAsync(systemSateAddr, grpc.ServerCredentials.createInsecure(), (err, port) => {
    if (err) {
      console.error(`Failed to bind queue server at ${systemSateAddr}:`, err);
      return;
    }
    systemSateServer;
    console.log(`Queue gRPC server started on ${systemSateAddr}`);
  });
};

module.exports = { 
  startMonitoringServer,
};