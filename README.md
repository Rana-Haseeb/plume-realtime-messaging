# Plume — Real-Time Chat Application

> _Conversations, light as a feather._

Plume is a full-stack real-time messaging app: 1-on-1 chats, group chats, public
communities, and WebRTC voice/video calls — all live over Socket.io. It's a
TypeScript monorepo with a **Next.js** frontend and an **Express + Socket.io**
backend backed by **MongoDB**.

## Tech stack

| Layer | Tech |
| --- | --- |
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, socket.io-client |
| Backend | Node.js, Express 5, Socket.io, Mongoose 9, JWT, bcrypt, multer |
| Database | MongoDB (Atlas) |
| Realtime | Socket.io (messaging + presence + call signaling), WebRTC (media) |
| Email | Resend (with a console dev-mode fallback) |

## Features

**Messaging**
- 1-on-1 and group chats, with **message ticks** — single (sent), double-grey (delivered), double-blue (read)
- **Edit & delete** your own messages (live tombstones)
- **Reactions & replies** — emoji reactions and reply-to-message quoting
- **Media messages** — image & file attachments with inline previews / downloads
- Typing indicators, online / last-seen presence
- Paginated history (last 50 + "load earlier"); messages persisted **before** broadcast
- **Search** — within a conversation (with jump-to-match) and globally across chats & messages

**People & groups**
- **Start a DM by username**; create private groups and add members by username
- **Communities** — public, discoverable groups; anyone can request to join and admins approve
- **Admin controls** (groups & communities) — rename, edit description, photo, add/remove members, promote/demote admins, leave

**Calls**
- **1-on-1 voice & video calls** over WebRTC (Socket.io signaling, STUN + TURN), with mute / camera toggles

**Accounts & polish**
- JWT auth with **login by email _or_ username**, persistent sessions, auto-reconnecting socket
- **Password reset & email verification** (Resend, with console dev-mode fallback)
- **Avatar upload**, **desktop notifications + sound**, **light / dark theme** (persisted)
- **Settings** panel (WhatsApp-style): Account, Privacy, Security, Chats, Notifications, Help
- **Rate limiting & abuse protection** (per-IP API limits + per-user socket flood control)
- **Tests** (`node --test`) and **GitHub Actions CI**

## Project structure

```
.
├── backend/          # Express + Socket.io API (TypeScript)
│   └── src/
│       ├── models/       # Mongoose schemas (User, ChatRoom, Message)
│       ├── routes/       # REST endpoints (auth, rooms)
│       ├── socket/       # Socket.io handlers + typed event contracts
│       ├── middleware/   # auth (JWT), rate limiting
│       └── server.ts     # entry point
├── frontend/         # Next.js App Router client
│   └── src/
│       ├── app/          # routes (auth, /chat, /reset-password, /verify-email)
│       ├── components/   # Avatar, CallOverlay, SettingsModal, GroupManageModal, …
│       ├── context/      # SocketProvider (persistent connection)
│       ├── hooks/        # useCall (WebRTC state machine)
│       └── lib/          # api client, socket, typed events, theme, notifications
└── .github/workflows/ci.yml
```

## Getting started

**Prerequisites**
- **Node.js 20.9+** (Node **22** recommended — the test runner uses `node --test` glob support added in Node 21)
- A **MongoDB** connection string (a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster works)

**1. Install dependencies** (root + backend + frontend)

```bash
npm run install:all
```

**2. Configure environment** — copy the examples and fill in your values:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

**3. Run both servers**

```bash
npm run dev
```

- Backend → http://localhost:5000
- Frontend → http://localhost:3000

Or run them individually with `npm run dev:backend` / `npm run dev:frontend`.

Then open **http://localhost:3000**, sign up, and start chatting. To see realtime
features (presence, ticks, calls), open a second account in an incognito window.

> The backend starts even if MongoDB is unreachable (it logs a warning), but auth
> and messaging require the database. Keep `CLIENT_URL` in `backend/.env` pointed
> at the frontend's URL so CORS allows it.

## Environment variables

**`backend/.env`**

