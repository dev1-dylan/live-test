import NodeMediaServer from "node-media-server";
import { StorageFactory } from "./storage/storage-factory";
import { BaseStorage } from "./storage/base-storage";
import { logger } from "./utils/logger";
import fs from "fs-extra";
import dotenv from "dotenv";
import path from "node:path";

// Load environment-specific config
dotenv.config({ path: `.env.${process.env.NODE_ENV || "development"}` });

export default class RTMPServer {
  private nms: NodeMediaServer;
  private storage: BaseStorage;
  private tempPath: string;
  private sessionMap = new Map<string, string>();

  constructor() {
    this.storage = StorageFactory.createStorage();
    this.tempPath = process.env.LOCAL_TEMP_PATH || "./temp_media";
    this.initializeTempDirectory();
    this.setupRTMPServer();
  }

  private async initializeTempDirectory(): Promise<void> {
    try {
      await fs.ensureDir(this.tempPath);
      await fs.ensureDir(path.join(this.tempPath, "recordings"));
      await fs.ensureDir("logs");
      logger.info(`Temp directory initialized: ${this.tempPath}`);
    } catch (error) {
      logger.error("Failed to initialize temp directory:", error);
      throw error;
    }
  }

  private setupRTMPServer(): void {
    const config = {
      rtmp: {
        port: parseInt(process.env.RTMP_PORT || "1935"),
        chunk_size: 60000,
        gop_cache: true,
        ping: 30,
        ping_timeout: 60,
      },
      http: {
        port: parseInt(process.env.HTTP_PORT || "8002"),
        allow_origin: "*",
        mediaroot: this.tempPath,
        ws_flv: true,
      },
      auth: {
        api: true,
        api_user: process.env.API_USER || "admin",
        api_pass: process.env.API_PASS || "admin",
      },
      trans: {
        ffmpeg: process.env.FFMPEG_PATH || "/usr/local/bin/ffmpeg",
        tasks: [
          {
            app: "live",
            hls: true,
            hlsFlags: "[hls_time=2:hls_list_size=3:hls_flags=delete_segments]",
          },
        ],
      },
    };

    this.nms = new NodeMediaServer(config);
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.nms.on("prePublish", async (id: string, StreamPath: string) => {
      const session = this.nms.getSession(id);
      const streamKey = StreamPath.split("/").pop();
      logger.info("[prePublish]", `id=${id} streamKey=${streamKey}`);
      try {
        if (!streamKey) {
          logger.error("❌ StreamKey không hợp lệ, từ chối kết nối.");
          session.reject();
          return;
        }
        this.sessionMap.set(streamKey, id);
      } catch (error) {
        // Nếu lỗi gọi API (500, timeout, v.v.)
        logger.error("❌ Lỗi khi gọi API xác thực:", error.message);
        session.reject();
        return;
      }
    });
    this.nms.on("donePublish", async (id: string, StreamPath: string) => {
      const session = this.nms.getSession(id);
      const streamKey = StreamPath.split("/").pop();
      try {
        this.sessionMap.delete(streamKey);
      } catch (error) {
        logger.error("❌ Lỗi khi xác thực stream:", error.message);
        session.reject();
        this.sessionMap.delete(streamKey);
        return;
      }
    });
  }

  public async start(): Promise<void> {
    try {
      this.nms.run();

      logger.info("RTMP Server started successfully", {
        rtmpPort: process.env.RTMP_PORT,
        httpPort: process.env.HTTP_PORT,
        storageType: process.env.STORAGE_TYPE,
        environment: process.env.NODE_ENV,
      });

      console.log("====================================");
      console.log("🚀 RTMP Server Started Successfully");
      console.log("====================================");
      console.log(
        `📺 RTMP URL: rtmp://localhost:${process.env.RTMP_PORT}/live`
      );
      console.log(`🌐 HTTP Server: http://localhost:${process.env.HTTP_PORT}`);
      console.log(
        `📊 Admin Panel: http://localhost:${process.env.HTTP_PORT}/admin`
      );
      console.log(
        `🌐 Fastify Server: http://localhost:${process.env.FASTIFY_PORT}`
      );
      console.log(`💾 Storage: ${process.env.STORAGE_TYPE?.toUpperCase()}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV?.toUpperCase()}`);
      console.log("====================================");
    } catch (error) {
      logger.error("Failed to start RTMP server:", error);
      throw error;
    }
  }

  public async stop(): Promise<void> {
    try {
      this.nms.stop();
      logger.info("RTMP Server stopped");
    } catch (error) {
      logger.error("Failed to stop RTMP server:", error);
    }
  }
}
