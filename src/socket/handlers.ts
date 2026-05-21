import { Socket } from 'socket.io';
import { getIO } from './index';
import {
  createRoom, joinRoom, leaveRoom, getRoom, deleteRoom,
  updatePlayerSocket, setPlayerDisconnected,
} from './room-manager';
import {
  initGameState, processPlay, processPass, processInstantWin,
  processNormalWin, getNextPlayerIndex, checkInstantWin, calculatePayout, calculateScore,
} from './game-logic';
import { User } from '../models/User';
import { GameHistory } from '../models/GameHistory';

type AckCallback = (response: { ok?: boolean; error?: string; roomCode?: string }) => void;

function getRoomPlayers(roomCode: string): string[] {
  const room = getRoom(roomCode);
  if (!room) return [];
  return room.players.map((p) => p.socketId).filter(Boolean);
}

function broadcastToRoom(roomCode: string, event: string, data: unknown): void {
  const io = getIO();
  const sockets = getRoomPlayers(roomCode);
  sockets.forEach((sid) => io.to(sid).emit(event, data));
}

function sendToPlayer(socketId: string, event: string, data: unknown): void {
  getIO().to(socketId).emit(event, data);
}

function getPlayerName(roomCode: string, playerId: string): string {
  const room = getRoom(roomCode);
  return room?.players.find((p) => p.id === playerId)?.name || '';
}

// ── Timer Helpers ──

function startTimer(roomCode: string): void {
  const room = getRoom(roomCode);
  if (!room || !room.gameState) return;

  room.gameState.timer = 30;
  if (room.timerInterval) clearInterval(room.timerInterval);

  room.timerInterval = setInterval(() => {
    const r = getRoom(roomCode);
    if (!r || !r.gameState || r.phase !== 'playing') {
      if (r?.timerInterval) clearInterval(r.timerInterval);
      return;
    }

    r.gameState.timer--;
    broadcastToRoom(roomCode, 'timer_sync', { remaining: r.gameState.timer });

    if (r.gameState.timer <= 0) {
      clearInterval(r.timerInterval!);
      r.timerInterval = null;
      // Auto-pass
      autoPass(roomCode);
    }
  }, 1000);
}

function autoPass(roomCode: string): void {
  const room = getRoom(roomCode);
  if (!room || !room.gameState || room.phase !== 'playing') return;

  const gs = room.gameState;
  const player = gs.players[gs.currentPlayerIndex];
  if (!player) return;

  // If no current play, auto-play lowest single
  if (!gs.currentPlay || gs.currentPlay.type === 'pass') {
    if (player.hand.length > 0) {
      // Play lowest single
      const lowest = [...player.hand].sort((a, b) => {
        const RANK_VALUES: Record<string, number> = { '3':0,'4':1,'5':2,'6':3,'7':4,'8':5,'9':6,'10':7,J:8,Q:9,K:10,A:11,'2':12 };
        return (RANK_VALUES[String(a.rank)] || 0) - (RANK_VALUES[String(b.rank)] || 0);
      });
      const result = processPlay(gs, player.id, [lowest[0].id]);
      if (result.state) {
        room.gameState = result.state;
        broadcastToRoom(roomCode, 'play_made', {
          playerId: player.id,
          playerName: player.name,
          cards: [lowest[0]],
          type: 'single',
        });
      }
    }
  } else {
    // Pass
    const result = processPass(gs, player.id);
    if (result.state) {
      room.gameState = result.state;
      broadcastToRoom(roomCode, 'player_passed', { playerId: player.id, playerName: player.name });
      if (gs.roundHistory.length === 0 && gs.currentPlay === null) {
        // Round reset
        broadcastToRoom(roomCode, 'new_round', {
          leaderId: gs.roundLeaderId,
          centralCard: gs.centralCard,
        });
      }
    }
  }

  checkEndGame(roomCode);
  advanceTurn(roomCode);
}

// ── Turn Management ──

