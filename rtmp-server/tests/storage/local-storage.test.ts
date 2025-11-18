import fs from "fs-extra";
import path from "path";
import { LocalStorage } from "../../src/storage/local-storage";
import { logger } from "../../src/utils/logger";

jest.mock("fs-extra");
jest.mock("../../src/utils/logger", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
  },
}));

const mockedFs = fs as jest.Mocked<typeof fs>;

describe("LocalStorage", () => {
  let storage: LocalStorage;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.HTTP_PORT = "3000";
    process.env.LOCAL_RECORDINGS_PATH = "./test/recordings";
    process.env.LOCAL_TEMP_PATH = "./test/temp";

    storage = new LocalStorage();
  });

  describe("saveRecording", () => {
    it("should save a recording and return metadata", async () => {
      const tempFilePath = "/temp/video.flv";
      const stats = { size: 1024, birthtime: new Date() };

      mockedFs.pathExists.mockResolvedValue(true);
      mockedFs.move.mockResolvedValue(undefined);
      mockedFs.stat.mockResolvedValue(stats as any);

      const result = await storage.saveRecording(tempFilePath, "abc123", {});

      expect(result.success).toBe(true);
      expect(result.filePath).toContain("abc123");
      expect(result.metadata.streamKey).toBe("abc123");
    });

    it("should handle error if temp file does not exist", async () => {
      mockedFs.pathExists.mockResolvedValue(false);

      const result = await storage.saveRecording(
        "/invalid/path",
        "streamX",
        {}
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Temp file not found/);
    });
  });

  describe("getRecordingUrl", () => {
    it("should return URL if file exists", async () => {
      mockedFs.pathExists.mockResolvedValue(true);
      const url = await storage.getRecordingUrl("abc.flv");
      expect(url).toBe("http://localhost:3000/recordings/abc.flv");
    });

    it("should throw error if file not found", async () => {
      mockedFs.pathExists.mockResolvedValue(false);
      await expect(storage.getRecordingUrl("abc.flv")).rejects.toThrow(
        /Recording not found/
      );
    });
  });

  describe("deleteRecording", () => {
    it("should delete file if it exists", async () => {
      mockedFs.pathExists.mockResolvedValue(true);
      mockedFs.remove.mockResolvedValue(undefined);

      const result = await storage.deleteRecording("abc.flv");
      expect(result).toBe(true);
    });

    it("should return false if file does not exist", async () => {
      mockedFs.pathExists.mockResolvedValue(false);
      const result = await storage.deleteRecording("abc.flv");
      expect(result).toBe(false);
    });
  });

  describe("listRecordings", () => {
    it("should return list of recordings", async () => {
      const files = ["abc123_2021.flv", "other.flv"];
      const stats = { size: 1000, birthtime: new Date() };

      mockedFs.readdir.mockResolvedValue(files);
      mockedFs.stat.mockResolvedValue(stats as any);

      const result = await storage.listRecordings("abc123");
      expect(result).toHaveLength(1);
      expect(result[0].fileName).toContain("abc123");
    });

    it("should handle fs error gracefully", async () => {
      mockedFs.readdir.mockRejectedValue(new Error("fail"));
      const result = await storage.listRecordings();
      expect(result).toEqual([]);
    });
  });

  describe("getStorageInfo", () => {
    it("should return used and available storage", async () => {
      const stats = { size: 2000 };
      mockedFs.readdir.mockResolvedValue(["a.flv", "b.flv"]);
      mockedFs.stat.mockResolvedValue(stats as any);

      const info = await storage.getStorageInfo();
      expect(info.used).toBe(4000);
      expect(info.available).toBe(100 * 1024 * 1024 * 1024);
    });

    it("should return 0s on error", async () => {
      mockedFs.readdir.mockRejectedValue(new Error("fail"));
      const info = await storage.getStorageInfo();
      expect(info.used).toBe(0);
    });
  });

  describe("cleanupOldRecordings", () => {
    it("should remove old recordings", async () => {
      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
      const files = ["old.flv", "new.flv"];

      mockedFs.readdir.mockResolvedValue(files);
      mockedFs.stat.mockResolvedValueOnce({ birthtime: oldDate } as any);
      mockedFs.stat.mockResolvedValueOnce({ birthtime: new Date() } as any);
      mockedFs.remove.mockResolvedValue(undefined);

      const deleted = await storage.cleanupOldRecordings(7 * 24); // 7 days
      expect(deleted).toBe(1);
    });
  });
});
