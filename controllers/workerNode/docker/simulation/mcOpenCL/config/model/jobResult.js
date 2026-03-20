const { DataTypes } = require('sequelize');
const sequelize = require('../db/postgresLocal');

  const JobResult = sequelize.define("JobResult", {

    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },

    jobId: {
      type: DataTypes.UUID,
      allowNull: false
    },

    chunkId: {
      type: DataTypes.UUID,
      allowNull: false
    },

    nodeId: {
      type: DataTypes.STRING,
      allowNull: false
    },

    resultData: {
      type: DataTypes.JSONB,
      allowNull: false
    },

    executionTimeMs: {
      type: DataTypes.INTEGER
    }

  }, {
    tableName: "job_results",
    timestamps: true
  })

module.exports = JobResult;