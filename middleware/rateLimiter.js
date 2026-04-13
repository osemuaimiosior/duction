const express = require('express');
const app = express();
const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: {
    StatusCode: 429,
    Message: 'failed',
    Data: {
      Details: 'Too many login attempts. Please try again later.'
    }
  }
});

const signUpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: {
    StatusCode: 429,
    Message: 'failed',
    Data: {
      Details: 'Too many signup attempts. Please wait.'
    }
  }
});

const blockedIPs = new Set();

const ipBlocker = (req, res, next) => {
  const ip = req.ip;
  if (blockedIPs.has(ip)) {
    return res.status(403).json({ message: 'Forbidden: IP blocked.' });
  }
  next();
};

//app.use(ipBlocker);


const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: {
    StatusCode: 429,
    Message: 'failed',
    Data: {
      Details: 'Too many signup attempts. Please wait.'
    }
  },
  handler: (req, res, next, options) => {
		if (req.rateLimit.used === req.rateLimit.limit + 1) {
			// onLimitReached code here
      blockedIPs.add(req.ip);
    }
		res.status(options.statusCode).send(options.message)
	},

});

module.exports = {
  loginLimiter,
  signUpLimiter,
  apiRateLimiter,
  ipBlocker
};
