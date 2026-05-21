import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { GameHistory } from '../models/GameHistory';
import { User } from '../models/User';

const router = Router();
router.use(authMiddleware);

// GET /api/history
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      GameHistory.find({ userId: req.userId })
        .sort({ playedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      GameHistory.countDocuments({ userId: req.userId }),
    ]);

    res.json({ items, total, page, limit });
  } catch (err) {
    console.error('Get history error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/history
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const data = { ...req.body, userId: req.userId };
    const doc = await GameHistory.create(data);

    // Update user stats
    const isWinner = data.winnerId === 'player';
    const update: Record<string, number> = {
      'stats.gamesPlayed': 1,
      'stats.totalPoints': data.totalPoints || 0,
    };
    if (isWinner) update['stats.gamesWon'] = 1;
    if (data.winType === 'instant_win') update['stats.instantWins'] = 1;

    await User.findByIdAndUpdate(req.userId, { $inc: update });

    res.status(201).json({ id: doc._id.toString() });
  } catch (err) {
    console.error('Save history error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
