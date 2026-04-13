const { spawn } = require("child_process");

function runTestSimulation(a, b) {
  return new Promise((resolve, reject) => {
    const sim = spawn("./kernel_file");
    let stderrOutput = '';
    let finished = false;

    const cleanup = () => {
      if (sim.stdin) {
        sim.stdin.destroy();
      }
    };

    sim.on('error', (err) => {
      if (!finished) {
        finished = true;
        cleanup();
        reject(err);
      }
    });

    sim.stdin.on('error', (err) => {
      if (!finished) {
        finished = true;
        cleanup();
        reject(new Error(`Simulation stdin error: ${err.message}`));
      }
    });

    sim.stdout.on("data", (data) => {
      const text = data.toString().trim();
      const match = text.match(/[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?/);
      const result = match ? parseFloat(match[0]) : NaN;
      if (!isFinite(result)) {
        if (!finished) {
          finished = true;
          cleanup();
          return reject(new Error(`Invalid result from simulation: ${text}`));
        }
        return;
      }
      if (!finished) {
        finished = true;
        cleanup();
        resolve(result);
      }
    });

    sim.stderr.on("data", (data) => {
      stderrOutput += data.toString();
      console.error("Simulation error:", data.toString());
    });

    sim.on("close", (code) => {
      if (!finished) {
        finished = true;
        cleanup();
        if (code === 0) {
          return reject(new Error("Simulation exited without returning a valid numeric result."));
        }
        reject(new Error(`Simulation exited with code ${code}: ${stderrOutput.trim()}`));
      }
    });

    // Write after event handlers are attached to avoid race with child exit
    sim.stdin.write(`${a} ${b}\n`);
    sim.stdin.end();
  });
}

// Test run
runTestSimulation(5, 7)
  .then((res) => console.log("Simulation result:", res))
  .catch((err) => console.error(err));