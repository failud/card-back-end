import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { connectDB } from './db';
import { User } from './models/User';

async function seed() {
  await connectDB();

  const users = [
    { username: 'admin', password: 'admin123', displayName: 'Admin' },
    { username: 'player1', password: 'pass123', displayName: 'ສົມສະຫວັນ' },
    { username: 'player2', password: 'pass123', displayName: 'ຄຳພູ' },
    { username: 'test', password: 'test123', displayName: 'Tester' },
    { username: 'demo', password: 'demo123', displayName: 'Demo' },
  ];

  for (const u of users) {
    const existing = await User.findOne({ username: u.username });
    if (existing) {
      console.log(`Skip ${u.username} — already exists`);
      continue;
    }
    const passwordHash = await bcrypt.hash(u.password, 10);
    await User.create({ username: u.username, passwordHash, displayName: u.displayName });
    console.log(`Created user: ${u.username}`);
  }

  console.log('Seed complete');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
