# RTMP Server với Lưu Trữ Đa Môi Trường

## Tổng Quan

RTMP Server hỗ trợ lưu trữ live stream recordings với hai chế độ:
- **Development/Local**: Lưu trữ file trên local file system
- **Production**: Tự động upload lên AWS S3 với CDN delivery

## Installation và Setup

### 1. Dependencies

```bash
npm install node-media-server aws-sdk dotenv fs-extra path uuid winston
npm install -D @types/node typescript ts-node nodemon @types/uuid rimraf eslint
```

### 2. Environment Configuration

#### `.env.development`
```bash
NODE_ENV=development
RTMP_PORT=1935
HTTP_PORT=8002

# Local Storage
STORAGE_TYPE=local
LOCAL_MEDIA_ROOT=./media
LOCAL_RECORDINGS_PATH=./media/recordings
LOCAL_TEMP_PATH=./media/temp

# MongoDB Connection (for metadata)
MONGODB_URI=mongodb://localhost:27017/livestream_dev

# Logging
LOG_LEVEL=debug
LOG_TO_FILE=true
```

#### `.env.production`
```bash
NODE_ENV=production
RTMP_PORT=1935
HTTP_PORT=8002

# AWS S3 Storage
STORAGE_TYPE=s3
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=ap-southeast-1
S3_BUCKET_NAME=livestream-recordings-prod
S3_RECORDINGS_PREFIX=recordings/
S3_TEMP_PREFIX=temp/

# CloudFront CDN
CLOUDFRONT_DOMAIN=d1234567890.cloudfront.net
CLOUDFRONT_DISTRIBUTION_ID=E1234567890

# Local temp storage (for processing before upload)
LOCAL_TEMP_PATH=./temp_media
MAX_LOCAL_STORAGE_GB=10

# MongoDB Connection
MONGODB_URI=mongodb://your-mongo-cluster/livestream_prod

# Logging
LOG_LEVEL=info
LOG_TO_FILE=true
LOG_TO_S3=true
```

### 3. AWS S3 Setup

#### S3 Bucket Configuration
```bash
# Create S3 bucket
aws s3 mb s3://livestream-recordings-prod --region ap-southeast-1

# Set bucket policy for public read access (optional)
aws s3api put-bucket-policy --bucket livestream-recordings-prod --policy file://bucket-policy.json

# Enable versioning
aws s3api put-bucket-versioning --bucket livestream-recordings-prod --versioning-configuration Status=Enabled

# Set up lifecycle policy
aws s3api put-bucket-lifecycle-configuration --bucket livestream-recordings-prod --lifecycle-configuration file://lifecycle.json
```

#### IAM Policy for S3 Access
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::livestream-recordings-prod",
        "arn:aws:s3:::livestream-recordings-prod/*"
      ]
    }
  ]
}
```

### 4. Core Implementation Files

#### Base Storage Interface
```typescript
// src/storage/base-storage.ts
export interface IStorageMetadata {
  streamKey: string;
  fileName: string;
  fileSize: number;
  duration?: number;
  quality?: string;
  thumbnailPath?: string;
  uploadTime: Date;
}

export interface IStorageResult {
  success: boolean;
  filePath?: string;
  url?: string;
  metadata: IStorageMetadata;
  error?: string;
}

export abstract class BaseStorage {
  abstract saveRecording(
    tempFilePath: string,
    streamKey: string,
    metadata: Partial<IStorageMetadata>
  ): Promise<IStorageResult>;

  abstract getRecordingUrl(identifier: string): Promise<string>;
  abstract deleteRecording(identifier: string): Promise<boolean>;
  abstract listRecordings(streamKey?: string): Promise<IStorageMetadata[]>;
  abstract getStorageInfo(): Promise<{used: number, available: number}>;
}
```

#### Storage Factory Pattern
```typescript
// src/storage/storage-factory.ts
import { BaseStorage } from './base-storage';
import { LocalStorage } from './local-storage';
import { S3Storage } from './s3-storage';
import { logger } from '../utils/logger';

