
module.exports = (sequelize, DataTypes) => {
  const ClientAPI = sequelize.define("ClientAPI", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    publicId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    secretHash: {
      type: DataTypes.STRING,
      allowNull: false
    },
     environment: {
      type: DataTypes.ENUM("live", "test"),
      defaultValue: "test"
    },
    revokedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },

    lastUsedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  }, {
    tableName: "clients",
    timestamps: true
  });

  ClientAPI.associate = (models) => {
    ClientAPI.hasMany(models.InferenceJob, {
      foreignKey: "clientId"
    });
  };

  return ClientAPI;
};