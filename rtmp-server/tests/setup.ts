// Jest setup file - runs after test environment is loaded
import { jest, afterEach } from "@jest/globals";

// Global test timeout
jest.setTimeout(10000);

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});

// Global test utilities
declare global {
  var testUtils: {
    createMockSession: () => {
      reject: jest.Mock;
      accept: jest.Mock;
    };
    createMockStream: (streamKey: string) => {
      streamKey: string;
      id: string;
      path: string;
    };
  };
}

global.testUtils = {
  createMockSession: () => ({
    reject: jest.fn(),
    accept: jest.fn(),
  }),

  createMockStream: (streamKey: string) => ({
    streamKey,
    id: "test-session-id",
    path: `/live/${streamKey}`,
  }),
};
