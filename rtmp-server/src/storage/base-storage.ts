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
  abstract getStorageInfo(): Promise<{ used: number; available: number }>;
}