export class StorageFactory {
  static createStorage(): BaseStorage {
    const storageType = process.env.STORAGE_TYPE || 'local';

    switch (storageType.toLowerCase()) {
      case 'local':
        logger.info('Using Local Storage');
        return new LocalStorage();
      
      case 's3':
        logger.info('Using AWS S3 Storage');
        return new S3Storage();
      
      default:
        logger.warn(`Unknown storage type: ${storageType}, defaulting to local`);
        return new LocalStorage();
    }
  }
}
```

#### Local Storage Implementation
```typescript
// src/storage/local-storage.ts
import { BaseStorage, IStorageMetadata, IStorageResult } from './base-storage';
import fs from 'fs-extra';
import path from 'path';
import { logger } from '../utils/logger';

export class LocalStorage extends BaseStorage {
  private recordingsPath: string;
  private tempPath: string;

  constructor() {
    super();
    this.recordingsPath = process.env.LOCAL_RECORDINGS_PATH || './media/recordings';
    this.tempPath = process.env.LOCAL_TEMP_PATH || './media/temp';
    this.initializeDirectories();
  }

  private async initializeDirectories(): Promise<void> {
    try {
      await fs.ensureDir(this.recordingsPath);
      await fs.ensureDir(this.tempPath);
      await fs.ensureDir(path.join(this.recordingsPath, 'thumbnails'));
      logger.info('Local storage directories initialized');
    } catch (error) {
      logger.error('Failed to initialize local storage directories:', error);
      throw error;
    }
  }

  async saveRecording(
    tempFilePath: string,
    streamKey: string,
    metadata: Partial<IStorageMetadata>
  ): Promise<IStorageResult> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `${streamKey}_${timestamp}.flv`;
      const finalPath = path.join(this.recordingsPath, fileName);

