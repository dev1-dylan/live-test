import http from "http";
import os from "os";

// ---------------- CONFIG ---------------- //
const URL = "http://localhost:8002/live/abc.flv";
const MAX_VIEWERS = 200;
const RAMP_STEP = 20;
const RAMP_INTERVAL = 1000;
const TEST_DURATION = 15 * 1000;

let activeViewers = 0;
let conns = [];
let metrics = [];

// ----------- CPU / RAM MONITORING ---------- //
function getStats() {
  const mem = process.memoryUsage();
  const load = os.loadavg();
  const freeMem = os.freemem();
  const totalMem = os.totalmem();

  return {
    rss: (mem.rss / 1024 / 1024).toFixed(2),
    heapUsed: (mem.heapUsed / 1024 / 1024).toFixed(2),
    external: (mem.external / 1024 / 1024).toFixed(2),
    cpuLoad: load.map((v) => v.toFixed(2)),
    freeMem: (freeMem / 1024 / 1024).toFixed(2),
    usedMem: ((totalMem - freeMem) / 1024 / 1024).toFixed(2),
  };
}

function monitor() {
  return setInterval(() => {
    metrics.push({ ts: Date.now(), activeViewers, ...getStats() });
  }, 1000);
}

// ------------- REALISTIC VIEWER ------------- //
function createRealisticViewer(id) {
  const req = http.get(URL, (res) => {
    console.log(`Viewer ${id} connected: ${res.statusCode}`);

    let buffer = Buffer.alloc(0);
    let headerParsed = false;

    res.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      // FLV Header (9 bytes + 4 previousTagSize)
      if (!headerParsed && buffer.length >= 13) {
        headerParsed = true;
        buffer = buffer.slice(13);
        console.log(`Viewer ${id} parsed FLV header`);
      }

      // Parse FLV tags like browser
      while (buffer.length >= 15) {
        const tagType = buffer[0];
        const dataSize = (buffer[1] << 16) | (buffer[2] << 8) | buffer[3];
        const totalTagSize = 11 + dataSize + 4;

        if (buffer.length < totalTagSize) break;

        const tag = buffer.slice(0, totalTagSize);

        // Simulate browser overhead:
        // - I-frame burst
        // - P-frame normal
        if (tagType === 0x09) {
          // video tag
          const frameType = (tag[11] & 0xf0) >> 4;
          if (frameType === 1) {
            // I-frame burst → heavy in browser
            // add jitter
            const jitter = Math.random() * 20;
            Atomics.wait(
              new Int32Array(new SharedArrayBuffer(4)),
              0,
              0,
              jitter
            );
          }
        }

        buffer = buffer.slice(totalTagSize);
      }
    });

    res.on("end", () => {
      console.log(`Viewer ${id} disconnected`);
    });
  });

  req.on("error", (err) => {
    console.log(`Viewer ${id} error: ${err.message}`);
  });

  conns.push(req);
}

// ----------- RAMP-UP -------------- //
async function ramp() {
  while (activeViewers < MAX_VIEWERS) {
    for (let i = 0; i < RAMP_STEP; i++) {
      if (activeViewers >= MAX_VIEWERS) break;
      createRealisticViewer(activeViewers);
      activeViewers++;
    }
    console.log(`RAMP: ${activeViewers}/${MAX_VIEWERS}`);
    await new Promise((r) => setTimeout(r, RAMP_INTERVAL));
  }
}

// -------------- MAIN ---------------- //
(async () => {
  console.log("=== START REALISTIC LOAD TEST ===");

  const monitorID = monitor();

  await ramp();

  await new Promise((r) => setTimeout(r, TEST_DURATION));

  clearInterval(monitorID);

  conns.forEach((c) => c.destroy());

  console.log("\n=== REPORT ===");
  console.table(metrics);
  console.log("\nFinal:", metrics[metrics.length - 1]);

  process.exit(0);
})();
