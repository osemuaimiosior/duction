const { DataTypes } = require("sequelize");
const sequelize = require("../db/postgresCloud");

const JobChunk = sequelize.define("JobChunk", {

  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },

  jobId: {
    type: DataTypes.UUID,
    allowNull: false,
    index: true
  },

  nodeId: {
    type: DataTypes.STRING,
    allowNull: true
  },

  runs: {
    type: DataTypes.BIGINT,
    allowNull: false
  },

  result: {
    type: DataTypes.DOUBLE,
    allowNull: true
  },

  status: {
    type: DataTypes.ENUM(
      "queued",
      "assigned",
      "running",
      "completed",
      "failed"
    ),
    defaultValue: "queued"
  },

  startedAt: {
    type: DataTypes.DATE
  },

  completedAt: {
    type: DataTypes.DATE
  }

}, {
  tableName: "job_chunks",
  timestamps: true
});

module.exports = JobChunk;