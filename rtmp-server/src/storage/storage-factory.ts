import { BaseStorage } from "./base-storage";
import { LocalStorage } from "./local-storage";
import { S3Storage } from "./s3-storage";
import { logger } from "../utils/logger";

export class StorageFactory {
  static createStorage(): BaseStorage {
    const storageType = process.env.STORAGE_TYPE || "local";

    switch (storageType.toLowerCase()) {
      case "local":
        logger.info("Using Local Storage");
        return new LocalStorage();

      case "s3":
        logger.info("Using AWS S3 Storage");
        return new S3Storage();

      default:
        logger.warn(
          `Unknown storage type: ${storageType}, defaulting to local`
        );
        return new LocalStorage();
    }
  }
}
