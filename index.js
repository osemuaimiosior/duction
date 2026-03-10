// require('dotenv').config();

// const cron = require('node-cron');
const express = require('express');
const app = express();
const path = require('path');
const { runSetup } = require('./network/setup');
// const v1Router = require('./router/v1');
const timeout = require('connect-timeout');
// const db = require("./config/model");
const nodeState = require("./config/model/nodeHeartBeat");
const sequelize = require('./config/db/postgresLocal');
const { Op } = require("sequelize");


const sleep = (ms) => new Promise(res => setTimeout(res, ms));
// connectDB()
console.log(`Starting application with NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`Environment variables loaded:`);
console.log(`- PORT: ${process.env.PORT}`);
console.log(`- POSTGRES_URL present: ${!!process.env.POSTGRES_URL}`);

const PORT = process.env.PORT || 5600;

// set timeout of 15s for all routes
app.use(timeout('15s'));
app.use((req, res, next) => {
  if (!req.timedout) next();
});


// Middleware
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - IP: ${req.ip} - User-Agent: ${req.get('User-Agent')}`);
  next();
});

// Routes
// app.use("/api/v1", v1Router);
// app.use("/api/cgpu/v1", v1CGPURouter);

app.get("/health", (req, res) => {
  const healthInfo = {
    "Message": "200 Success",
    "timestamp": new Date().toISOString(),
  };
  
  console.log("HEALTH ENDPOINT ACCESSED!");  
  res.status(200).json(healthInfo);
});



//If heartbeat > 15 seconds old → node offline
// setInterval(async () => {

//   const cutoff = new Date(Date.now() - 15000);

//   await nodeState.update(
//     { nodeStatus: "offline" },
//     {
//       where: {
//         lastHeartbeat: {
//           [Op.lt]: cutoff
//         }
//       }
//     }
//   );

// }, 10000);


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

////<======================= fabric network startup ======>>////


