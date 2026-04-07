// require("dotenv").config();
// const mongoose = require('mongoose');
// const LoadEnv = require('../../config/dopplerConfig');

// const initializeEnv = async () => {
//     return new Promise((resolve) => {
//         new LoadEnv(process.env.ENVIRONMENT, process.env.DOPPLER_TOKEN);
//         setTimeout(() => resolve(LoadEnv.GetEnv()), 3000); // Give time for API fetch
//     });
// };


// function attachDbNameToUri(uri, dbName) {
//     if (!uri || !dbName) return uri;

//     const [base, query] = uri.split('?');
//     let newUri = '';

//     // If there's already a trailing slash
//     if (base.endsWith('/')) {
//         newUri = base + dbName;
//     } else {
//         newUri = base + '/' + dbName;
//     }

//     // Re-append the query string if it exists
//     if (query) {
//         newUri += '?' + query;
//     }

//     return newUri;
// }

// const connectDB = async (req, res) =>{
//     try{
//         // Wait for the environment variables to be loaded
//         const envVars = await initializeEnv();
//         const result = envVars.secrets.MONGO_URL.raw;
//         const conRes = attachDbNameToUri(result, "bloc")
//         console.log(result);
//         console.log(conRes);
//         await mongoose.connect(conRes); 
//     } catch (err) {
//         console.log(err.message);
// }}

// module.exports = connectDB

require('dotenv').config();
const mongoose = require('mongoose');

const connectDB = async () => {
    try{
        await mongoose.connect(process.env.MONGO_URL)
    } catch (err) {
        console.error(err);
}}

module.exports = connectDB