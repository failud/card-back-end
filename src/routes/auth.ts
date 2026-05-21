import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../models/User';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();

// POST /api/auth/login — auto-registers if username doesn't exist
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: 'Username and password required' });
      return;
    }

    let user = await User.findOne({ username });

    if (!user) {
      // Auto-register new user
      const passwordHash = await bcrypt.hash(password, 10);
      user = await User.create({ username, passwordHash, displayName: username });
    } else {
      // Existing user — verify password
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        res.status(401).json({ error: 'Invalid password' });
        return;
      }
    }

    const secret = process.env.JWT_SECRET || 'fallback';
    const token = jwt.sign({ userId: user._id.toString() }, secret, { expiresIn: '7d' });

    res.json({
      token,
      user: {
        id: user._id.toString(),
        username: user.username,
        displayName: user.displayName,
        stats: user.stats,
      },
    });
  } catch (err: any) {
    if (err?.code === 11000) {
      res.status(409).json({ error: 'Username already taken' });
      return;
    }
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({
      id: user._id.toString(),
      username: user.username,
      displayName: user.displayName,
      stats: user.stats,
      createdAt: user.createdAt,
    });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
