require("dotenv").config();
const IORedis = require('ioredis');

const queueConnection = new IORedis({
  port: 11625, //6379, // Redis port
  host: process.env.TEST_REDIS_URL, //"127.0.0.1", // Redis host
  username: process.env.TEST_REDIS_USER_NAME, // Empty username for Redis Cloud
  password: process.env.TEST_REDIS_PASSWORD,
  db: 0, // Defaults to 0,
  maxRetriesPerRequest: null,
  retryDelayOnFailover: 100
});

// Add connection event handlers
queueConnection.on('connect', () => {
  console.log('Redis connected successfully');
});

queueConnection.on('error', (err) => {
  console.error('Redis connection error:', err.message);
});

queueConnection.on('ready', () => {
  console.log('Redis connection ready');
});

module.exports = queueConnection ;