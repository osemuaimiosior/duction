const express = require('express');
const router = express.Router();
const {newJob, checkNodeDetailsCreatNewQueue, checkNodeDetails} = require('../controllers/controlPlane/apiGateway/task');
const {sendResultToQueue, heartBeatQueue} = require('../controllers/controlPlane/queueServerAPI/serverAPI');
const {getSystemState} = require('../controllers/controlPlane/systemMonitor/index');
const {login, logOut, signUp, licensingSignUp, licensingLogin} = require("../controllers/authentication/auth");
const { getUserNodes } = require("../controllers/nodeController");
const authenticateClient = require('../middleware/auth');
const {refreshTokenHandler} = require('../middleware/refreshToken');
const {verifyJWT} = require("../middleware/verifyJWT");
const {loginLimiter, signUpLimiter} = require('../middleware/rateLimiter');


router.route('/account-login').post(loginLimiter, login);
router.route('/licensing/account-login').post(loginLimiter, licensingLogin);
router.route('/account-logout').post(verifyJWT, logOut);
router.route('/account-signup').post(signUpLimiter, signUp);
router.route('/licensing/account-signup').post(signUpLimiter, licensingSignUp);
router.route('/refresh-token').post(refreshTokenHandler);

router.get("/get-user-nodes", verifyJWT, getUserNodes);

router.route('/new-job').post(newJob);
router.route('/job/result').post(sendResultToQueue);

router.route('/send-heartBeat-queue').post(heartBeatQueue);
router.route('/check-node-details-create-newQueue').post(checkNodeDetailsCreatNewQueue);
router.route('/check-node-details').post(checkNodeDetails);

router.route('/get-system-state').get(getSystemState);

module.exports = router;