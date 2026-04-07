const express = require('express');
const router = express.Router();
const {newJob, checkNodeDetailsCreatNewQueue, checkNodeDetails} = require('../controllers/controlPlane/apiGateway/task');
const {sendResultToQueue, heartBeatQueue} = require('../controllers/controlPlane/queueServerAPI/serverAPI');
const {login, logOut, signUp} = require("../controllers/authentication/auth");
const authenticateClient = require('../middleware/auth');
const {verifyJWT} = require("../middleware/verifyJWT");
const {loginLimiter, signUpLimiter} = require('../middleware/rateLimiter');


router.route('/account-login').post(loginLimiter, login);
router.route('/account-logout').post(verifyJWT, logOut);
router.route('/account-signup').post(signUpLimiter, signUp);

router.route('/new-job').post(newJob);
router.route('/job/result').post(sendResultToQueue);

router.route('/send-heartBeat-queue').post(heartBeatQueue);
router.route('/check-node-details-create-newQueue').post(checkNodeDetailsCreatNewQueue);
router.route('/check-node-details').post(checkNodeDetails);

module.exports = router;