function advanceTurn(roomCode: string): void {
  const room = getRoom(roomCode);
  if (!room || !room.gameState || room.phase !== 'playing') return;

  const gs = room.gameState;
  gs.currentPlayerIndex = getNextPlayerIndex(gs.players, gs.currentPlayerIndex);
  const player = gs.players[gs.currentPlayerIndex];

  if (!player || player.isOut) return;

  broadcastToRoom(roomCode, 'your_turn', {
    playerId: player.id,
    playerName: player.name,
    currentPlay: gs.currentPlay,
    timer: gs.timer,
  });

  startTimer(roomCode);
}

function checkEndGame(roomCode: string): void {
  const room = getRoom(roomCode);
  if (!room || !room.gameState) return;

  const gs = room.gameState;
  if (gs.winner) {
    if (room.timerInterval) clearInterval(room.timerInterval);
    room.timerInterval = null;
    room.phase = 'game-over';

    // Calc final state if not already set
    if (!gs.scores) {
      gs.scores = {};
      gs.payouts = {};
      processNormalWin(gs, gs.winner, room.config.coinValue);
    }

    broadcastToRoom(roomCode, 'game_over', {
      winner: gs.winner,
      winnerName: gs.players.find((p) => p.id === gs.winner)?.name,
      scores: gs.scores,
      payouts: gs.payouts,
      winDetail: gs.winDetail,
      coinValue: room.config.coinValue,
    });

    // Save to history for all players
    saveGameHistory(roomCode).catch(() => {});
  }
}

async function saveGameHistory(roomCode: string): Promise<void> {
  const room = getRoom(roomCode);
  if (!room || !room.gameState) return;

  const gs = room.gameState;
  const winnerId = gs.winner || '';

  for (const player of room.players) {
    const isWinner = player.id === winnerId;
    try {
      const user = await User.findById(player.id);
      if (!user) continue;

      const historyDoc = {
        userId: player.id,
        playedAt: new Date(),
        opponentCount: room.players.length,
        coinValue: room.config.coinValue,
        winType: gs.winDetail?.winType || 'normal',
        winnerId: winnerId,
        totalPoints: isWinner ? (gs.scores?.[player.id] || 0) : 0,
        instantWinSets: isWinner ? (gs.winDetail?.instantWinSets || []) : [],
        normalBreakdown: isWinner ? (gs.winDetail?.normalBreakdown || null) : null,
        payouts: gs.payouts || {},
        players: gs.players.map((p) => ({
          id: p.id,
          name: p.name,
          isAI: false,
          handSize: p.hand.length,
        })),
      };

      await GameHistory.create(historyDoc);

      // Update stats
      user.stats.gamesPlayed += 1;
      if (isWinner) {
        user.stats.gamesWon += 1;
        user.stats.totalPoints += historyDoc.totalPoints;
        if (gs.winDetail?.winType === 'instant_win') user.stats.instantWins += 1;
      }
      await user.save();
    } catch (err) {
      console.error(`Failed to save history for ${player.id}:`, err);
    }
  }
}

// ── Register Handlers ──

