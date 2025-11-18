import { BaseStorage, IStorageMetadata, IStorageResult } from "./base-storage";
import fs from "fs-extra";
import path from "path";
import { logger } from "../utils/logger";

export class LocalStorage extends BaseStorage {
  private recordingsPath: string;
  private tempPath: string;

  constructor() {
    super();
    this.recordingsPath =
      process.env.LOCAL_RECORDINGS_PATH || "./media/recordings";
    this.tempPath = process.env.LOCAL_TEMP_PATH || "./media/temp";
    this.initializeDirectories();
  }

  private async initializeDirectories(): Promise<void> {
    try {
      await fs.ensureDir(this.recordingsPath);
      await fs.ensureDir(this.tempPath);
      await fs.ensureDir(path.join(this.recordingsPath, "thumbnails"));
      logger.info("Local storage directories initialized");
    } catch (error) {
      logger.error("Failed to initialize local storage directories:", error);
      throw error;
    }
  }

  async saveRecording(
    tempFilePath: string,
    streamKey: string,
    metadata: Partial<IStorageMetadata>
  ): Promise<IStorageResult> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const fileName = `${streamKey}_${timestamp}.flv`;
      const finalPath = path.join(this.recordingsPath, fileName);

      if (!(await fs.pathExists(tempFilePath))) {
        throw new Error(`Temp file not found: ${tempFilePath}`);
      }

      await fs.move(tempFilePath, finalPath);
      const stats = await fs.stat(finalPath);

      const result: IStorageResult = {
        success: true,
        filePath: finalPath,
        url: `http://localhost:${process.env.HTTP_PORT}/recordings/${fileName}`,
        metadata: {
          streamKey,
          fileName,
          fileSize: stats.size,
          uploadTime: new Date(),
          ...metadata,
        },
      };

      logger.info(`Recording saved locally: ${fileName}`);
      return result;
    } catch (error) {
      logger.error(`Failed to save recording locally:`, error);
      return {
        success: false,
        metadata: {
          streamKey,
          fileName: "",
          fileSize: 0,
          uploadTime: new Date(),
        },
        error: error.message,
      };
    }
  }

  async getRecordingUrl(fileName: string): Promise<string> {
    const filePath = path.join(this.recordingsPath, fileName);

    if (await fs.pathExists(filePath)) {
      return `http://localhost:${process.env.HTTP_PORT}/recordings/${fileName}`;
    }

    throw new Error(`Recording not found: ${fileName}`);
  }

  async deleteRecording(fileName: string): Promise<boolean> {
    try {
      const filePath = path.join(this.recordingsPath, fileName);

      if (await fs.pathExists(filePath)) {
        await fs.remove(filePath);
        logger.info(`Recording deleted: ${fileName}`);
        return true;
      }

      return false;
    } catch (error) {
      logger.error(`Failed to delete recording ${fileName}:`, error);
      return false;
    }
  }

  async listRecordings(streamKey?: string): Promise<IStorageMetadata[]> {
    try {
      const files = await fs.readdir(this.recordingsPath);
      const recordings: IStorageMetadata[] = [];

      for (const file of files) {
        if (file.endsWith(".flv")) {
          if (!streamKey || file.startsWith(streamKey)) {
            const filePath = path.join(this.recordingsPath, file);
            const stats = await fs.stat(filePath);

            recordings.push({
              streamKey: file.split("_")[0],
              fileName: file,
              fileSize: stats.size,
              uploadTime: stats.birthtime,
            });
          }
        }
      }

      return recordings.sort(
        (a, b) => b.uploadTime.getTime() - a.uploadTime.getTime()
      );
    } catch (error) {
      logger.error("Failed to list recordings:", error);
      return [];
    }
  }

  async getStorageInfo(): Promise<{ used: number; available: number }> {
    try {
      const files = await fs.readdir(this.recordingsPath);
      let used = 0;

      for (const file of files) {
        const stats = await fs.stat(path.join(this.recordingsPath, file));
        used += stats.size;
      }

      const available = 100 * 1024 * 1024 * 1024; // 100GB estimated
      return { used, available };
    } catch (error) {
      logger.error("Failed to get storage info:", error);
      return { used: 0, available: 0 };
    }
  }

  // Cleanup old recordings
  async cleanupOldRecordings(maxAgeHours: number = 24 * 7): Promise<number> {
    try {
      const files = await fs.readdir(this.recordingsPath);
      const cutoffTime = Date.now() - maxAgeHours * 60 * 60 * 1000;
      let deletedCount = 0;

      for (const file of files) {
        const filePath = path.join(this.recordingsPath, file);
        const stats = await fs.stat(filePath);

        if (stats.birthtime.getTime() < cutoffTime) {
          await fs.remove(filePath);
          deletedCount++;
          logger.info(`Cleaned up old recording: ${file}`);
        }
      }

      return deletedCount;
    } catch (error) {
      logger.error("Failed to cleanup old recordings:", error);
      return 0;
    }
  }
}
