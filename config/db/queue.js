require("dotenv").config();
const IORedis = require('ioredis');

const queueConnection = new IORedis({
  port: 11625, //6379, // Redis port
  host: process.env.TEST_REDIS_URL, //"127.0.0.1", // Redis host
  username: process.env.TEST_REDIS_USER_NAME, // Empty username for Redis Cloud
  password: process.env.TEST_REDIS_PASSWORD,
  db: 0, // Defaults to 0,
  maxRetriesPerRequest: null,
  retryDelayOnFailover: 100,
  // Connection timeout settings
  connectTimeout: 10000, // 10 seconds to connect
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  // Allow automatic reconnection
  lazyConnect: false,
  enableReadyCheck: true,
  enableOfflineQueue: true
});

// Add connection event handlers
queueConnection.on('connect', () => {
  console.log('[Redis] Connected successfully');
});

queueConnection.on('ready', () => {
  console.log('[Redis] Connection ready and authenticated');
});

queueConnection.on('error', (err) => {
  console.error('[Redis] Connection error:', {
    code: err.code,
    message: err.message,
    errno: err.errno,
    hostname: err.hostname
  });
  
  if (err.code === 'ENOTFOUND') {
    console.error('[Redis] DNS resolution failed. Verify:');
    console.error(`  - Hostname: ${process.env.TEST_REDIS_URL}`);
    console.error(`  - DNS server configuration`);
    console.error(`  - Network connectivity to DNS`);
    console.error(`  - Redis Cloud instance is active`);
    console.error('[Redis] Will retry connection with exponential backoff...');
  } else if (err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED') {
    console.error('[Redis] Cannot connect to Redis. Verify:');
    console.error(`  - Host: ${process.env.TEST_REDIS_URL}`);
    console.error(`  - Port: 11625`);
    console.error(`  - Network connectivity`);
    console.error(`  - Redis server is running`);
  } else if (err.code === 'ECONNRESET' || err.code === 'ENETUNREACH') {
    console.error('[Redis] Network connectivity issue. Check:');
    console.error(`  - Internet connection`);
    console.error(`  - Firewall settings`);
    console.error(`  - VPN/proxy configuration`);
  }
});

queueConnection.on('reconnecting', (info) => {
  console.log(`[Redis] Reconnecting... (attempt ${info.attempt})`);
});

queueConnection.on('close', () => {
  console.log('[Redis] Connection closed');
});

// Restart policy implementation
let restartAttempts = 0;
const maxRestartAttempts = 5;
const restartDelay = 30000; // 30 seconds

function checkRedisHealth() {
  return new Promise((resolve) => {
    queueConnection.ping()
      .then(() => resolve(true))
      .catch(() => resolve(false));
  });
}

async function restartRedisConnection() {
  if (restartAttempts >= maxRestartAttempts) {
    console.error(`[Redis] Maximum restart attempts (${maxRestartAttempts}) reached. Giving up.`);
    console.error('[Redis] Please check your Redis configuration and network connectivity.');
    return;
  }

  restartAttempts++;
  console.log(`[Redis] Attempting restart ${restartAttempts}/${maxRestartAttempts}...`);

  try {
    // Disconnect if connected
    if (queueConnection.status === 'ready' || queueConnection.status === 'connecting') {
      await queueConnection.disconnect();
    }

    // Wait before reconnecting
    await new Promise(resolve => setTimeout(resolve, restartDelay));

    // Create new connection
    const newConnection = new IORedis({
      port: 11625,
      host: process.env.TEST_REDIS_URL,
      username: process.env.TEST_REDIS_USER_NAME,
      password: process.env.TEST_REDIS_PASSWORD,
      db: 0,
      maxRetriesPerRequest: null,
      retryDelayOnFailover: 100,
      connectTimeout: 10000,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      lazyConnect: false,
      enableReadyCheck: true,
      enableOfflineQueue: true
    });

    // Copy event handlers to new connection
    newConnection.on('connect', () => {
      console.log('[Redis] Connected successfully (restarted)');
      restartAttempts = 0; // Reset on successful connection
    });

    newConnection.on('ready', () => {
      console.log('[Redis] Connection ready and authenticated (restarted)');
    });

    newConnection.on('error', (err) => {
      console.error('[Redis] Connection error (restarted):', {
        code: err.code,
        message: err.message,
        errno: err.errno,
        hostname: err.hostname
      });

      if (err.code === 'ENOTFOUND') {
        console.error('[Redis] DNS resolution failed. Will retry restart...');
        setTimeout(restartRedisConnection, restartDelay);
      }
    });

    newConnection.on('reconnecting', (info) => {
      console.log(`[Redis] Reconnecting... (attempt ${info.attempt})`);
    });

    newConnection.on('close', () => {
      console.log('[Redis] Connection closed (restarted)');
    });

    // Replace the old connection
    queueConnection = newConnection;

  } catch (error) {
    console.error('[Redis] Restart failed:', error.message);
    setTimeout(restartRedisConnection, restartDelay);
  }
}

// Monitor connection health and trigger restart if needed
setInterval(async () => {
  if (queueConnection.status !== 'ready') {
    const isHealthy = await checkRedisHealth();
    if (!isHealthy) {
      console.log('[Redis] Connection unhealthy, triggering restart...');
      restartRedisConnection();
    }
  }
}, 60000); // Check every minute

module.exports = queueConnection;