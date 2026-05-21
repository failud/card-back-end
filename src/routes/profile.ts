import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { User } from '../models/User';
import { GameHistory } from '../models/GameHistory';

const router = Router();
router.use(authMiddleware);

// GET /api/profile
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const [user, recentGames, totalGames] = await Promise.all([
      User.findById(req.userId).select('-passwordHash').lean(),
      GameHistory.find({ userId: req.userId })
        .sort({ playedAt: -1 })
        .limit(5)
        .lean(),
      GameHistory.countDocuments({ userId: req.userId }),
    ]);

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Win rate
    const wins = await GameHistory.countDocuments({ userId: req.userId, winnerId: 'player' });

    res.json({
      id: user._id.toString(),
      username: user.username,
      displayName: user.displayName,
      stats: user.stats,
      createdAt: user.createdAt,
      recentGames,
      winRate: totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0,
    });
  } catch (err) {
    console.error('Profile error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
