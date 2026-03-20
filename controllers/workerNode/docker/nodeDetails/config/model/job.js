const { DataTypes } = require('sequelize');
const sequelize = require('../db/postgresLocal');

  const Job = sequelize.define("Job", {

    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },

    clientId: {
      type: DataTypes.UUID,
      allowNull: false
    },

    nodeId: {
      type: DataTypes.UUID,
      allowNull: false
    },

    jobId: {
      type: DataTypes.UUID,
      allowNull: false
    },

    modelType: {
      type: DataTypes.STRING,
      allowNull: false
    },

    simulationType: {
      type: DataTypes.STRING,
      allowNull: false
    },

    inputData: {
      type: DataTypes.JSONB,
      allowNull: false
    },

    totalRuns: {
      type: DataTypes.BIGINT,
      allowNull: false
    },

    status: {
      type: DataTypes.ENUM(
        "queued",
        "splitting",
        "running",
        "completed",
        "failed"
      ),
      defaultValue: "queued"
    },

    progress: {
      type: DataTypes.FLOAT,
      defaultValue: 0
    },

    finalResult: {
      type: DataTypes.JSONB
    }

  }, {
    tableName: "jobs",
    timestamps: true
  });

module.exports = Job;