      if (!await fs.pathExists(tempFilePath)) {
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
          ...metadata
        }
      };

      logger.info(`Recording saved locally: ${fileName}`);
      return result;

    } catch (error) {
      logger.error(`Failed to save recording locally:`, error);
      return {
        success: false,
        metadata: {
          streamKey,
          fileName: '',
          fileSize: 0,
          uploadTime: new Date()
        },
        error: error.message
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
        if (file.endsWith('.flv')) {
          if (!streamKey || file.startsWith(streamKey)) {
            const filePath = path.join(this.recordingsPath, file);
            const stats = await fs.stat(filePath);
            
            recordings.push({
              streamKey: file.split('_')[0],
              fileName: file,
              fileSize: stats.size,
              uploadTime: stats.birthtime
            });
          }
        }
      }

      return recordings.sort((a, b) => b.uploadTime.getTime() - a.uploadTime.getTime());
    } catch (error) {
      logger.error('Failed to list recordings:', error);
      return [];
    }
  }

  async getStorageInfo(): Promise<{used: number, available: number}> {
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
      logger.error('Failed to get storage info:', error);
      return { used: 0, available: 0 };
    }
  }

  // Cleanup old recordings
  async cleanupOldRecordings(maxAgeHours: number = 24 * 7): Promise<number> {
    try {
      const files = await fs.readdir(this.recordingsPath);
      const cutoffTime = Date.now() - (maxAgeHours * 60 * 60 * 1000);
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
      logger.error('Failed to cleanup old recordings:', error);
      return 0;
    }
  }
}
```

#### AWS S3 Storage Implementation
```typescript
// src/storage/s3-storage.ts
import { BaseStorage, IStorageMetadata, IStorageResult } from './base-storage';
import AWS from 'aws-sdk';
import fs from 'fs-extra';
import path from 'path';
import { logger } from '../utils/logger';

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
      region: process.env.AWS_REGION || 'ap-southeast-1'
    });

    this.bucketName = process.env.S3_BUCKET_NAME || 'livestream-recordings';
    this.recordingsPrefix = process.env.S3_RECORDINGS_PREFIX || 'recordings/';
    this.cloudFrontDomain = process.env.CLOUDFRONT_DOMAIN;

    this.verifyConnection();
  }

  private async verifyConnection(): Promise<void> {
    try {
      await this.s3.headBucket({ Bucket: this.bucketName }).promise();
      logger.info(`S3 connection verified: ${this.bucketName}`);
    } catch (error) {
      logger.error('S3 connection failed:', error);
      throw new Error(`S3 connection failed: ${error.message}`);
    }
  }

  async saveRecording(
    tempFilePath: string,
    streamKey: string,
    metadata: Partial<IStorageMetadata>
  ): Promise<IStorageResult> {
    try {
      if (!await fs.pathExists(tempFilePath)) {
        throw new Error(`Temp file not found: ${tempFilePath}`);
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `${streamKey}_${timestamp}.flv`;
      const s3Key = `${this.recordingsPrefix}${streamKey}/${fileName}`;

      const stats = await fs.stat(tempFilePath);
      const fileStream = fs.createReadStream(tempFilePath);

      const uploadParams: AWS.S3.PutObjectRequest = {
        Bucket: this.bucketName,
        Key: s3Key,
        Body: fileStream,
        ContentType: 'video/x-flv',
        Metadata: {
          streamKey,
          originalFileName: fileName,
          uploadTime: new Date().toISOString(),
          fileSize: stats.size.toString(),
          ...metadata
        },
        StorageClass: 'STANDARD_IA',
        ServerSideEncryption: 'AES256'
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
          ...metadata
        }
      };

      logger.info(`Recording uploaded to S3: ${s3Key}`);
      return result;

    } catch (error) {
      logger.error(`Failed to upload recording to S3:`, error);
      return {
        success: false,
        metadata: {
          streamKey,
          fileName: '',
          fileSize: 0,
          uploadTime: new Date()
        },
        error: error.message
      };
    }
  }

  async getRecordingUrl(s3Key: string, expiresIn: number = 3600): Promise<string> {
    try {
      if (this.cloudFrontDomain) {
        return `https://${this.cloudFrontDomain}/${s3Key}`;
      }

      const params = {
        Bucket: this.bucketName,
        Key: s3Key,
        Expires: expiresIn
      };

      return await this.s3.getSignedUrlPromise('getObject', params);
    } catch (error) {
      logger.error(`Failed to get recording URL: ${s3Key}`, error);
      throw error;
    }
  }

  async deleteRecording(s3Key: string): Promise<boolean> {
    try {
      await this.s3.deleteObject({
        Bucket: this.bucketName,
        Key: s3Key
      }).promise();

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
        MaxKeys: 1000
      };

      const data = await this.s3.listObjectsV2(params).promise();
      const recordings: IStorageMetadata[] = [];

      for (const object of data.Contents || []) {
        if (object.Key && object.Key.endsWith('.flv')) {
          const headResult = await this.s3.headObject({
            Bucket: this.bucketName,
            Key: object.Key
          }).promise();

          recordings.push({
            streamKey: headResult.Metadata?.streamkey || 'unknown',
            fileName: path.basename(object.Key),
            fileSize: object.Size || 0,
            uploadTime: object.LastModified || new Date(),
            quality: headResult.Metadata?.quality,
            duration: headResult.Metadata?.duration ? parseInt(headResult.Metadata.duration) : undefined
          });
        }
      }

      return recordings.sort((a, b) => b.uploadTime.getTime() - a.uploadTime.getTime());
    } catch (error) {
      logger.error('Failed to list recordings from S3:', error);
      return [];
    }
  }

  async getStorageInfo(): Promise<{used: number, available: number}> {
    try {
      const params: AWS.S3.ListObjectsV2Request = {
        Bucket: this.bucketName,
        Prefix: this.recordingsPrefix
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
      logger.error('Failed to get S3 storage info:', error);
      return { used: 0, available: 0 };
    }
  }
}
```

#### Main RTMP Server
```typescript
// src/index.ts
import NodeMediaServer from 'node-media-server';
import { StorageFactory } from './storage/storage-factory';
import { BaseStorage } from './storage/base-storage';
import { logger } from './utils/logger';
import fs from 'fs-extra';
import path from 'path';
import dotenv from 'dotenv';