| Key | Description |
| --- | --- |
| `PORT` | Backend port (default `5000`) |
| `CLIENT_URL` | Frontend origin, for CORS (e.g. `http://localhost:3000`) |
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | Long random secret for signing tokens |
| `JWT_EXPIRES_IN` | Token lifetime (e.g. `7d`) |
| `RESEND_API_KEY` | _Optional_ — [Resend](https://resend.com) key for real emails; blank = dev mode (links logged to console) |
| `MAIL_FROM` | _Optional_ — sender, e.g. `Plume <onboarding@resend.dev>` |

**`frontend/.env.local`**

| Key | Description |
| --- | --- |
| `NEXT_PUBLIC_SOCKET_URL` | Backend URL for REST + Socket.io (e.g. `http://localhost:5000`) |
| `NEXT_PUBLIC_TURN_SERVER_URL` | _Optional_ — TURN server for call NAT-traversal |
| `NEXT_PUBLIC_TURN_USERNAME` | _Optional_ — TURN username |
| `NEXT_PUBLIC_TURN_PASSWORD` | _Optional_ — TURN credential |

## Testing & CI

```bash
cd backend && npm test        # Node's built-in test runner (no extra deps)
```

Every push / PR runs [`.github/workflows/ci.yml`](.github/workflows/ci.yml):
type-check + tests (backend) and type-check + lint + build (frontend).

## Deploying for free

Vercel can't host a long-lived Socket.io server, so split the app:

1. **Database** — MongoDB Atlas (free tier).
2. **Backend** — [Render](https://render.com) free Web Service, root directory `backend`.
   Build: `npm install --include=dev && npm run build` (TypeScript is a devDependency).
   Start: `npm start`.
3. **Frontend** — [Vercel](https://vercel.com), root directory `frontend` (auto-detects Next.js).

Set the env vars above in each host's dashboard, point `NEXT_PUBLIC_SOCKET_URL`
at the backend URL and `CLIENT_URL` at the Vercel URL. Both hosts provide HTTPS,
which WebRTC calls require.

> **Free-tier caveats:** uploaded files live on ephemeral disk (wiped on redeploy —
> a cloud store like S3/Cloudinary is the permanent fix), and the free backend
> cold-starts after idling.

## API overview

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/auth/signup` | — | Create account, returns JWT + user |
| POST | `/api/auth/login` | — | Authenticate (email **or** username), returns JWT + user |
| GET | `/api/auth/me` | Bearer | Current user profile |
| PATCH | `/api/auth/me` | Bearer | Update username / bio / privacy toggles |
| POST | `/api/auth/me/avatar` | Bearer | Upload a profile photo (multipart `avatar`) |
| POST | `/api/auth/change-password` | Bearer | Change password |
| POST | `/api/auth/forgot-password` | — | Email a password-reset link |
| POST | `/api/auth/reset-password` | — | Consume reset token, set new password |
| POST | `/api/auth/verify-email` | — | Confirm email via token |
| POST | `/api/auth/resend-verification` | Bearer | Send a fresh verification email |
| GET | `/api/rooms` | Bearer | Rooms you participate in |
| POST | `/api/rooms` | Bearer | Create a group, community, or 1:1 room |
| POST | `/api/rooms/upload` | Bearer | Upload a message attachment (multipart `file`) |
| POST | `/api/rooms/:id/avatar` | Bearer | Set a group/community photo (admins only) |
| GET | `/api/rooms/communities` | Bearer | Discover all public communities (with membership flags) |
| GET | `/api/rooms/users/lookup?username=` | Bearer | Find a user by exact username |
| GET | `/api/rooms/search?q=` | Bearer | Global search — matching chats + messages |
| GET | `/api/rooms/:id/messages/search?q=` | Bearer | Search within one conversation |
| GET | `/api/rooms/:id/messages` | Bearer | Paginated history — last 50 by default; `?before=<ISO date>&limit=<n≤100>` for older pages |
| GET | `/api/rooms/users/all` | Bearer | All other users |

Uploaded files are served from `/uploads/avatars/*` and `/uploads/media/*` (static, stored under `backend/uploads/`).

## Socket.io events (strongly typed)

Connections authenticate with the same JWT (`auth: { token }` in the handshake).
Event contracts are TypeScript interfaces in `backend/src/socket/events.ts`,
mirrored in `frontend/src/lib/socket-events.ts`, and enforced via
`Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>`.

**Client → server:** `join_room`, `join_private_room`, `send_message({roomId, content?, attachment?, replyTo?}, ack)` (saved to MongoDB **before** broadcast), `typing`, `mark_read`, `edit_message`, `delete_message`, `announce_profile`, `react_message`, `group_update`, `group_add_members`, `group_remove_member`, `group_set_admin`, `group_leave`, `community_request`, `community_approve`, `community_reject`. **Call signaling:** `call-user`, `answer-call`, `ice-candidate`, `end-call`.

**Server → client:** `receive_message`, `user_status_change`, `user_typing`, `private_room_created`, `messages_delivered`, `messages_read`, `message_edited`, `message_deleted`, `user_updated`, `message_reaction`, `room_updated`, `removed_from_room`. **Call signaling:** `incoming-call`, `call-answered`, `ice-candidate`, `call-ended`, `call-error`.

## Data models (Mongoose)

- **User** — username, email, password (bcrypt-hashed, `select: false`), avatar, bio, onlineStatus, lastSeen, lastSeenVisible, readReceipts, emailVerified, (reset/verify tokens)
- **ChatRoom** — name, isGroup, isCommunity, participants[], admins[], joinRequests[], description, avatar
- **Message** — sender, room, content, attachment, replyTo, reactions[], timestamp, readBy[], deliveredTo[], edited, deleted

---

Built as an internship project at **NexSoft Solutions**.
