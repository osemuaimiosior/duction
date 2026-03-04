const osu = require("node-os-utils");
const mem = require("node-os-utils").mem //RAM Monitoring

setInterval(async () => {
  const cpu = await osu.cpu.usage()
  console.log(cpu)
}, 5000)


setInterval(async () => {
  const info = await mem.info()
  console.log(info)
}, 5000)


//Docker container monitoring tool: cAdvisor, Prometheus etc