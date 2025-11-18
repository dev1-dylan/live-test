import { BaseStorage, IStorageMetadata, IStorageResult } from "./base-storage";
import AWS from "aws-sdk";
import fs from "fs-extra";
import path from "path";
import { logger } from "../utils/logger";

export class S3Storage extends BaseStorage {
  private s3: AWS.S3;
  private bucketName: string;
  private recordingsPrefix: string;
  private cloudFrontDomain?: string;

  constructor() {
    super();

    this.s3 = new AWS.S3({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION || "ap-southeast-1",
    });

    this.bucketName = process.env.S3_BUCKET_NAME || "livestream-recordings";
    this.recordingsPrefix = process.env.S3_RECORDINGS_PREFIX || "recordings/";
    this.cloudFrontDomain = process.env.CLOUDFRONT_DOMAIN;

    this.verifyConnection();
  }

  private async verifyConnection(): Promise<void> {
    try {
      await this.s3.headBucket({ Bucket: this.bucketName }).promise();
      logger.info(`S3 connection verified: ${this.bucketName}`);
    } catch (error) {
      logger.error("S3 connection failed:", error);
      throw new Error(`S3 connection failed: ${error.message}`);
    }
  }

  async saveRecording(
    tempFilePath: string,
    streamKey: string,
    metadata: Partial<IStorageMetadata>
  ): Promise<IStorageResult> {
    try {
      if (!(await fs.pathExists(tempFilePath))) {
        throw new Error(`Temp file not found: ${tempFilePath}`);
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const fileName = `${streamKey}_${timestamp}.flv`;
      const s3Key = `${this.recordingsPrefix}${streamKey}/${fileName}`;

      const stats = await fs.stat(tempFilePath);
      const fileStream = fs.createReadStream(tempFilePath);

      const uploadParams: AWS.S3.PutObjectRequest = {
        Bucket: this.bucketName,
        Key: s3Key,
        Body: fileStream,
        ContentType: "video/x-flv",
        Metadata: {
          streamKey,
          originalFileName: fileName,
          uploadTime: new Date().toISOString(),
          fileSize: stats.size.toString(),
          ...Object.fromEntries(
            Object.entries(metadata).map(([key, value]) => [
              key,
              typeof value === "string" ? value : JSON.stringify(value),
            ])
          ),
        },
        StorageClass: "STANDARD_IA",
        ServerSideEncryption: "AES256",
      };

      const uploadResult = await this.s3.upload(uploadParams).promise();

      // Delete temp file after successful upload
      await fs.remove(tempFilePath);

      const url = this.cloudFrontDomain
        ? `https://${this.cloudFrontDomain}/${s3Key}`
        : uploadResult.Location;

      const result: IStorageResult = {
        success: true,
        filePath: s3Key,
        url,
        metadata: {
          streamKey,
          fileName,
          fileSize: stats.size,
          uploadTime: new Date(),
          ...metadata,
        },
      };

      logger.info(`Recording uploaded to S3: ${s3Key}`);
      return result;
    } catch (error) {
      logger.error(`Failed to upload recording to S3:`, error);
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

  async getRecordingUrl(
    s3Key: string,
    expiresIn: number = 3600
  ): Promise<string> {
    try {
      if (this.cloudFrontDomain) {
        return `https://${this.cloudFrontDomain}/${s3Key}`;
      }

      const params = {
        Bucket: this.bucketName,
        Key: s3Key,
        Expires: expiresIn,
      };

      return await this.s3.getSignedUrlPromise("getObject", params);
    } catch (error) {
      logger.error(`Failed to get recording URL: ${s3Key}`, error);
      throw error;
    }
  }

  async deleteRecording(s3Key: string): Promise<boolean> {
    try {
      await this.s3
        .deleteObject({
          Bucket: this.bucketName,
          Key: s3Key,
        })
        .promise();

      logger.info(`Recording deleted from S3: ${s3Key}`);
      return true;
    } catch (error) {
      logger.error(`Failed to delete recording from S3: ${s3Key}`, error);
      return false;
    }
  }

  async listRecordings(streamKey?: string): Promise<IStorageMetadata[]> {
    try {
      const prefix = streamKey
        ? `${this.recordingsPrefix}${streamKey}/`
        : this.recordingsPrefix;

      const params: AWS.S3.ListObjectsV2Request = {
        Bucket: this.bucketName,
        Prefix: prefix,
        MaxKeys: 1000,
      };

      const data = await this.s3.listObjectsV2(params).promise();
      const recordings: IStorageMetadata[] = [];

      for (const object of data.Contents || []) {
        if (object.Key && object.Key.endsWith(".flv")) {
          const headResult = await this.s3
            .headObject({
              Bucket: this.bucketName,
              Key: object.Key,
            })
            .promise();

          recordings.push({
            streamKey: headResult.Metadata?.streamkey || "unknown",
            fileName: path.basename(object.Key),
            fileSize: object.Size || 0,
            uploadTime: object.LastModified || new Date(),
            quality: headResult.Metadata?.quality,
            duration: headResult.Metadata?.duration
              ? parseInt(headResult.Metadata.duration)
              : undefined,
          });
        }
      }

      return recordings.sort(
        (a, b) => b.uploadTime.getTime() - a.uploadTime.getTime()
      );
    } catch (error) {
      logger.error("Failed to list recordings from S3:", error);
      return [];
    }
  }

  async getStorageInfo(): Promise<{ used: number; available: number }> {
    try {
      const params: AWS.S3.ListObjectsV2Request = {
        Bucket: this.bucketName,
        Prefix: this.recordingsPrefix,
      };

      let used = 0;
      let continuationToken: string | undefined;

      do {
        if (continuationToken) {
          params.ContinuationToken = continuationToken;
        }

        const data = await this.s3.listObjectsV2(params).promise();

        for (const object of data.Contents || []) {
          used += object.Size || 0;
        }

        continuationToken = data.NextContinuationToken;
      } while (continuationToken);

      const available = Number.MAX_SAFE_INTEGER; // S3 has virtually unlimited storage

      return { used, available };
    } catch (error) {
      logger.error("Failed to get S3 storage info:", error);
      return { used: 0, available: 0 };
    }
  }
}
