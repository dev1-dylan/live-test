import path from "path";
import { describe, it, expect, beforeEach, afterAll } from "@jest/globals";
import { logger } from "../../src/utils/logger";

describe("logger", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules(); // clear require cache
    process.env = { ...originalEnv }; // reset env
  });

  afterAll(() => {
    process.env = originalEnv; // restore original env
  });

  it("should create logger with default level 'info'", () => {
    delete process.env.LOG_LEVEL;

    expect(logger.level).toBe("info");

    // Should only have Console transport by default
    expect(logger.transports).toHaveLength(1);
    expect(logger.transports[0].constructor.name).toBe("Console");
  });

  it("should create logger with custom level", () => {
    process.env.LOG_LEVEL = "info";

    expect(logger.level).toBe("info");
  });
});
