// ── Types ──

export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type Color = 'red' | 'black';
export type Rank = 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 'J' | 'Q' | 'K' | 'A' | '2';

export interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
  color: Color;
}

export type PlayType =
  | 'single' | 'good_pair' | 'triple_straight_flush'
  | 'quad_plus_straight_flush' | 'triple'
  | 'two_straight_good_pairs' | 'pass';

export interface PlayRecord {
  playerId: string;
  cards: Card[];
  type: PlayType;
}

export interface InstantWinResult {
  type: 'A' | 'B';
  name: string;
  points: number;
  canUseCentral: boolean;
}

export interface GamePlayer {
  id: string;
  name: string;
  hand: Card[];
  isAI: false;
  lockedOut: boolean;
  cardsPlayed: number;
  isOut: boolean;
}

export interface RoomPlayer {
  id: string;
  name: string;
  socketId: string;
  connected: boolean;
}

export type RoomPhase = 'lobby' | 'ready-check' | 'playing' | 'game-over';

export interface GameState {
  players: GamePlayer[];
  centralCard: Card | null;
  deck: Card[];
  currentPlayerIndex: number;
  roundHistory: PlayRecord[];
  currentPlay: PlayRecord | null;
  leadingSuit: Suit | null;
  gameHistory: PlayRecord[];
  roundLeaderId: string | null;
  winner: string | null;
  scores: Record<string, number> | null;
  payouts: Record<string, number> | null;
  winDetail: {
    winType: 'normal' | 'instant_win';
    winnerName: string;
    winnerId: string;
    totalPoints: number;
    instantWinSets: InstantWinResult[];
    normalBreakdown: {
      twos: number;
      centralMatches: number;
      specialSets: { type: string; count: number; points: number }[];
      zeroPointBonus: boolean;
    } | null;
  } | null;
  timer: number;
}

export interface RoomConfig {
  playerCount: number;
  coinValue: number;
}

export interface GameRoom {
  code: string;
  hostId: string;
  config: RoomConfig;
  players: RoomPlayer[];
  phase: RoomPhase;
  gameState: GameState | null;
  timerInterval: ReturnType<typeof setInterval> | null;
  readyPlayers: Set<string>;
}

// ── Room Manager ──

const rooms = new Map<string, GameRoom>();

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  if (rooms.has(code)) return generateCode();
  return code;
}

export function createRoom(hostId: string, hostName: string, config: RoomConfig): GameRoom {
  const code = generateCode();
  const room: GameRoom = {
    code,
    hostId,
    config,
    players: [{ id: hostId, name: hostName, socketId: '', connected: true }],
    phase: 'lobby',
    gameState: null,
    timerInterval: null,
    readyPlayers: new Set(),
  };
  rooms.set(code, room);
  return room;
}

export function joinRoom(roomCode: string, playerId: string, playerName: string): GameRoom | { error: string } {
  const room = rooms.get(roomCode.toUpperCase());
  if (!room) return { error: 'Room not found' };

  // Reconnecting player — allow regardless of phase
  const existing = room.players.find((p) => p.id === playerId);
  if (existing) {
    existing.connected = true;
    return room;
  }

  // New player — only during lobby
  if (room.phase !== 'lobby') return { error: 'Game already started' };
  if (room.players.length >= room.config.playerCount) return { error: 'Room is full' };

  room.players.push({ id: playerId, name: playerName, socketId: '', connected: true });
  return room;
}

export function leaveRoom(roomCode: string, playerId: string): GameRoom | null {
  const room = rooms.get(roomCode.toUpperCase());
  if (!room) return null;

  room.players = room.players.filter((p) => p.id !== playerId);

  if (room.players.length === 0 || room.hostId === playerId) {
    rooms.delete(room.code);
    if (room.timerInterval) clearInterval(room.timerInterval);
    return null;
  }

  if (room.players.length > 0 && room.hostId === playerId) {
    room.hostId = room.players[0].id;
  }

  return room;
}

export function getRoom(roomCode: string): GameRoom | undefined {
  return rooms.get(roomCode.toUpperCase());
}

export function deleteRoom(roomCode: string): void {
  const room = rooms.get(roomCode.toUpperCase());
  if (room?.timerInterval) clearInterval(room.timerInterval);
  rooms.delete(roomCode.toUpperCase());
}

export function updatePlayerSocket(roomCode: string, playerId: string, socketId: string): void {
  const room = rooms.get(roomCode.toUpperCase());
  if (!room) return;
  const player = room.players.find((p) => p.id === playerId);
  if (player) player.socketId = socketId;
}

export function setPlayerDisconnected(roomCode: string, playerId: string): GameRoom | null {
  const room = rooms.get(roomCode.toUpperCase());
  if (!room) return null;
  const player = room.players.find((p) => p.id === playerId);
  if (player) player.connected = false;
  return room;
}

export function setPlayerConnected(roomCode: string, playerId: string, socketId: string): GameRoom | null {
  const room = rooms.get(roomCode.toUpperCase());
  if (!room) return null;
  const player = room.players.find((p) => p.id === playerId);
  if (player) {
    player.connected = true;
    player.socketId = socketId;
  }
  return room;
}
