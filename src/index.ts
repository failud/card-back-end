import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { connectDB } from './db';
import authRoutes from './routes/auth';
import historyRoutes from './routes/history';
import profileRoutes from './routes/profile';
import { createSocketServer, getIO } from './socket';
import { registerHandlers } from './socket/handlers';

async function main() {
  await connectDB();

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.use('/api/auth', authRoutes);
  app.use('/api/history', historyRoutes);
  app.use('/api/profile', profileRoutes);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const httpServer = createServer(app);
  const io = createSocketServer(httpServer);

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.data.userId}`);
    registerHandlers(socket);
  });

  const port = process.env.PORT || 4000;
  httpServer.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
