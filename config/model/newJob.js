
module.exports = (sequelize, DataTypes) => {
  const newJob = sequelize.define("NewJob", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    modelId: {
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
      type: DataTypes.UUID,
      allowNull: false
    },
    assignedWorker: {
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
    tableName: "inference_jobs"
  });

  InferenceJob.associate = (models) => {
    InferenceJob.belongsTo(models.ClientAPI, {
      foreignKey: "clientId",
      onDelete: "CASCADE"
    });
  };

  return newJob;
};