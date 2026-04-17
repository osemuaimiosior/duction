const { DataTypes } = require('sequelize');
const sequelize = require('../db/postgresCloud');

  const ClientAuth = sequelize.define("ClientAuth", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    auth: {
      type: DataTypes.STRING,
      allowNull: false
    },

    nodeID: {
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
    },

    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  }, {
    tableName: "client",
    timestamps: true
  });

  module.exports = ClientAuth;