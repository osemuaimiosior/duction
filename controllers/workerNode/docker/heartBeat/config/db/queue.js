const {IORedis} = require('ioredis');

const queueConnection = new IORedis({
  port: 6379, // Redis port
  host: "127.0.0.1", // Redis host
  username: "default", // needs Redis >= 6
//   password: "my-top-secret",
  db: 0, // Defaults to 0,
  maxRetriesPerRequest: null 
});

module.exports = queueConnection ;