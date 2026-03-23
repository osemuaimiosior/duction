const IORedis = require('ioredis');

const queueConnection = new IORedis({
  port: 11625, //6379, // Redis port
  host: procee.env.TEST_REDIS_UR, //"127.0.0.1", // Redis host
  username: procee.env.TEST_REDIS_USER_NAME, // needs Redis >= 6 - commented out for Redis Cloud
  password: procee.env.TEST_REDIS_PASSWORD,
  db: 0, // Defaults to 0,
  maxRetriesPerRequest: null,
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3
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