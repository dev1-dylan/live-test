// Environment setup for Jest tests
import dotenv from "dotenv";
import path from "path";

// Load test environment variables
dotenv.config({ path: ".env.test" });

// Set default test environment variables if not set
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.RTMP_PORT = process.env.RTMP_PORT || "1935";
process.env.HTTP_PORT = process.env.HTTP_PORT || "8002";
process.env.FASTIFY_PORT = process.env.FASTIFY_PORT || "8888";
process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || "local";
process.env.LOCAL_TEMP_PATH =
  process.env.LOCAL_TEMP_PATH || "./temp_media_test";
process.env.SERVER_API_URL =
  process.env.SERVER_API_URL || "http://localhost:3000";

// Mock environment for testing
global.process = {
  ...process,
  env: {
    ...process.env,
    NODE_ENV: "test",
  },
} as NodeJS.Process;
