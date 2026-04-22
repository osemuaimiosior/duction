require('dotenv').config();
const jwt = require('jsonwebtoken');

const refreshTokenHandler = async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(401).json({ message: "No refresh token" });
  }

  const user = await clientModel.findOne({
    where: { refreshToken: token }
  });

  if (!user) {
    return res.status(403).json({ message: "Invalid refresh token" });
  }

  jwt.verify(
    token,
    process.env.REFRESH_TOKEN_SECRET,
    (err, decoded) => {
      if (err) {
        return res.status(403).json({ message: "Expired refresh token" });
      }

      const newAccessToken = jwt.sign(
        { id: user.id },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: "30m" }
      );

      return res.json({
        accessToken: newAccessToken
      });
    }
  );
};

module.exports = {
    refreshTokenHandler
};
