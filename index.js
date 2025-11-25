require('dotenv').config();

// const cron = require('node-cron');
const express = require('express');
const app = express();
const {
    createNS, 
    pvcApply, 
    initIngress, 
    applyYamlFromUrl,
    checkCertMgDeployment,
    waitForNginxIngress,
    runSetup
  } = require('./network/setup');
// const v1Router = require('./router/v1');
const timeout = require('connect-timeout');


const sleep = (ms) => new Promise(res => setTimeout(res, ms));

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

// Connect to database
// connectDB().catch(err => {
//   console.error('Database connection failed:', err);
//   process.exit(1);
// });

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

app.get("/health", (req, res) => {
  const healthInfo = {
    "Message": "200 Success",
    "timestamp": new Date().toISOString(),
  };
  
  console.log("🏥 HEALTH ENDPOINT ACCESSED!");  
  res.status(200).json(healthInfo);
});

////<======================= fabric network startup ======>>////

// Start sequential workflow:
runSetup();

////<======================= fabric network startup ======>>////


app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});