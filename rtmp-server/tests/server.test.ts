import RTMPServer from "../src/server";
import { logger } from "../src/utils/logger";

// Mock all dependencies
jest.mock("fs-extra", () => ({
  ensureDir: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("dotenv", () => ({
  config: jest.fn(),
}));
jest.mock("../src/utils/logger", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
  },
}));
jest.mock("../src/storage/storage-factory", () => ({
  StorageFactory: {
    createStorage: jest.fn(() => ({
      saveRecording: jest.fn(),
    })),
  },
}));

// Mock node-media-server
const mockRun = jest.fn();
const mockStop = jest.fn();
const mockOn = jest.fn();
const mockGetSession = jest.fn(() => ({
  reject: jest.fn(),
}));

jest.mock("node-media-server", () => {
  return jest.fn().mockImplementation(() => ({
    run: mockRun,
    stop: mockStop,
    on: mockOn,
    getSession: mockGetSession,
  }));
});

// Mock fastify
jest.mock("fastify", () => {
  return jest.fn().mockImplementation(() => ({
    post: jest.fn(),
    listen: jest.fn(
      (opts, cb) => cb && cb(null, `http://localhost:${opts.port}`)
    ),
  }));
});

describe("RTMPServer", () => {
  let server: RTMPServer;

  beforeEach(() => {
    jest.clearAllMocks();

    process.env.RTMP_PORT = "1935";
    process.env.HTTP_PORT = "8002";
    process.env.FASTIFY_PORT = "8888";
    process.env.STORAGE_TYPE = "local";
    process.env.LOCAL_TEMP_PATH = "./temp";
    process.env.NODE_ENV = "test";

    server = new RTMPServer();
  });

  it("should initialize and set up RTMP server", () => {
    expect(logger.info).toHaveBeenCalledWith(
      "Temp directory initialized: ./temp"
    );
    expect(mockOn).toHaveBeenCalled(); // events are bound
  });

  it("should start the server successfully", async () => {
    await server.start();
    expect(mockRun).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "RTMP Server started successfully",
      expect.objectContaining({
        rtmpPort: "1935",
        httpPort: "8002",
        storageType: "local",
        environment: "test",
      })
    );
  });

  it("should stop the server successfully", async () => {
    await server.stop();
    expect(mockStop).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith("RTMP Server stopped");
  });

  it("should log error on start failure", async () => {
    mockRun.mockImplementationOnce(() => {
      throw new Error("start error");
    });

    await expect(server.start()).rejects.toThrow("start error");
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to start RTMP server:",
      expect.any(Error)
    );
  });

  it("should log error on stop failure", async () => {
    mockStop.mockImplementationOnce(() => {
      throw new Error("stop error");
    });

    await server.stop(); // catch and log
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to stop RTMP server:",
      expect.any(Error)
    );
  });
});