export function registerHandlers(socket: Socket): void {
  const userId = socket.data.userId as string;
  if (!userId) return;

  socket.on('create_room', (data: { playerCount: number; coinValue: number }, ack?: AckCallback) => {
    const { playerCount, coinValue } = data;
    if (playerCount < 3 || playerCount > 4) {
      ack?.({ error: 'Player count must be 3-4' });
      return;
    }

    const userName = socket.data.userName || getPlayerName('', userId) || 'Host';
    const room = createRoom(userId, userName, { playerCount, coinValue });
    updatePlayerSocket(room.code, userId, socket.id);
    socket.join(room.code);

    ack?.({ ok: true, roomCode: room.code });
    broadcastToRoom(room.code, 'room_state', { room: sanitizeRoom(room) });
  });

  socket.on('join_room', (data: { roomCode: string }, ack?: AckCallback) => {
    const { roomCode } = data;
    if (!roomCode) {
      ack?.({ error: 'Room code required' });
      return;
    }

    const result = joinRoom(roomCode, userId, socket.data.userName || 'Player');
    if ('error' in result) {
      ack?.({ error: result.error });
      return;
    }

    updatePlayerSocket(roomCode, userId, socket.id);
    socket.join(roomCode);

    ack?.({ ok: true, roomCode });
    broadcastToRoom(roomCode, 'room_state', { room: sanitizeRoom(result) });
  });

  socket.on('leave_room', (data: { roomCode: string }) => {
    const { roomCode } = data;
    socket.leave(roomCode);
    const room = leaveRoom(roomCode, userId);
    if (room) {
      broadcastToRoom(roomCode, 'room_state', { room: sanitizeRoom(room) });
    }
  });

  socket.on('start_game', (data: { roomCode: string }, ack?: AckCallback) => {
    const { roomCode } = data;
    const room = getRoom(roomCode);
    if (!room) { ack?.({ error: 'Room not found' }); return; }
    if (room.hostId !== userId) { ack?.({ error: 'Only host can start' }); return; }
    if (room.players.length < 3) { ack?.({ error: 'Need at least 3 players' }); return; }

    // Mark all players as connected
    room.players.forEach((p) => { p.connected = true; });

    // Init game
    const playerInfos = room.players.map((p) => ({ id: p.id, name: p.name }));
    const gs = initGameState(playerInfos, room.config.coinValue);
    room.gameState = gs;

    // Check instant wins for all players
    const instantWinPlayers: { playerId: string; results: ReturnType<typeof checkInstantWin> }[] = [];
    for (const player of gs.players) {
      const results = checkInstantWin(player.hand, gs.centralCard);
      if (results.length > 0) instantWinPlayers.push({ playerId: player.id, results });
    }

    // If anyone has instant win → game over with the first one
    if (instantWinPlayers.length > 0) {
      const firstWinner = instantWinPlayers[0];
      const winner = gs.players.find((p) => p.id === firstWinner.playerId);
      if (winner) {
        const result = processInstantWin(gs, firstWinner.playerId);
        if (result.state) {
          room.gameState = result.state;
          room.phase = 'game-over';

          // Recalc payouts with coin value
          room.gameState.payouts = calculatePayout(
            firstWinner.playerId, gs.players,
            room.gameState.scores?.[firstWinner.playerId] || 0,
            room.config.coinValue, true
          );

          broadcastToRoom(roomCode, 'game_over', {
            winner: firstWinner.playerId,
            winnerName: winner.name,
            scores: room.gameState.scores,
            payouts: room.gameState.payouts,
            winDetail: room.gameState.winDetail,
            coinValue: room.config.coinValue,
          });
          saveGameHistory(roomCode).catch(() => {});
          return;
        }
      }
    }

    // No instant win → normal flow
    room.phase = 'ready-check';

    // Send public state to all
    broadcastToRoom(roomCode, 'game_started', {
      opponents: gs.players.map((p) => ({
        id: p.id, name: p.name, handSize: p.hand.length,
      })),
      centralCard: gs.centralCard,
      coinValue: room.config.coinValue,
      playerOrder: gs.players.map((p) => p.id),
    });

    // Send private hand to each player
    for (const player of room.players) {
      const gp = gs.players.find((p) => p.id === player.id);
      if (gp && player.socketId) {
        sendToPlayer(player.socketId, 'hand_dealt', { cards: gp.hand });
        sendToPlayer(player.socketId, 'instant_win_check', { results: [] });
      }
    }

    // Move to first turn after brief delay
    setTimeout(() => {
      const r = getRoom(roomCode);
      if (!r || !r.gameState || r.phase === 'game-over') return;
      r.phase = 'playing';
      advanceTurn(roomCode);
    }, 2000);

    ack?.({ ok: true });
  });

  socket.on('play_cards', (data: { roomCode: string; cardIds: string[] }, ack?: AckCallback) => {
    const { roomCode, cardIds } = data;
    const room = getRoom(roomCode);
    if (!room || !room.gameState) { ack?.({ error: 'Game not found' }); return; }

    const gs = room.gameState;
    const currentPlayer = gs.players[gs.currentPlayerIndex];
    if (currentPlayer?.id !== userId) { ack?.({ error: 'Not your turn' }); return; }

    const result = processPlay(gs, userId, cardIds);
    if (result.error) { ack?.({ error: result.error }); return; }
    if (result.state) room.gameState = result.state;

    if (room.timerInterval) { clearInterval(room.timerInterval); room.timerInterval = null; }

    const playRecord = gs.roundHistory[gs.roundHistory.length - 1];
    broadcastToRoom(roomCode, 'play_made', {
      playerId: userId,
      playerName: currentPlayer.name,
      cards: playRecord.cards,
      type: playRecord.type,
    });

    // Update hand for the player
    sendToPlayer(socket.id, 'hand_update', { cards: currentPlayer.hand });

    ack?.({ ok: true });
    checkEndGame(roomCode);
    if (room.phase !== 'game-over') advanceTurn(roomCode);
  });

  socket.on('pass', (data: { roomCode: string }, ack?: AckCallback) => {
    const { roomCode } = data;
    const room = getRoom(roomCode);
    if (!room || !room.gameState) { ack?.({ error: 'Game not found' }); return; }

    const gs = room.gameState;
    const currentPlayer = gs.players[gs.currentPlayerIndex];
    if (currentPlayer?.id !== userId) { ack?.({ error: 'Not your turn' }); return; }

    if (!gs.currentPlay || gs.currentPlay.type === 'pass') {
      ack?.({ error: 'Must lead the round' });
      return;
    }

    const result = processPass(gs, userId);
    if (result.error) { ack?.({ error: result.error }); return; }
    if (result.state) room.gameState = result.state;

    if (room.timerInterval) { clearInterval(room.timerInterval); room.timerInterval = null; }

    broadcastToRoom(roomCode, 'player_passed', { playerId: userId, playerName: currentPlayer.name });

    // Check round reset
    if (gs.roundHistory.length === 0 && gs.currentPlay === null) {
      broadcastToRoom(roomCode, 'new_round', {
        leaderId: gs.roundLeaderId,
        centralCard: gs.centralCard,
      });
    }

    ack?.({ ok: true });
    advanceTurn(roomCode);
  });

  socket.on('declare_instant_win', (data: { roomCode: string }, ack?: AckCallback) => {
    const { roomCode } = data;
    const room = getRoom(roomCode);
    if (!room || !room.gameState) { ack?.({ error: 'Game not found' }); return; }

    const gs = room.gameState;
    const player = gs.players.find((p) => p.id === userId);
    if (!player) { ack?.({ error: 'Player not found' }); return; }

    const result = processInstantWin(gs, userId);
    if (result.error) { ack?.({ error: result.error }); return; }
    if (result.state) room.gameState = result.state;

    // Recalc with coin value
    room.gameState.payouts = calculatePayout(
      userId, gs.players,
      room.gameState.scores?.[userId] || 0,
      room.config.coinValue, true
    );

    room.phase = 'game-over';
    if (room.timerInterval) { clearInterval(room.timerInterval); room.timerInterval = null; }

    broadcastToRoom(roomCode, 'game_over', {
      winner: userId,
      winnerName: player.name,
      scores: room.gameState.scores,
      payouts: room.gameState.payouts,
      winDetail: room.gameState.winDetail,
      coinValue: room.config.coinValue,
    });

    ack?.({ ok: true });
    saveGameHistory(roomCode).catch(() => {});
  });

  socket.on('disconnect', () => {
    // Find rooms this player is in
    // Walk through rooms (function available in closure)
    // For now: broadcast disconnect to the room
    socket.rooms.forEach((r) => {
      if (r !== socket.id) {
        const room = setPlayerDisconnected(r, userId);
        if (room) {
          broadcastToRoom(r, 'player_disconnected', {
            playerId: userId,
            playerName: room.players.find((p) => p.id === userId)?.name || '',
          });
        }
      }
    });
  });
}

// ── Helpers ──

function sanitizeRoom(room: ReturnType<typeof getRoom>) {
  if (!room) return null;
  return {
    code: room.code,
    hostId: room.hostId,
    config: room.config,
    players: room.players.map((p) => ({ id: p.id, name: p.name, connected: p.connected })),
    phase: room.phase,
  };
}