// Load environment-specific config
dotenv.config({ path: `.env.${process.env.NODE_ENV || 'development'}` });

class RTMPServer {
  private nms: NodeMediaServer;
  private storage: BaseStorage;
  private tempPath: string;

  constructor() {
    this.storage = StorageFactory.createStorage();
    this.tempPath = process.env.LOCAL_TEMP_PATH || './temp_media';
    this.initializeTempDirectory();
    this.setupRTMPServer();
  }

  private async initializeTempDirectory(): Promise<void> {
    try {
      await fs.ensureDir(this.tempPath);
      await fs.ensureDir(path.join(this.tempPath, 'recordings'));
      await fs.ensureDir('logs');
      logger.info(`Temp directory initialized: ${this.tempPath}`);
    } catch (error) {
      logger.error('Failed to initialize temp directory:', error);
      throw error;
    }
  }

  private setupRTMPServer(): void {
    const config = {
      rtmp: {
        port: parseInt(process.env.RTMP_PORT || '1935'),
        chunk_size: 60000,
        gop_cache: true,
        ping: 30,
        ping_timeout: 60
      },
      http: {
        port: parseInt(process.env.HTTP_PORT || '8002'),
        allow_origin: '*',
        mediaroot: this.tempPath
      },
      record: {
        enabled: true,
        path: path.join(this.tempPath, 'recordings'),
        format: 'flv'
      },
      auth: {
        api: true,
        api_user: 'admin',
        api_pass: 'admin'
      }
    };

    this.nms = new NodeMediaServer(config);
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.nms.on('prePublish', async (id: string, StreamPath: string, args: any) => {
      const streamKey = StreamPath.split('/').pop();
      logger.info(`Stream started: ${streamKey}`);
    });

    this.nms.on('donePublish', async (id: string, StreamPath: string, args: any) => {
      const streamKey = StreamPath.split('/').pop();
      logger.info(`Stream ended: ${streamKey}`);
      await this.processRecording(streamKey);
    });
  }

  private async processRecording(streamKey: string): Promise<void> {
    try {
      const recordingFileName = `${streamKey}.flv`;
      const tempFilePath = path.join(this.tempPath, 'recordings', recordingFileName);

      if (!await fs.pathExists(tempFilePath)) {
        logger.warn(`Recording file not found: ${tempFilePath}`);
        return;
      }

      const stats = await fs.stat(tempFilePath);
      const metadata = {
        fileSize: stats.size
      };

      const result = await this.storage.saveRecording(tempFilePath, streamKey, metadata);

      if (result.success) {
        logger.info(`Recording processed successfully: ${streamKey}`);
      } else {
        logger.error(`Failed to process recording: ${streamKey}`, result.error);
      }

    } catch (error) {
      logger.error(`Error processing recording for ${streamKey}:`, error);
    }
  }

  public async start(): Promise<void> {
    try {
      this.nms.run();
      
      logger.info('RTMP Server started successfully', {
        rtmpPort: process.env.RTMP_PORT,
        httpPort: process.env.HTTP_PORT,
        storageType: process.env.STORAGE_TYPE,
        environment: process.env.NODE_ENV
      });

      console.log('====================================');
      console.log('🚀 RTMP Server Started Successfully');
      console.log('====================================');
      console.log(`📺 RTMP URL: rtmp://localhost:${process.env.RTMP_PORT}/live`);
      console.log(`🌐 HTTP Server: http://localhost:${process.env.HTTP_PORT}`);
      console.log(`📊 Admin Panel: http://localhost:${process.env.HTTP_PORT}/admin`);
      console.log(`💾 Storage: ${process.env.STORAGE_TYPE?.toUpperCase()}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV?.toUpperCase()}`);
      console.log('====================================');

    } catch (error) {
      logger.error('Failed to start RTMP server:', error);
      throw error;
    }
  }

