const { DataTypes } = require('sequelize');
const sequelize = require('../db/postgresCloud');

  const Client = sequelize.define("Client", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    fullName: {
      type: DataTypes.STRING,
      allowNull: false
    },

    email: {
      type: DataTypes.STRING,
      allowNull: false
    },

    phoneNumber: {
      type: DataTypes.STRING,
      allowNull: false
    },

    accessToken: {
      type: DataTypes.STRING,
      allowNull: true
    },

    passwordHashed: {
      type: DataTypes.STRING,
      allowNull: false
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
    },

    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  }, {
    tableName: "client",
    timestamps: true
  });

  module.exports = Client;