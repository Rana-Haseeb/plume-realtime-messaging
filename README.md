# Plume — Real-Time Chat Application (Socket.io)

> Conversations, light as a feather.

Monorepo containing:

- **backend/** — Node.js + TypeScript + Express + Socket.io + Mongoose (MongoDB), listens on port **5000**
- **frontend/** — Next.js (App Router) + TypeScript + Tailwind CSS + socket.io-client, runs on port **3000**

## Features

- JWT auth (signup / login), persistent sessions, auto-reconnecting socket
- **Start a DM by username**, create private groups, and add members by username
- **Communities** — public, discoverable groups; anyone can request to join and admins approve
- 1-on-1 and group chats, typing indicators, online / last-seen presence
- **Message ticks** — single (sent), double-grey (delivered), double-blue (read)
- **Edit & delete** your own messages (live tombstones)
- **Media messages** — image & file attachments with inline previews / downloads
- **Reactions & replies** — emoji reactions and reply-to-message quoting
- **Group admin controls** — rename, edit description, group photo, add/remove members, promote/demote admins, leave group
- **Search** — search within a conversation (with jump-to-match) and global search across chats & messages
- **Avatar upload** (local disk via multer) with initials fallback
- **Desktop notifications + sound** when the tab is hidden
- **Light / dark theme** (persisted, no flash on load)
- **Settings** panel (WhatsApp-style): Account, Privacy, Security, Chats, Notifications, Help
- **Voice & video calls** — 1-on-1 WebRTC calling (Socket.io signaling, STUN + TURN), with mute/camera toggles
- **Password reset & email verification** (Resend, with a console dev-mode fallback)
- **Rate limiting & abuse protection** (per-IP API limits + per-user socket flood control)
- Paginated history (last 50 + "load earlier"), messages persisted before broadcast
- **Tests** (`npm test`, Node's built-in runner) and **GitHub Actions CI**

## Setup

```bash
npm run install:all
```

## Run both servers (concurrently)

```bash
npm run dev
```

- Backend: http://localhost:5000
- Frontend: http://localhost:3001

Or run them individually:

```bash
npm run dev:backend
npm run dev:frontend
```

## Environment variables

- `backend/.env` — `PORT`, `CLIENT_URL`, `MONGO_URI` (MongoDB Atlas), `JWT_SECRET`, `JWT_EXPIRES_IN`, and optionally `RESEND_API_KEY` + `MAIL_FROM` for email
- `frontend/.env.local` — `NEXT_PUBLIC_SOCKET_URL`, and `NEXT_PUBLIC_TURN_SERVER_URL` / `NEXT_PUBLIC_TURN_USERNAME` / `NEXT_PUBLIC_TURN_PASSWORD` for call NAT-traversal

Copy `backend/.env.example` and `frontend/.env.local.example` to get started.

**Email:** password-reset and verification work out of the box in **dev mode** — the email (with its link) is printed to the backend console. To send real emails, add a `RESEND_API_KEY` (from [resend.com](https://resend.com)) and a verified `MAIL_FROM` address.

## Testing & CI

```bash
cd backend && npm test        # Node's built-in test runner (no extra deps)
```

Every push/PR runs `.github/workflows/ci.yml`: type-check + tests (backend) and type-check + lint + build (frontend).

The backend starts even if MongoDB is unreachable (it logs a warning), but auth and messaging require the database. The frontend runs on port **3000**; keep `CLIENT_URL` in `backend/.env` pointed at it for CORS.

## API overview

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/auth/signup` | — | Create account, returns JWT + user |
| POST | `/api/auth/login` | — | Authenticate, returns JWT + user |
| GET | `/api/auth/me` | Bearer | Current user profile |
| PATCH | `/api/auth/me` | Bearer | Update username / bio / privacy toggles |
| POST | `/api/auth/me/avatar` | Bearer | Upload a profile photo (multipart `avatar`) |
| POST | `/api/auth/change-password` | Bearer | Change password |
| POST | `/api/auth/forgot-password` | — | Email a password-reset link |
| POST | `/api/auth/reset-password` | — | Consume reset token, set new password |
| POST | `/api/auth/verify-email` | — | Confirm email via token |
| POST | `/api/auth/resend-verification` | Bearer | Send a fresh verification email |
| GET | `/api/rooms` | Bearer | Rooms you participate in |
| POST | `/api/rooms` | Bearer | Create channel or 1:1 room |
| POST | `/api/rooms/upload` | Bearer | Upload a message attachment (multipart `file`) |
| POST | `/api/rooms/:id/avatar` | Bearer | Set a group photo (admins only) |
| GET | `/api/rooms/communities` | Bearer | Discover all public communities (with membership flags) |
| GET | `/api/rooms/users/lookup?username=` | Bearer | Find a user by exact username |
| GET | `/api/rooms/search?q=` | Bearer | Global search — matching chats + messages |
| GET | `/api/rooms/:id/messages/search?q=` | Bearer | Search within one conversation |
| GET | `/api/rooms/:id/messages` | Bearer | Paginated history — last 50 by default; `?before=<ISO date>&limit=<n≤100>` for older pages |
| GET | `/api/rooms/users/all` | Bearer | All other users |

Uploaded files are served from `/uploads/avatars/*` and `/uploads/media/*` (static, stored under `backend/uploads/`).

## Socket.io events (strongly typed)

Connections authenticate with the same JWT (`auth: { token }` in the handshake). Event contracts are TypeScript interfaces in `backend/src/socket/events.ts`, mirrored in `frontend/src/lib/socket-events.ts`, and enforced via `Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>`.

**Client → server:** `join_room`, `join_private_room`, `send_message({roomId, content?, attachment?, replyTo?}, ack)` (saved to MongoDB **before** broadcast), `typing`, `mark_read`, `edit_message`, `delete_message`, `announce_profile`, `react_message({messageId, emoji})`, `group_update`, `group_add_members`, `group_remove_member`, `group_set_admin`, `group_leave`, `community_request`, `community_approve`, `community_reject`. **Call signaling:** `call-user`, `answer-call`, `ice-candidate`, `end-call`.

**Server → client:** `receive_message`, `user_status_change`, `user_typing`, `private_room_created`, `messages_delivered`, `messages_read`, `message_edited`, `message_deleted`, `user_updated`, `message_reaction({messageId, roomId, reactions})`, `room_updated(room)`, `removed_from_room({roomId})`. **Call signaling:** `incoming-call`, `call-answered`, `ice-candidate`, `call-ended`, `call-error`.

## Data models (Mongoose)

- **User** — username, email, password (bcrypt-hashed, `select: false`), avatar, bio, onlineStatus, lastSeen, lastSeenVisible, readReceipts
- **ChatRoom** — name, isGroup, isCommunity, participants[], admins[], joinRequests[], description, avatar
- **Message** — sender, room, content, attachment, replyTo, reactions[], timestamp, readBy[], deliveredTo[], edited, deleted
