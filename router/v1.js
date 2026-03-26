const express = require('express');
const router = express.Router();
const {newJob, checkNodeDetailsCreatNewQueue, checkNodeDetails} = require('../controllers/controlPlane/apiGateway/task');
const {sendResultToQueue, heartBeatQueue} = require('../controllers/controlPlane/queueServerAPI/serverAPI');
const authenticateClient = require('../middleware/auth');
const rateLimiter = require('../middleware/rateLimiter');


router.route('/new-job')
    .post(newJob);

router.route('/job/result')
    .post(sendResultToQueue);

router.route('/send-heartBeat-queue')
    .post(heartBeatQueue);

router.route('/check-node-details-create-newQueue')
    .post(checkNodeDetailsCreatNewQueue);

router.route('/check-node-details')
    .post(checkNodeDetails);

module.exports = router;