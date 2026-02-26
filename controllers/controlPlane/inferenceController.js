const { InferenceJob } = require("../../config/model/InferenceJob");

const newInferenceJob = async (req, res) => {
  try {
    const { MODEL_ID, INPUT_DATA } = req.body;

    if (!MODEL_ID || !INPUT_DATA) {
      return res.status(400).json({
        success: false,
        message: "MODEL_ID and INPUT_DATA are required"
      });
    }

    const job = await InferenceJob.create({
      modelId: MODEL_ID,
      inputData: INPUT_DATA,
      clientId: req.client.id,
      status: "queued"
    });

    return res.status(201).json({
      success: true,
      jobId: job.id,
      status: job.status
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};

module.exports = {
  newInferenceJob
};