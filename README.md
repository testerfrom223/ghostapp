# GhostChat

GhostChat is a lightweight chat app you can deploy on a single Node.js service. It provides:

- anonymous-style room access with alias + shared room ID
- client-side AES-256-GCM encryption for text and image messages
- local message persistence in IndexedDB (browser local database)
- WebRTC audio/video calling with Socket.IO signaling
- optional disconnect-after-send behavior
- no plaintext message storage on the server

## Important security notes

This is a deployable MVP, not a Telegram replacement.

- Chat messages and images are encrypted in the browser before being sent.
- The server relays encrypted payloads and does not persist them.
- Media calls use standard WebRTC transport encryption (DTLS-SRTP).
- Signaling messages are also encrypted with the shared secret in this build.
- Metadata such as IP address, timing, and room usage still exist at the hosting/network layer.
- For serious threat models, you should add audited cryptography, identity verification, TURN servers, abuse controls, and security review.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000` in two browsers/devices.

## Deploy

Any host that supports a long-running Node.js web service and WebSockets can run this.

### Render example

1. Push this folder to GitHub.
2. Create a **Web Service**.
3. Build command: `npm install`
4. Start command: `npm start`
5. Instance type: Free (for testing / hobby use)

### Environment

- `PORT` is automatically supported.

## Project structure

- `server.js` - Express + Socket.IO server
- `public/index.html` - app UI
- `public/app.js` - crypto, IndexedDB, chat, and WebRTC logic
- `public/styles.css` - styling

## Limits in this starter

- no TURN server, so some calls will fail behind strict NAT/firewalls
- image payloads are sent as data URLs, which is okay for small images but not large files
- no multi-device sync because the database is intentionally local-only
- no offline queued delivery because the server is intentionally stateless


## Fixed in this build

- reliable message delivery using Socket.IO acknowledgements
- safer disconnect-after-send behavior
- join-room acknowledgement and room-switch handling
- better call signaling with queued ICE candidates
- remote hang-up notification
- connection error handling and UI state fixes
