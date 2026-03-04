const Redis = require("ioredis");

const redis = new Redis(process.env.REDIS_URL);

const rateLimiter = async (req, res, next) => {
  try {
    const client = req.client; // set by authenticate middleware

    if (!client) {
      return res.status(500).json({ message: "Client not attached" });
    }

    const limit = client.rateLimitPerMinute;
    const window = 60; // seconds

    const key = `rate:${client.id}`;

    const current = await redis.incr(key);

    if (current === 1) {
      await redis.expire(key, window);
    }

    if (current > limit) {
      return res.status(429).json({
        message: "Rate limit exceeded",
        limit,
        window: "1 minute"
      });
    }

    next();

  } catch (err) {
    console.error("Rate limiter error:", err);
    return res.status(500).json({ message: "Rate limiting error" });
  }
};

module.exports = rateLimiter;