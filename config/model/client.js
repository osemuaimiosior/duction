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

    regNodes: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: []
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

    refreshToken: {
      type: DataTypes.STRING,
      allowNull: true
    },

    token: {
      type: DataTypes.STRING,
      allowNull: true
    },

    tokenPublicId: {
      type: DataTypes.STRING,
      allowNull: true
    },

    tokenSecretHash: {
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