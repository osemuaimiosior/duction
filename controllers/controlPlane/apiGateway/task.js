const  newJob  = require("../../../config/model/newJob");
const {scheduleJob} = require("../schedulerNode/index");

const newJob = async (req, res) => {
  try {
    const { MODEL_TYPE, SIMULATION_TYPE, RUNS, INPUT_DATA } = req.body;
    const minRuns = process.env.MIN_RUN_SIMULATION || 10000000;

    if (!MODEL_TYPE || !INPUT_DATA || !SIMULATION_TYPE || !RUNS) {
      return res.status(400).json({
        success: false,
        message: "MODEL_TYPE, SIMULATION_TYPE, RUNS and INPUT_DATA are required"
      });
    }

    if(RUNS < minRuns){
      return res.status(400).json({
        success: false,
        message: `For better accuracy and lower error of the model, runs should be ${minRuns} runs or more that ${minRuns} runs`
      });
    };

    const job = await newJob.create({
      modelType: MODEL_TYPE, //example: risk_model_v3
      inputData: INPUT_DATA,
      clientId: req.client.id,
      simulationType: SIMULATION_TYPE,  //example: monte_carlo
      status: "queued"
    });

    await scheduleJob(MODEL_TYPE, INPUT_DATA, minRuns, SIMULATION_TYPE);
    
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
  newJob
};