const express = require('express');
const router = express.Router();
const clientAPIController = require('../../CGPU/ClientAPI-Gateway/controllerV1');


router.route('/Job-inference')
    .post(clientAPIController.submitJob);

module.exports = router;