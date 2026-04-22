const nodeState = require("../config/model/nodeHeartBeat");
const clientDB = require("../config/model/client");

const getUserNodes = async (req, res) => {
  try {
    const userId = req.user.id;

    const userDetails = await clientDB.findOne({
      where: { id: userId }
    });

    if (!userDetails) {
      return res.status(404).json({
        StatusCode: 404,
        Message: "failed",
        Data: { Message: "User not found" }
      });
    }

    const nodes = userDetails.regNodes || [];

    if (nodes.length === 0) {
      return res.json({
        StatusCode: 200,
        Message: "success",
        nodes: []
      });
    };

    const nodeDetails = await nodeState.findAll({
      where: {
        nodeId: nodes
      }
    });

    // console.log("nodeDetails: ", nodeDetails);

    return res.json({
      StatusCode: 200,
      Message: "success",
      nodes: nodeDetails
    });

  } catch (err) {
    console.error("getUserNodes error:", err);

    return res.status(500).json({
      StatusCode: 500,
      message: "Failed to fetch user nodes",
    });
  }
};

module.exports = { getUserNodes };