import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import {
  AccessToken,
  IngressClient,
  IngressInput,
  RoomServiceClient,
  EgressClient,
  SegmentedFileOutput,
  TrackCompositeOptions,
  SegmentedFileProtocol,
  StreamProtocol,
} from "livekit-server-sdk";
import { WebhookReceiver } from "livekit-server-sdk";

import { Request, Response } from "express";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const LIVEKIT_API_URL = process.env.LIVEKIT_API_URL!;
console.log("🚀 ~ LIVEKIT_API_URL:", LIVEKIT_API_URL);
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY!;
console.log("🚀 ~ LIVEKIT_API_KEY:", LIVEKIT_API_KEY);
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET!;
console.log("🚀 ~ LIVEKIT_API_SECRET:", LIVEKIT_API_SECRET);
const LIVEKIT_WS_URL = process.env.LIVEKIT_WS_URL!;
console.log("🚀 ~ LIVEKIT_WS_URL:", LIVEKIT_WS_URL);

const ingressClient = new IngressClient(LIVEKIT_API_URL);

const roomClient = new RoomServiceClient(
  LIVEKIT_API_URL,
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET
);
const egressClient = new EgressClient(
  LIVEKIT_WS_URL,
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET
);

function randomRoomId() {
  return Math.random().toString(36).substring(2, 10);
}

