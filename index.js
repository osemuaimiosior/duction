// require('dotenv').config();

// const cron = require('node-cron');
const express = require('express');
const app = express();
const path = require('path');
const { runSetup } = require('./network/setup');
const {heartBeatWorkerQueue} = require("./controllers/controlPlane/nodeDetailsAggregator");
const {resultAggregatorQueueWorker} = require("./controllers/controlPlane/resultAggregator/mcAggregator")
const v1Router = require('./router/v1');
const timeout = require('connect-timeout');
// const db = require("./config/model");
const nodeState = require("./config/model/nodeHeartBeat");
const sequelize = require('./config/db/postgresCloud');
const { Op } = require("sequelize");
const {ipBlocker} = require("./middleware/rateLimiter");
const {startControlPanelServer} = require("./server/main_control_panel/controlpanel");
const {startQueueServer} = require("./server/queue_control_panel/queue");


const sleep = (ms) => new Promise(res => setTimeout(res, ms));
// connectDB()
console.log(`Starting application with NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`Environment variables loaded:`);
console.log(`- PORT: ${process.env.PORT}`);
console.log(`- POSTGRES_URL present: ${!!process.env.POSTGRES_URL}`);

const PORT = process.env.PORT || 5600;

// set timeout of 15s for all routes
app.use(timeout('60s'));
app.use((req, res, next) => {
  if (!req.timedout) next();
});


// Middleware
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(ipBlocker);

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - IP: ${req.ip} - User-Agent: ${req.get('User-Agent')}`);
  next();
});

// Routes
app.use("/api/v1", v1Router);

app.get("/health", (req, res) => {
  const healthInfo = {
    "Message": "200 Success",
    "timestamp": new Date().toISOString(),
  };
  
  console.log("HEALTH ENDPOINT ACCESSED!");  
  res.status(200).json(healthInfo);
});

async function startServer() {
  try {
    await sequelize.authenticate();
    console.log("PostgreSQL connected");

     await sequelize.sync({ alter: true }); //dev mode
    //  await db.sequelize.sync({ alter: true }); //prod mode
    console.log("Models synchronized");

    app.listen(3000, () => {
      console.log("Server running on port 3000");
    });

  } catch (err) {
    console.error("DB connection failed:", err);
  }
}

startServer();

////<======================= fabric network startup ======>>////

// Start sequential workflow:
// runSetup();

////<======================= System Configuration startup ======>>////

//Start controll panel server
startControlPanelServer();

//Starts queue grpc server
startQueueServer();

// Start heart beat worker queue engine:
heartBeatWorkerQueue();
resultAggregatorQueueWorker();


