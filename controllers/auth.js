const crypto = require("crypto");
const bcrypt = require("bcrypt");

const generateClientToken = async () => {
  const rawToken = crypto.randomBytes(32).toString("hex");

  const hashedToken = await bcrypt.hash(rawToken, 12);

  return { rawToken, hashedToken };

  /**
   * Important: Store hashedToken in DB, Send rawToken to client ONCE */
};

module.exports = {
  generateClientToken
};