const express = require('express');
const router = express.Router();
const {newJob} = require('../controllers/controlPlane/apiGateway/task');
const {sendResultToQueue} = require('../controllers/controlPlane/queueServerAPI/serverAPI');
const authenticateClient = require('../middleware/auth');
const rateLimiter = require('../middleware/rateLimiter');


router.route('/new-job')
    .post(authenticateClient, rateLimiter, newJob);

router.route('/job/result')
    .post(authenticateClient, rateLimiter, sendResultToQueue);

module.exports = router;