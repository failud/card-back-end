import { Router } from 'express';
import { getPublicRooms } from '../socket/room-manager';

const router = Router();

router.get('/', (_req, res) => {
  const rooms = getPublicRooms();
  res.json({ rooms });
});

export default router;
