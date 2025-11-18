import { logger } from "./utils/logger";
import RTMPServer from "./server";

// Start server
const server = new RTMPServer();

process.on("SIGINT", async () => {
  logger.info("Received SIGINT, shutting down gracefully...");
  await server.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("Received SIGTERM, shutting down gracefully...");
  await server.stop();
  process.exit(0);
});

server.start().catch((error) => {
  logger.error("Failed to start server:", error);
  process.exit(1);
});
