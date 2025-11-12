import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import {
  AccessToken,
  IngressClient,
  IngressInput,
  RoomServiceClient,
} from "livekit-server-sdk";
import { Request, Response } from "express";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const LIVEKIT_API_URL = process.env.LIVEKIT_API_URL!;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY!;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET!;
const LIVEKIT_WS_URL = process.env.LIVEKIT_WS_URL!;

const ingressClient = new IngressClient(LIVEKIT_API_URL);
const roomClient = new RoomServiceClient(
  LIVEKIT_API_URL,
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET
);

// Utility: random string
function randomRoomId() {
  return Math.random().toString(36).substring(2, 10);
}

// Create WHIP ingress
app.post("/api/ingress/create", async (req: Request, res: Response) => {
  try {
    const identity = req.body.identity || "whip_publisher";
    const roomName = randomRoomId();

    await roomClient.createRoom({
      name: roomName,
      metadata: JSON.stringify({ creator_identity: identity }),
    });

    const ingress = await ingressClient.createIngress(IngressInput.WHIP_INPUT, {
      name: roomName,
      roomName,
      participantName: identity,
      participantIdentity: identity,
      bypassTranscoding: true,
    });

    // viewer token
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity,
    });
    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: false,
      canSubscribe: true,
    });

    res.json({
      room: roomName,
      ingress,
      viewer_connection: {
        ws_url: LIVEKIT_WS_URL,
        token: at.toJwt(),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/ingress/create-rtmp", async (req: Request, res: Response) => {
  try {
    const identity = req.body.identity || "rtmp_publisher";
    const roomName = randomRoomId();

    await roomClient.createRoom({
      name: roomName,
      metadata: JSON.stringify({ creator_identity: identity }),
    });

    const ingress = await ingressClient.createIngress(IngressInput.RTMP_INPUT, {
      name: roomName,
      roomName,
      participantName: identity,
      participantIdentity: identity,
      bypassTranscoding: true,
    });

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity,
    });
    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: false,
      canSubscribe: true,
    });

    res.json({
      room: roomName,
      ingress,
      rtmp_url: ingress.url, // full RTMP ingest URL
      viewer_connection: {
        ws_url: LIVEKIT_WS_URL,
        token: at.toJwt(),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: (err as Error).message });
  }
});

app.listen(3000, () => {
  console.log("✅ Backend ready at http://localhost:3000");
});
