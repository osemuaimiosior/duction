const express = require('express');
const router = express.Router();
const {newInferenceJob} = require('../controllers/controlPlane/inferenceController');
const authenticateClient = require('../middleware/auth');
const rateLimiter = require('../middleware/rateLimiter');


router.route('/new-inference-job')
    .get(authenticateClient, rateLimiter, newInferenceJob);

module.exports = router;