  public async stop(): Promise<void> {
    try {
      this.nms.stop();
      logger.info('RTMP Server stopped');
    } catch (error) {
      logger.error('Failed to stop RTMP server:', error);
    }
  }
}

// Start server
const server = new RTMPServer();

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  await server.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  await server.stop();
  process.exit(0);
});

server.start().catch((error) => {
  logger.error('Failed to start server:', error);
  process.exit(1);
});
```

#### Logger Utility
```typescript
// src/utils/logger.ts
import winston from 'winston';
import path from 'path';

const logLevel = process.env.LOG_LEVEL || 'info';
const logToFile = process.env.LOG_TO_FILE === 'true';

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp(),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''}`;
      })
    )
  })
];

if (logToFile) {
  transports.push(
    new winston.transports.File({
      filename: path.join('logs', 'error.log'),
      level: 'error',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    }),
    new winston.transports.File({
      filename: path.join('logs', 'combined.log'),
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    })
  );
}

export const logger = winston.createLogger({
  level: logLevel,
  transports
});
```

## Package.json Scripts

```json
{
  "name": "rtmp-server",
  "version": "1.0.0",
  "description": "RTMP Server with multi-environment storage support",
  "main": "dist/index.js",
  "scripts": {
    "dev": "NODE_ENV=development nodemon src/index.ts",
    "dev:local": "NODE_ENV=development STORAGE_TYPE=local nodemon src/index.ts",
    "dev:s3": "NODE_ENV=development STORAGE_TYPE=s3 nodemon src/index.ts",
    "build": "tsc",
    "start": "NODE_ENV=production node dist/index.js",
    "start:local": "NODE_ENV=production STORAGE_TYPE=local node dist/index.js",
    "start:s3": "NODE_ENV=production STORAGE_TYPE=s3 node dist/index.js",
    "test": "jest",
    "lint": "eslint src/**/*.ts",
    "clean": "rimraf dist",
    "logs": "tail -f logs/combined.log",
    "setup": "npm install && npm run build"
  },
  "dependencies": {
    "node-media-server": "2.6.6",
    "aws-sdk": "^2.1490.0",
    "dotenv": "^16.3.1",
    "fs-extra": "^11.1.1",
    "uuid": "^9.0.1",
    "winston": "^3.11.0"
  },
  "devDependencies": {
    "@types/node": "^20.8.7",
    "@types/uuid": "^9.0.6",
    "nodemon": "^3.0.1",
    "rimraf": "^5.0.5",
    "ts-node": "^10.9.1",
    "typescript": "^5.2.2",
    "eslint": "^8.52.0"
  }
}
```

## Usage Instructions

### Quick Start - Development

```bash
# Clone và setup
git clone <repository>
cd rtmp-server

# Install dependencies
npm install

# Copy environment file
cp .env.example .env.development

# Start development server (local storage)
npm run dev

# OBS Settings:
# Server: rtmp://localhost:1935/live
# Stream Key: any_string (e.g., "test123")
```

### Development Mode Commands

```bash
# Local storage (default)
npm run dev
npm run dev:local

# Test S3 trong development
npm run dev:s3
```

### Production Deployment

```bash
# Setup production environment
cp .env.example .env.production
# Edit .env.production với AWS credentials

# Build và start
npm run build
npm run start:s3

# Hoặc với Docker
docker build -t rtmp-server .
docker run -d --env-file .env.production -p 1935:1935 -p 8002:8002 rtmp-server
```

### Environment Switching

```bash
# Development với local storage
NODE_ENV=development STORAGE_TYPE=local npm start

# Development với S3 testing
NODE_ENV=development STORAGE_TYPE=s3 npm start

# Production với S3
NODE_ENV=production STORAGE_TYPE=s3 npm start

# Production với local fallback
NODE_ENV=production STORAGE_TYPE=local npm start
```

