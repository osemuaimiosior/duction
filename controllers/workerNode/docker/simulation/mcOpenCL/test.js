const { spawn } = require("child_process");

function runTestSimulation(a, b) {
  return new Promise((resolve, reject) => {
    const sim = spawn("./mc");

    sim.stdin.write(`${a} ${b}\n`);
    sim.stdin.end();

    sim.stdout.on("data", (data) => {
      const result = parseFloat(data.toString().trim());
      if (!isFinite(result)) return reject(new Error("Invalid result"));
      resolve(result);
    });

    sim.stderr.on("data", (data) => {
      console.error("Simulation error:", data.toString());
    });

    sim.on("close", (code) => {
      if (code !== 0) console.log("Simulation exited with code", code);
    });
  });
}

// Test run
runTestSimulation(5, 7)
  .then((res) => console.log("Simulation result:", res))
  .catch((err) => console.error(err));