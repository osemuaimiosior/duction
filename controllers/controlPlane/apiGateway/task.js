// Import the database model used to store simulation jobs. This table keeps track of jobs submitted by clients

const  newJobModel  = require("../../../config/model/newJob");
const  nodeState  = require("../../../config/model/nodeHeartBeat");
const { Queue, Worker} = require('bullmq');
const queueConnection = require('../../../config/db/queue');

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

    const clinetID = req.client.id;

    const job = await newJobModel.create({
      // The model being executed. Example: "risk_model_v3"
      modelType: MODEL_TYPE, //example: risk_model_v3

       // Input parameters required for the simulation
      inputData: INPUT_DATA,

       // Identify which client submitted the job
      clientId: "23242fff", // example
      // clientId: clinetID,

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

    const feedback = await scheduleJob(MODEL_TYPE, clinetID, jobID, INPUT_DATA, minRuns, SIMULATION_TYPE);
    
    return res.status(201).json({
      success: true,

      // Unique job identifier
      jobId: jobID,

      // Current job status
      status: job.status,

      scheduleJob: feedback.message,

      chunkCount: feedback.chunkCount
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

const checkNodeDetailsCreatNewQueue = async (req, res) => {
  try {

    const queueName = req.body.QUEUE_NAME;
    const nodeDetails = req.body.QUEUE_PAYLOAD;
    const NODEID = req.body.NODE_ID;
    console.log(NODEID)

    const existingNode = await nodeState.findOne({
      where: { nodeId: NODEID }
    });

    if (!existingNode) {

      try {

        await nodeState.create(nodeDetails);

        new Queue(queueName, { connection: queueConnection });

        console.log(`Queue initialized for node: ${queueName}`);

        return res.status(200).json({
          message: "Node registered",
          queue: queueName
        });

      } catch (err) {

        console.error("Failed to initialize Redis queue and register node:", err.message);

        return res.status(500).json({
          error: err.message
        });

      }
      // return res.status(200).json({
      //   result: existingNode,
      //   status: 200
      // });
    }

    return res.status(404).json({
      result: "Node details already exist",
      status: 404
    });

  } catch (error) {

    console.error("Error checking node:", error);

    res.status(500).json({
      message: "Internal server error"
    });

  }
};

const checkNodeDetails = async (req, res) => {
  try {

    const hostName = req.body.HOST_NAME;
    const nodeCode = req.body.NODE_CODE;
    
    const NODEID = `node-${hostName}-${nodeCode}`

    const existingNode = await nodeState.findOne({
      where: { nodeId: NODEID }
    });

    if (existingNode) {

        return res.status(200).json({
          message: "Node registered",
          details: existingNode
        });
    }

    return res.status(404).json({
      result: "No node details",
      status: 404
    });

  } catch (error) {

    console.error("Error checking node:", error);

    res.status(500).json({
      message: "Internal server error"
    });

  }
};

// Export controller so it can be used in route definitions
module.exports = {
  newJob,
  checkNodeDetailsCreatNewQueue,
  checkNodeDetails
};