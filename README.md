# Send.me.it

P2P file transfer. Files go directly between peers, the server only handles signaling.

## Development Setup

```bash
npm install
npm run dev
```

Open http://localhost:8080

## Deployment Setup via Docker

```bash
docker compose up --build
```

## Usage

1. Drag and drop a file
2. Share the generated link
3. Recipient opens link to receive file

## Architecture

- Frontend: HTML + CSS + JavaScript
- Backend: Node.js + Express + PeerJS
- File transfer: Direct peer-to-peer via WebRTC
- Server: Only handles peer discovery

## Ports

- 8080: Frontend
- 9000: PeerJS signaling
