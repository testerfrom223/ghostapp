const express = require('express');
const http = require('http');
const path = require('path');
const helmet = require('helmet');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 25 * 1024 * 1024,
  pingTimeout: 20000,
  pingInterval: 10000,
});

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

const roomMembers = new Map();

function getRoomSet(roomId) {
  if (!roomMembers.has(roomId)) roomMembers.set(roomId, new Set());
  return roomMembers.get(roomId);
}

io.on('connection', (socket) => {
  socket.on('join-room', ({ roomId, alias } = {}, ack) => {
    if (!roomId) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Room ID is required.' });
      return;
    }

    const previousRoom = socket.data.roomId;
    if (previousRoom && previousRoom !== roomId) {
      socket.leave(previousRoom);
      const previousMembers = roomMembers.get(previousRoom);
      if (previousMembers) {
        previousMembers.delete(socket.id);
        if (previousMembers.size === 0) roomMembers.delete(previousRoom);
        else {
          io.to(previousRoom).emit('presence', {
            members: Array.from(previousMembers),
            count: previousMembers.size,
          });
        }
      }
    }

    socket.data.roomId = roomId;
    socket.data.alias = alias || 'anon';
    socket.join(roomId);
    const members = getRoomSet(roomId);
    members.add(socket.id);
    io.to(roomId).emit('presence', {
      members: Array.from(members),
      count: members.size,
    });
    if (typeof ack === 'function') ack({ ok: true, roomId, count: members.size });
  });

  socket.on('encrypted-message', (payload = {}, ack) => {
    const roomId = socket.data.roomId || payload.roomId;
    if (!roomId) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Not connected to a room.' });
      return;
    }
    socket.to(roomId).emit('encrypted-message', {
      ...payload,
      fromSocketId: socket.id,
      serverReceivedAt: Date.now(),
    });
    if (typeof ack === 'function') ack({ ok: true, serverReceivedAt: Date.now() });
  });

  socket.on('signal', (payload = {}, ack) => {
    const roomId = socket.data.roomId || payload.roomId;
    if (!roomId) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Not connected to a room.' });
      return;
    }
    socket.to(roomId).emit('signal', {
      ...payload,
      fromSocketId: socket.id,
      serverReceivedAt: Date.now(),
    });
    if (typeof ack === 'function') ack({ ok: true, serverReceivedAt: Date.now() });
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId || !roomMembers.has(roomId)) return;
    const members = roomMembers.get(roomId);
    members.delete(socket.id);
    if (members.size === 0) {
      roomMembers.delete(roomId);
      return;
    }
    io.to(roomId).emit('presence', {
      members: Array.from(members),
      count: members.size,
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`GhostChat server listening on http://localhost:${PORT}`);
});
