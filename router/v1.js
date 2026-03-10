const express = require('express');
const router = express.Router();
const {newJob} = require('../controllers/controlPlane/apiGateway/task');
const authenticateClient = require('../middleware/auth');
const rateLimiter = require('../middleware/rateLimiter');


router.route('/new-job')
    .post(authenticateClient, rateLimiter, newJob);

router.route('/job/result/:JOB_ID')
    .post(authenticateClient, rateLimiter, newInferenceJob);

module.exports = router;