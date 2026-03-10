const { RedisSMQ } = require("redis-smq");
const { execFile } = require("child_process");

const Channel = process.env.NODE_CODE;
const consumer = RedisSMQ.createConsumer();

async function simulate() {

  consumer.run((err) => {
    if (err) return console.error('Consumer failed:', err);
    
    const handler = (message, done) => {
      console.log('📥 Received:', message.body);
      runSimulation(message.body);
      done(); // Acknowledge
    };
    
    consumer.consume(Channel, handler, (err) => {
      if (err) console.error('Consume failed:', err);
      else console.log(`👂 Listening on ${Channel}...`);
    });
  });
}

async function runSimulation(job) {

  console.log("Running job:", job.modelType);

  // run your simulation here
  const args = [
    job.runs,
  ];

  execFile("./montecarlo_opencl", args, (error, stdout, stderr) => {

    if (error) {
      console.error("Simulation error:", error);
      return;
    }

    console.log("Result:", stdout);
  });

}

simulate();