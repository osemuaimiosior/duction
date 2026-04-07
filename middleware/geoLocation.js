const geoip = require("geoip-lite");

const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

const geo = geoip.lookup(ip);