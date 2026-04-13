const bcrypt = require("bcrypt");
// const { Client } = require("../config/model/");

const authenticateClient = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Missing token" });
    }

    const token = authHeader.split(" ")[1];

    const [prefixAndId, secret] = token.split(".");
    const [prefix, publicId] = prefixAndId.split("_");

    if (!prefix || !publicId || !secret) {
      return res.status(401).json({ message: "Invalid token format" });
    }

    const client = await Client.findOne({ where: { publicId } });

    if (!client) {
      return res.status(401).json({ message: "Invalid token" });
    }

    const match = await bcrypt.compare(secret, client.secretHash);

    if (!match) {
      return res.status(401).json({ message: "Invalid token" });
    }

    req.client = client;
    next();

  } catch (err) {
    return res.status(500).json({ message: "Authentication error" });
  }
};

module.exports = authenticateClient;