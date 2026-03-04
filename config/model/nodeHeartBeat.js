module.exports = (sequelize, DataTypes) => {

  const nodeState = sequelize.define("nodeState", {

    nodeId: {
      type: DataTypes.STRING,
      allowNull: false,
      primaryKey: true
    },

    cpuUsage: {
      type: DataTypes.FLOAT,
      allowNull: false
    },

    cpuCores: {
      type: DataTypes.INTEGER,
      allowNull: false
    },

    ramTotal: {
      type: DataTypes.FLOAT,
      allowNull: false
    },

    ramFree: {
      type: DataTypes.FLOAT,
      allowNull: false
    },

    gpuUtilization: {
      type: DataTypes.FLOAT,
      allowNull: true
    },

    gpuMemoryFree: {
      type: DataTypes.FLOAT,
      allowNull: true
    },

    temperature: {
      type: DataTypes.FLOAT,
      allowNull: true
    },

    simulationsPerSecond: {
      type: DataTypes.INTEGER,
      allowNull: true
    },

    uptime: {
      type: DataTypes.INTEGER,
      allowNull: false
    },

    nodeStatus: {
      type: DataTypes.ENUM("online", "offline"),
      defaultValue: "offline"
    },

    jobStatus: {
      type: DataTypes.ENUM("idle", "busy"),
      defaultValue: "idle"
    },

    nodeScore: {
      type: DataTypes.FLOAT,
      allowNull: true
    },

    lastHeartbeat: {
      type: DataTypes.DATE
    }

  }, {
    timestamps: true,

    indexes: [
      { fields: ["nodeStatus"] },
      { fields: ["jobStatus"] },
      { fields: ["lastHeartbeat"] },
      { fields: ["nodeScore"] }
    ]
  });

  return nodeState;
};