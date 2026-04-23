// require('dotenv').config();

// const cron = require('node-cron');
const express = require('express');
const app = express();
const path = require('path');
// const { runSetup } = require('./network/setup');
const {resultAggregatorQueueWorker} = require("./controllers/controlPlane/resultAggregator/mcAggregator")
const v1Router = require('./router/v1');
const timeout = require('connect-timeout');
const cors = require('cors');
// const db = require("./config/model");
const nodeState = require("./config/model/nodeHeartBeat");
const sequelize = require('./config/db/postgresCloud');
const { Op } = require("sequelize");
const {ipBlocker} = require("./middleware/rateLimiter");
const {startControlPanelServer} = require("./server/main_control_panel/controlpanel");
const {startMonitoringServer} = require("./server/monitoring_control_panel/monitoring");
const {startQueueServer, heartBeatWorkerQueue} = require("./server/queue_control_panel/queue");
const {startRegistryServer} = require("./server/registry/registry");


const sleep = (ms) => new Promise(res => setTimeout(res, ms));
// connectDB()
console.log(`Starting application with NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`Environment variables loaded:`);
console.log(`- PORT: ${process.env.PORT}`);
console.log(`- POSTGRES_URL present: ${!!process.env.POSTGRES_URL}`);

const PORT = process.env.PORT || 5600;

app.use(cors());

// set timeout of 15s for all routes
app.use(timeout('60s'));
app.use((req, res, next) => {
  if (!req.timedout) next();
});


// Middleware
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(ipBlocker);

// Add request logging middleware and add errorLogger to it
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - IP: ${req.ip} - User-Agent: ${req.get('User-Agent')}`);
  next();
});

// Routes
app.use("/api/v1", v1Router);

// app.get("/health", (req, res) => {
//   const healthInfo = {
//     "Message": "200 Success",
//     "timestamp": new Date().toISOString(),
//   };
  
//   console.log("HEALTH ENDPOINT ACCESSED!");  
//   res.status(200).json(healthInfo);
// });

app.get("/health", async (req, res) => {
  try {
    await sequelize.authenticate();

    res.status(200).json({
      status: "UP",
      db: "CONNECTED",
      timestamp: new Date().toISOString(),
    });

  } catch (err) {
    res.status(503).json({
      status: "DOWN",
      db: "DISCONNECTED",
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// async function startServer() {
//   try {
//     await sequelize.authenticate();
//     console.log("PostgreSQL connected");

//      await sequelize.sync({ alter: true }); //dev mode
//     //  await db.sequelize.sync({ alter: true }); //prod mode
//     console.log("Models synchronized");

//     app.listen(3000, () => {
//       console.log("Server running on port 3000");
//     });

//     //Start controll panel server
//     startControlPanelServer();
//     console.log("Started startControlPanelServer");

//     //Starts queue grpc server
//     startQueueServer();
//     console.log("Started startQueueServer");

//     //Starts registry grpc server
//     startRegistryServer();
//     console.log("Started startRegistryServer");

//     //Starts node monitoring grpc server
//     startMonitoringServer();
//     console.log("Started startMonitoringServer");

//     // Start heart beat worker queue engine:
//     heartBeatWorkerQueue();
//     console.log("Started heartBeatWorkerQueue");
//     resultAggregatorQueueWorker();
//     console.log("Started resultAggregatorQueueWorker");

//   } catch (err) {
//     console.error("DB connection failed:", err);
//   }
// }
// const sleep = (ms) => new Promise(res => setTimeout(res, ms));

const isRetryableError = (err) => {
  const code = err?.original?.code;

  return (
    code === "EAI_AGAIN" ||     // DNS issue (your current error)
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND"
  );
};

const connectDBWithRetry = async (retries = 10, baseDelay = 2000) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`DB connection attempt ${attempt}...`);

      await sequelize.authenticate();
      console.log("PostgreSQL connected");

      return; // success → exit loop
    } catch (err) {
      console.error(`DB connection failed (attempt ${attempt})`);

      if (!isRetryableError(err)) {
        console.error("🚫 Non-retryable DB error:", err.message);
        throw err; // don't retry bad config/credentials
      }

      if (attempt === retries) {
        console.error("💥 Max retries reached. Giving up.");
        throw err;
      }

      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.log(`⏳ Retrying in ${delay / 1000}s...`);

      await sleep(delay);
    }
  }
};
async function startServer() {
  try {
    // 🔥 resilient connection
    await connectDBWithRetry();

    // Sync models ONLY after DB is stable
    await sequelize.sync({ alter: true }); // dev mode
    console.log("Models synchronized");

    app.listen(3000, () => {
      console.log("Server running on port 3000");
    });

    // Start services AFTER DB is ready
    startControlPanelServer();
    console.log("Started startControlPanelServer");

    startQueueServer();
    console.log("Started startQueueServer");

    startRegistryServer();
    console.log("Started startRegistryServer");

    startMonitoringServer();
    console.log("Started startMonitoringServer");

    heartBeatWorkerQueue();
    console.log("Started heartBeatWorkerQueue");

    resultAggregatorQueueWorker();
    console.log("Started resultAggregatorQueueWorker");

  } catch (err) {
    console.error("💥 Fatal startup error:", err);

    // important for production (Docker/PM2/K8s will restart)
    process.exit(1);
  }
}

startServer();

////<======================= fabric network startup ======>>////

// Start sequential workflow:
// runSetup();

////<======================= System Configuration startup ======>>////




// 7082987537 opay segun sammuel 12500