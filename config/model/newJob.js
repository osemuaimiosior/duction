const { DataTypes } = require('sequelize');
const sequelize = require('../db/postgresCloud');

  const newJob = sequelize.define("NewJob", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    modelType: {
      type: DataTypes.STRING,
      allowNull: false
    },
    inputData: {
      type: DataTypes.JSONB,
      allowNull: false
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
    clientId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    simulationType: {
      type: DataTypes.STRING,
      allowNull: true
    },
    result: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    error: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, {
    timestamps: true,
    tableName: "new_jobs",
    indexes: [
      { fields: ["inputData"] },
      { fields: ["clientId"] },
      { fields: ["result"] }
    ]
  });

  module.exports = newJob;