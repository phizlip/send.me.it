const peer = require('peer');
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;
const PEER_PORT = process.env.PEER_PORT || 9000;

app.use(express.static(path.join(__dirname, '../frontend')));
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, '../favicon.ico'));
});

// Start PeerServer for signaling
const peerServer = peer.PeerServer({
  port: PEER_PORT,
  path: '/peerjs',
  allow_discovery: true
});

console.log(`PeerServer running on port ${PEER_PORT}`);
console.log(`Static file server running on port ${PORT}`);

// Start Express server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`PeerServer running on http://localhost:${PEER_PORT}`);
});
