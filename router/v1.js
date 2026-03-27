const express = require('express');
const router = express.Router();
const {newJob, checkNodeDetailsCreatNewQueue, checkNodeDetails} = require('../controllers/controlPlane/apiGateway/task');
const {sendResultToQueue, heartBeatQueue} = require('../controllers/controlPlane/queueServerAPI/serverAPI');
const {login, logOut, signUp} = require("../controllers/authentication/auth");
const authenticateClient = require('../middleware/auth');
const {verifyJWT} = require("../middleware/verifyJWT");
const rateLimiter = require('../middleware/rateLimiter');


router.route('/account-login').post(rateLimiter, login);
router.route('/account-logout').post(verifyJWT, rateLimiter, logOut);
router.route('/account-signup').post(rateLimiter, signUp);

router.route('/new-job').post(rateLimiter, newJob);
router.route('/job/result').post(rateLimiter, sendResultToQueue);

router.route('/send-heartBeat-queue').post(rateLimiter, heartBeatQueue);
router.route('/check-node-details-create-newQueue').post(rateLimiter, checkNodeDetailsCreatNewQueue);
router.route('/check-node-details').post(rateLimiter, checkNodeDetails);

module.exports = router;