const crypto = require("crypto");
const bcrypt = require("bcrypt");

const generateClientToken = async () => {
  const prefix = "dc_live";

  // Public ID (short lookup identifier)
  const publicId = crypto.randomBytes(4).toString("hex"); 
  // 8 hex chars

  // Secret (high entropy)
  const secret = crypto.randomBytes(32).toString("hex");

  // Full token sent to client
  const rawToken = `${prefix}_${publicId}.${secret}`;

  // Only hash the secret part
  const secretHash = await bcrypt.hash(secret, 12);

  return {
    rawToken,       // Send to client ONCE
    publicId,       // Store in DB
    secretHash      // Store in DB
  };
};

module.exports = {
  generateClientToken
};