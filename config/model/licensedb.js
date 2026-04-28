const { DataTypes } = require('sequelize');
const sequelize = require('../db/postgresCloud');

  const licensingDB = sequelize.define("licensingDB", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },

    email: {
      type: DataTypes.STRING,
      allowNull: false
    },

    walletBalance: {
      type: DataTypes.INTEGER,
      allowNull: false
    },

    walletTrxLogs: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: []
    },

    pendingActivities: {
      type: DataTypes.INTEGER,
      allowNull: false
    },

    serviceSub: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: []
    },

    vehicleDetails: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: []
    },

    licensingLogs: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: []
    },

    revokedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },

    lastLoginAt: {
      type: DataTypes.DATE,
      allowNull: true
    },

    updatedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },

    createdAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: "licensingDB",
    timestamps: true
  });

  module.exports = licensingDB;