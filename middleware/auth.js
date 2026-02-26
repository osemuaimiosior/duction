const { Client } = require("../models");
const bcrypt = require("bcrypt");

const authenticateClient = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Missing auth token" });
    }

    const token = authHeader.split(" ")[1];

    const clients = await Client.findAll({
      where: { isActive: true }
    });

    for (const client of clients) {
      const match = await bcrypt.compare(token, client.apiTokenHash);
      if (match) {
        req.client = client;
        return next();
      }
    }

    return res.status(401).json({ message: "Invalid token" });

  } catch (err) {
    return res.status(500).json({ message: "Auth error" });
  }
};