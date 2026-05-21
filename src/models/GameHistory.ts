import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IGamePlayer {
  id: string;
  name: string;
  isAI: boolean;
  handSize: number;
}

export interface IGameHistory extends Document {
  userId: Types.ObjectId;
  playedAt: Date;
  opponentCount: number;
  coinValue: number;
  winType: 'instant_win' | 'normal';
  winnerId: string;
  totalPoints: number;
  instantWinSets: { name: string; points: number }[];
  normalBreakdown: {
    twos: number;
    centralMatches: number;
    specialSets: { type: string; count: number; points: number }[];
    zeroPointBonus: boolean;
  } | null;
  payouts: Record<string, number>;
  players: IGamePlayer[];
}

const GameHistorySchema = new Schema<IGameHistory>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  playedAt: { type: Date, default: Date.now },
  opponentCount: { type: Number, required: true },
  coinValue: { type: Number, required: true },
  winType: { type: String, enum: ['instant_win', 'normal'], required: true },
  winnerId: { type: String, required: true },
  totalPoints: { type: Number, required: true },
  instantWinSets: [{ name: String, points: Number }],
  normalBreakdown: {
    type: {
      twos: Number,
      centralMatches: Number,
      specialSets: [{ type: String, count: Number, points: Number }],
      zeroPointBonus: Boolean,
    },
    default: null,
  },
  payouts: { type: Schema.Types.Mixed, required: true },
  players: [{
    id: String,
    name: String,
    isAI: Boolean,
    handSize: Number,
  }],
});

export const GameHistory = mongoose.model<IGameHistory>('GameHistory', GameHistorySchema);
