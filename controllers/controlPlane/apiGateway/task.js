// Import the database model used to store simulation jobs. This table keeps track of jobs submitted by clients

const  newJobModel  = require("../../../config/model/newJob");

// Import the scheduler responsible for distributing jobs across compute nodes in the network

const {scheduleJob} = require("../schedulerNode/index");

/**
 * API Controller: Create a new simulation job
 *
 * This endpoint is called when a client wants to run a simulation (example: Monte Carlo simulation).
 *
 * The function performs the following steps:
 *
 * 1. Validate the request payload
 * 2. Ensure the requested number of runs meets minimum accuracy requirements
 * 3. Store the job in the database
 * 4. Send the job to the distributed scheduler
 * 5. Return the job ID to the client
 */

const newJob = async (req, res) => {
  try {

    // Extract simulation parameters from the client request body
    const { MODEL_TYPE, SIMULATION_TYPE, RUNS, INPUT_DATA } = req.body;

    // Minimum number of runs required for statistical accuracy
    // Example: Monte Carlo simulations need large sample sizes
    const minRuns = process.env.MIN_RUN_SIMULATION || 10000000;


     /**
     * Step 1 — Validate Required Inputs
     *
     * We ensure all required fields are provided, if any required parameter is missing we return an error immediately.
     */

    if (!MODEL_TYPE || !INPUT_DATA || !SIMULATION_TYPE || !RUNS) {
      return res.status(400).json({
        success: false,
        message: "MODEL_TYPE, SIMULATION_TYPE, RUNS and INPUT_DATA are required"
      });
    };


    /**
     * Step 2 — Enforce Minimum Simulation Runs
     *
     * To maintain simulation accuracy and reduce statistical error, we enforce a minimum number of simulation runs.
     *
     * Example: Monte Carlo simulations with very small runs produce unreliable results.
     */

    if(RUNS < minRuns){
      return res.status(400).json({
        success: false,
        message: `For better accuracy and lower error of the model, runs should be ${minRuns} runs or more that ${minRuns} runs`
      });
    };

    /**
     * Step 3 — Persist the Job in the Database
     *
     * Once validation passes, we store the job in the database.
     *
     * This allows us to:
     * - track job status
     * - store input parameters
     * - associate the job with the client
     * - allow result retrieval later
     */

    const job = await newJobModel.create({
      // The model being executed. Example: "risk_model_v3"
      modelType: MODEL_TYPE, //example: risk_model_v3

       // Input parameters required for the simulation
      inputData: INPUT_DATA,

       // Identify which client submitted the job
      clientId: req.client.id,

      // Type of simulation engine. Example: "monte_carlo"
      simulationType: SIMULATION_TYPE,  //example: monte_carlo

      // Initial job status. Job starts in "queued" state until scheduler assigns it
      status: "queued"
    });

    /**
     * Step 4 — Send Job to Scheduler
     *
     * The scheduler distributes the simulation across compute nodes.
     *
     * The scheduler may:
     * - split the job into smaller tasks
     * - distribute tasks across GPUs/CPUs
     * - assign tasks to available nodes
     * - manage load balancing
     */

    const jobID = job.id;

    await scheduleJob(MODEL_TYPE, jobID, INPUT_DATA, minRuns, SIMULATION_TYPE);
    
    return res.status(201).json({
      success: true,

      // Unique job identifier
      jobId: jobID,

      // Current job status
      status: job.status
    });    

  } catch (error) {

    /**
     * Step 6 — Error Handling
     *
     * Any unexpected errors during job creation are caught and logged.
     */

    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};

// Export controller so it can be used in route definitions
module.exports = {
  newJob
};