## Testing và Monitoring

### Stream Testing

```bash
# Test với FFmpeg
ffmpeg -re -i test.mp4 -c copy -f flv rtmp://localhost:1935/live/test123

# Test với OBS Studio
# Server: rtmp://localhost:1935/live
# Stream Key: test123
```

### API Endpoints

```bash
# Get server info
GET http://localhost:8002/api/server

# List recordings
GET http://localhost:8002/api/recordings

# Get storage info
GET http://localhost:8002/api/storage/info

# Admin panel
http://localhost:8002/admin
```

### Log Monitoring

```bash
# Real-time logs
npm run logs

# Error logs only
tail -f logs/error.log

# All logs
tail -f logs/combined.log
```

## AWS S3 Cost Optimization

### Lifecycle Policy Example

```json
{
  "Rules": [
    {
      "ID": "StreamRecordingsLifecycle",
      "Status": "Enabled",
      "Filter": {
        "Prefix": "recordings/"
      },
      "Transitions": [
        {
          "Days": 30,
          "StorageClass": "STANDARD_IA"
        },
        {
          "Days": 90,
          "StorageClass": "GLACIER"
        },
        {
          "Days": 365,
          "StorageClass": "DEEP_ARCHIVE"
        }
      ]
    }
  ]
}
```

### CloudFront Distribution Setup

```bash
# Create CloudFront distribution
aws cloudfront create-distribution --distribution-config file://cloudfront-config.json

# Invalidate cache when needed
aws cloudfront create-invalidation --distribution-id E1234567890 --paths "/*"
```

## Troubleshooting

### Common Issues

**1. S3 Connection Failed**
```bash
# Check AWS credentials
aws sts get-caller-identity

# Check bucket permissions
aws s3api head-bucket --bucket your-bucket-name
```

**2. Local Storage Permission Issues**
```bash
# Fix directory permissions
chmod -R 755 ./media
chown -R $USER:$USER ./media
```

**3. RTMP Connection Issues**
```bash
# Check if port is available
netstat -an | grep 1935

# Test RTMP server
telnet localhost 1935
```

**4. High Storage Costs**
- Enable S3 Intelligent Tiering
- Implement proper lifecycle policies  
- Monitor transfer costs with CloudFront
- Consider Cloudflare R2 for high-traffic

### Performance Optimization

**Local Storage:**
- Use SSD for better I/O performance
- Implement proper cleanup schedules
- Monitor disk space usage

**S3 Storage:**
- Use S3 Transfer Acceleration
- Enable multipart uploads for large files
- Implement proper retry logic
- Use CloudFront for global delivery

## Security Best Practices

### Authentication

```typescript
// Implement stream key validation
const authenticateStream = async (streamKey: string): Promise<boolean> => {
  // Check against database
  // Validate JWT token
  // Check user permissions
  return true;
};
```

### S3 Security

```bash
# Enable bucket encryption
aws s3api put-bucket-encryption --bucket your-bucket --server-side-encryption-configuration '{
  "Rules": [{
    "ApplyServerSideEncryptionByDefault": {
      "SSEAlgorithm": "AES256"
    }
  }]
}'

# Block public access
aws s3api put-public-access-block --bucket your-bucket --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

## Production Checklist

- [ ] AWS credentials properly configured
- [ ] S3 bucket created với appropriate permissions
- [ ] CloudFront distribution setup
- [ ] Environment variables set
- [ ] Logging configured
- [ ] Monitoring setup (CloudWatch)
- [ ] Backup strategy implemented
- [ ] Security policies applied
- [ ] Cost optimization enabled
- [ ] Health checks configured

Hệ thống này cung cấp flexibility hoàn chỉnh cho development team sử dụng local storage trong khi production sử dụng AWS S3 với tất cả tính năng optimization và cost management.