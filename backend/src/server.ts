import express, { Response } from "express";
import http from "http";
import { Server } from "socket.io";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

import authRoutes, { AVATAR_DIR } from "./routes/auth";
import roomRoutes, { MEDIA_DIR } from "./routes/rooms";
import aiRoutes from "./routes/ai";
import { registerSocketHandlers, ChatServer } from "./socket";
import { rateLimit } from "./middleware/rateLimit";

const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/chat-app";

const app = express();

// Trust the hosting proxy (Render/Railway/etc.) so req.protocol is "https"
// and req.ip is the real client — needed for correct upload URLs + rate limiting.
app.set("trust proxy", 1);

app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(express.json());

// General abuse protection: cap total API requests per IP
app.use("/api", rateLimit({ windowMs: 60 * 1000, max: 300 }));

// Serve uploaded files (cross-origin so the frontend <img>/download can load them)
const staticOpts = {
  setHeaders: (res: Response) => res.set("Access-Control-Allow-Origin", "*"),
};
app.use("/uploads/avatars", express.static(AVATAR_DIR, staticOpts));
app.use("/uploads/media", express.static(MEDIA_DIR, staticOpts));

app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    message: "Chat backend is running",
    database:
      mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/ai", aiRoutes);

const server = http.createServer(app);

const io: ChatServer = new Server(server, {
  cors: {
    origin: CLIENT_URL,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

registerSocketHandlers(io);

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

mongoose
  .connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err: Error) =>
    console.error("MongoDB connection failed (server still running):", err.message)
  );
