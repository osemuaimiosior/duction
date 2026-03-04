const axios = require("axios");
const os = require("os");

const CONTROL_PLANE_URL = "http://your-control-plane:3000/heartbeat";
const NODE_ID = process.env.NODE_ID || "node-1";

async function collectStats() {
  // Replace with real GPU stats later (nvidia-smi)
  return {
    nodeId: NODE_ID,
    status: "online",
    cpuLoad: os.loadavg()[0] / os.cpus().length,
    gpus: [
      {
        id: 0,
        totalVram: 24576,
        freeVram: 18000,
        utilization: 35
      }
    ]
  };
}

const sendHeartbeat = async () => {
  try {
    const stats = await collectStats();

    await axios.post(CONTROL_PLANE_URL, stats);

    console.log("Heartbeat sent");
  } catch (err) {
    console.error("Heartbeat failed:", err.message);
  }
};

module.exports = {
  sendHeartbeat
};

// Run every 5 seconds
// setInterval(sendHeartbeat, 5000);