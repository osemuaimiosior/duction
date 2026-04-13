const sequelize = require("../db/postgresLocal");

const NodeState = require("./nodeState")(sequelize, require("sequelize").DataTypes);

const db = {};

db.sequelize = sequelize;
db.NodeState = NodeState;

module.exports = db;