const { Sequelize } = require("sequelize");
const {Client} = require("pg");

const con = new Client

const sequelize  = new Sequelize(
  "gridcompute", //DB name
  "griduser", //DB User
  "gridpass", //DB paaword
  {
    host: "localhost", // or your DB host
    dialect: "postgres",
    logging: false // disable SQL logging
  }
);

module.exports = sequelize ;

