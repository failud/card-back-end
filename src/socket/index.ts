import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { User } from '../models/User';

let io: Server | null = null;

export function createSocketServer(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: 'http://localhost:3000', methods: ['GET', 'POST'] },
  });

  io.use(async (socket: Socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      next(new Error('No token provided'));
      return;
    }
    try {
      const secret = process.env.JWT_SECRET || 'fallback';
      const payload = jwt.verify(token, secret) as { userId: string };
      socket.data.userId = payload.userId;
      // Fetch username for display
      const user = await User.findById(payload.userId);
      socket.data.userName = user?.displayName || user?.username || 'Player';
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  return io;
}

export function getIO(): Server {
  if (!io) throw new Error('Socket.IO not initialized');
  return io;
}