// Create WHIP ingress
app.post("/api/ingress/create", async (req: Request, res: Response) => {
  try {
    const identity = req.body.identity || "whip_publisher";
    const roomName = req.body.room_name || randomRoomId();

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

    res.json({
      room: roomName,
      ingress,
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

/* ===========================================================
   ROOM API: CHECK ROOM EXISTS
=========================================================== */
app.post("/api/room/check", async (req: Request, res: Response) => {
  try {
    const { room_name } = req.body;

    if (!room_name) {
      return res.status(400).json({ error: "room_name is required" });
    }

    const rooms = await roomClient.listRooms([room_name]);
    res.json({ exists: rooms.length > 0 });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/* ===========================================================
   ROOM API: GET ROOM INFO
=========================================================== */
app.post("/api/room/info", async (req: Request, res: Response) => {
  try {
    const { room_name } = req.body;

    if (!room_name) {
      return res.status(400).json({ error: "room_name is required" });
    }

    const rooms = await roomClient.listRooms([room_name]);

    if (rooms.length === 0) {
      return res.status(404).json({ exists: false, error: "Room not found" });
    }

    res.json({ exists: true, room: rooms[0] });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/* ===========================================================
   ROOM API: GET PARTICIPANTS
=========================================================== */
app.post("/api/room/participants", async (req: Request, res: Response) => {
  try {
    const { room_name } = req.body;

    if (!room_name) {
      return res.status(400).json({ error: "room_name is required" });
    }

    const participants = await roomClient.listParticipants(room_name);
    res.json({ room_name, participants });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/room/join", async (req: Request, res: Response) => {
  try {
    const { room_name, identity } = req.body;

    if (!room_name || !identity) {
      return res
        .status(400)
        .json({ error: "room_name and identity are required" });
    }

    // check room exists
    const rooms = await roomClient.listRooms([room_name]);
    if (rooms.length === 0) {
      return res.status(404).json({ error: "Room does not exist" });
    }

    // check if identity already exists
    let participantExists = false;

    try {
      const p = await roomClient.getParticipant(room_name, identity);
      if (p) participantExists = true;
    } catch {
      // participant doesn't exist → ok
    }

    if (participantExists) {
      return res.status(409).json({ error: "Participant already exists" });
    }

    // create viewer token
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity,
    });

    at.addGrant({
      room: room_name,
      roomJoin: true,
      canPublish: false,
      canSubscribe: true,
      canPublishData: true,
    });

    res.json({
      room_name,
      identity,
      ws_url: LIVEKIT_WS_URL,
      token: await at.toJwt(),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: (err as Error).message });
  }
});

const receiver = new WebhookReceiver(LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
// Map để lưu egressId theo room
const activeEgressMap = new Map<string, string>();

app.post(
  "/api/livekit/webhook",
  express.raw({ type: "application/webhook+json" }),
  async (req, res) => {
    try {
      const auth = req.get("Authorization") || "";
      const event = await receiver.receive(req.body, auth);

      console.log("Webhook event:", event.event);

      if (event.event === "track_published") {
        const roomName = event.room?.name;
        const track = event.track;

        if (!roomName || !track) {
          console.log("⚠️ track_published but missing room/track");
          return res.json({ ok: true });
        }

        // 0 = AUDIO, 1 = VIDEO
        if (track.type === 0) {
          console.log("Audio track published, skip...");
          return res.json({ ok: true });
        }

        if (track.type !== 1) {
          console.log("Non-video track, ignore");
          return res.json({ ok: true });
        }

        const videoTrackId = track.sid;

        // Already started for this room
        if (activeEgressMap.has(roomName)) {
          console.log("HLS already running for room:", roomName);
          return res.json({ ok: true });
        }

        console.log("🎯 Starting HLS Egress for room:", roomName);

        // Đợi LiveKit sync participant + tracks
        await new Promise((resolve) => setTimeout(resolve, 1200));

        let participants = await roomClient.listParticipants(roomName);

        if (participants.length === 0) {
          console.log("No participants yet, retrying...");
          await new Promise((resolve) => setTimeout(resolve, 1000));
          participants = await roomClient.listParticipants(roomName);
        }

        if (participants.length === 0) {
          console.log("No publisher. Abort HLS start.");
          return res.json({ ok: true });
        }

        const pub = participants[0];
        console.log("Publisher:", pub.identity);

        const audioTrack = pub.tracks.find((t) => t.type === 0); // AUDIO
        const audioTrackId = audioTrack?.sid;

        if (!videoTrackId || !audioTrackId) {
          console.log("❌ Missing tracks:", { videoTrackId, audioTrackId });
          return res.json({ ok: true });
        }

        console.log("🎬 Tracks:", { videoTrackId, audioTrackId });

        const prefixBase = "tmp";

        const output = {
          // segments: {
          //   filenamePrefix: `${prefixBase}/${roomName}/${Date.now()}-segment`,
          //   playlistName: "index.m3u8",
          //   livePlaylistName: "index-live.m3u8",
          //   protocol: SegmentedFileProtocol.HLS_PROTOCOL,
          //   segmentDuration: 4,
          //   output: {
          //     case: "s3",
          //   },
          // },
          stream: {
            protocol: StreamProtocol.RTMP,
            urls: [`rtmp://localhost:1936/live/${roomName}`],
          },
        };

        try {
          const result = await egressClient.startTrackCompositeEgress(
            roomName,
            output,
            {
              audioTrackId,
              videoTrackId,
            }
          );
          console.log("🚀 HLS Egress Started:", result.egressId);
          activeEgressMap.set(roomName, result.egressId!);
        } catch (err) {
          console.error("❌ Failed to start HLS egress:", err);
        }
      }

      if (event.event === "ingress_ended") {
        const roomName = event.ingressInfo?.roomName || event.ingressInfo?.name;

        if (!roomName) {
          console.log("⚠️ ingress_ended but NO roomName");
          return res.json({ ok: true });
        }

        const egressId = activeEgressMap.get(roomName);
        if (!egressId) {
          console.log("⚠️ No active egress for room:", roomName);
          return res.json({ ok: true });
        }

        console.log("🛑 Stopping egress:", egressId);

        try {
          await egressClient.stopEgress(egressId);
        } catch (err) {
          console.error("❌ Failed to stop egress:", err);
        }

        activeEgressMap.delete(roomName);
      }

      return res.json({ ok: true });
    } catch (err: any) {
      console.error("❌ Webhook error:", err.message);
      return res.status(400).json({ error: err.message });
    }
  }
);

app.listen(3000, () => {
  console.log("✅ Backend ready at http://localhost:3000");
});
