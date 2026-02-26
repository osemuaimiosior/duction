const express = require('express');
const router = express.Router();
const serverNodeController = require('../controllers/serverNodeController');


router.route('/createNewNamespace/:NAME_SPACE')
    .get(serverNodeController.createNewNamespace);

module.exports = router;