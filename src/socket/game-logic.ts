import { Card, Suit, Rank, Color, PlayType, PlayRecord, InstantWinResult, GamePlayer, GameState } from './room-manager';

// ── Constants ──

const RANK_VALUES: Record<Rank, number> = {
  3: 0, 4: 1, 5: 2, 6: 3, 7: 4, 8: 5, 9: 6, 10: 7,
  J: 8, Q: 9, K: 10, A: 11, 2: 12,
};

const RANK_ORDER: Rank[] = [3, 4, 5, 6, 7, 8, 9, 10, 'J', 'Q', 'K', 'A', '2'];

const SUIT_COLORS: Record<Suit, Color> = {
  hearts: 'red', diamonds: 'red', clubs: 'black', spades: 'black',
};

function getRankValue(rank: Rank): number {
  return RANK_VALUES[rank];
}

// ── Deck ──

let cardIdCounter = 0;

function createCard(suit: Suit, rank: Rank): Card {
  return { id: `card-${cardIdCounter++}`, suit, rank, color: SUIT_COLORS[suit] };
}

export function createDeck(): Card[] {
  cardIdCounter = 0;
  const suits: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
  const deck: Card[] = [];
  for (const suit of suits) {
    for (const rank of RANK_ORDER) {
      deck.push(createCard(suit, rank));
    }
  }
  return deck;
}

export function shuffle(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function deal(deck: Card[], playerCount: number) {
  const hands: Card[][] = Array.from({ length: playerCount }, () => []);
  for (let i = 0; i < 9 * playerCount; i++) {
    hands[i % playerCount].push(deck[i]);
  }
  const remaining = deck.slice(9 * playerCount);
  const centralCard = remaining[0];
  return { hands, remaining: remaining.slice(1), centralCard };
}

// ── Rule Helpers ──

function isSameSuit(cards: Card[]): boolean {
  if (cards.length === 0) return false;
  return cards.every((c) => c.suit === cards[0].suit);
}

function isSameRank(cards: Card[]): boolean {
  if (cards.length === 0) return false;
  return cards.every((c) => c.rank === cards[0].rank);
}

function isSameColor(cards: Card[]): boolean {
  if (cards.length === 0) return false;
  return cards.every((c) => c.color === cards[0].color);
}

function isConsecutive(cards: Card[]): boolean {
  if (cards.length < 2) return false;
  const sorted = [...cards].sort((a, b) => getRankValue(a.rank) - getRankValue(b.rank));
  for (let i = 1; i < sorted.length; i++) {
    if (getRankValue(sorted[i].rank) - getRankValue(sorted[i - 1].rank) !== 1) return false;
  }
  return true;
}

// ── Play Detection ──

export function detectPlayType(cards: Card[]): PlayType | null {
  if (cards.length === 0) return null;
  if (cards.length === 1) return 'single';

  if (cards.length === 2) {
    if (isSameRank(cards) && isSameColor(cards)) return 'good_pair';
    return null;
  }

  if (cards.length === 3) {
    if (isSameRank(cards)) return 'triple';
    if (isSameSuit(cards) && isConsecutive(cards)) return 'triple_straight_flush';
    return null;
  }

  if (cards.length >= 4) {
    if (isSameSuit(cards) && isConsecutive(cards)) return 'quad_plus_straight_flush';
    if (cards.length === 4) {
      const sorted = [...cards].sort((a, b) => getRankValue(a.rank) - getRankValue(b.rank));
      const pair1 = [sorted[0], sorted[1]];
      const pair2 = [sorted[2], sorted[3]];
      if (
        isSameRank(pair1) && isSameColor(pair1) &&
        isSameRank(pair2) && isSameColor(pair2) &&
        getRankValue(pair2[0].rank) - getRankValue(pair1[0].rank) === 1
      ) {
        return 'two_straight_good_pairs';
      }
    }
    return null;
  }

  return null;
}

// ── Beat Logic ──

export function canBeat(played: PlayRecord, previous: PlayRecord | null): boolean {
  if (!previous || previous.type === 'pass') return true;

  const playedRank = Math.max(...played.cards.map((c) => getRankValue(c.rank)));
  const prevRank = Math.max(...previous.cards.map((c) => getRankValue(c.rank)));

  switch (played.type) {
    case 'single':
      if (previous.type === 'single') {
        return played.cards[0].suit === previous.cards[0].suit && playedRank > prevRank;
      }
      return false;
    case 'good_pair':
      if (previous.type === 'good_pair') {
        return played.cards[0].color === previous.cards[0].color && playedRank > prevRank;
      }
      return false;
    case 'triple_straight_flush':
      if (previous.type === 'single') return played.cards[0].suit === previous.cards[0].suit;
      if (previous.type === 'triple_straight_flush') {
        return played.cards[0].suit === previous.cards[0].suit && playedRank > prevRank;
      }
      return false;
    case 'quad_plus_straight_flush':
      if (previous.type === 'single') return played.cards[0].suit === previous.cards[0].suit;
      if (previous.type === 'triple_straight_flush' || previous.type === 'quad_plus_straight_flush') {
        return played.cards[0].suit === previous.cards[0].suit && playedRank > prevRank;
      }
      return false;
    case 'triple':
      if (previous.type === 'single') {
        const pv = getRankValue(previous.cards[0].rank);
        return pv >= getRankValue(10 as Rank) && pv <= getRankValue('A' as Rank);
      }
      if (previous.type === 'triple') return playedRank > prevRank;
      return false;
    case 'two_straight_good_pairs':
      if (previous.type === 'good_pair') return true;
      if (previous.type === 'two_straight_good_pairs') return playedRank > prevRank;
      return false;
    case 'pass':
      return false;
  }
}

// ── Instant Win ──

export function checkInstantWin(hand: Card[], centralCard: Card | null): InstantWinResult[] {
  const results: InstantWinResult[] = [];

  const rankCounts = new Map<string, Card[]>();
  for (const c of hand) rankCounts.set(String(c.rank), [...(rankCounts.get(String(c.rank)) || []), c]);
  for (const [, cards] of rankCounts) {
    if (cards.length === 4) results.push({ type: 'A', name: 'four_of_a_kind', points: 5, canUseCentral: false });
    if (cards.length === 3 && centralCard && cards[0].rank === centralCard.rank) {
      results.push({ type: 'A', name: 'four_of_a_kind', points: 5, canUseCentral: true });
    }
  }

  const suitGroups = new Map<string, Card[]>();
  for (const c of hand) suitGroups.set(c.suit, [...(suitGroups.get(c.suit) || []), c]);
  for (const [, cards] of suitGroups) {
    const sorted = [...cards].sort((a, b) => getRankValue(a.rank) - getRankValue(b.rank));
    for (let i = 0; i <= sorted.length - 4; i++) {
      if (isConsecutive(sorted.slice(i, i + 4))) {
        results.push({ type: 'A', name: 'four_straight_flush', points: 5, canUseCentral: false });
      }
    }
    if (centralCard && centralCard.suit === cards[0].suit) {
      const withCentral = [...cards, centralCard].sort((a, b) => getRankValue(a.rank) - getRankValue(b.rank));
      for (let i = 0; i <= withCentral.length - 4; i++) {
        const slice = withCentral.slice(i, i + 4);
        if (isConsecutive(slice) && slice.some((c) => c.id === centralCard.id)) {
          results.push({ type: 'A', name: 'four_straight_flush', points: 5, canUseCentral: true });
        }
      }
    }
  }

  // 3 Good Pairs
  const goodPairs: Card[][] = [];
  const usedForPairs = new Set<string>();
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      if (usedForPairs.has(hand[i].id) || usedForPairs.has(hand[j].id)) continue;
      if (hand[i].rank === hand[j].rank && hand[i].color === hand[j].color) {
        goodPairs.push([hand[i], hand[j]]);
        usedForPairs.add(hand[i].id);
        usedForPairs.add(hand[j].id);
      }
    }
  }
  if (goodPairs.length >= 3) results.push({ type: 'B', name: 'three_good_pairs', points: 5, canUseCentral: false });

  // 4 Bad Pairs
  const badPairs: Card[][] = [];
  const usedForBad = new Set<string>();
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      if (usedForBad.has(hand[i].id) || usedForBad.has(hand[j].id)) continue;
      if (hand[i].rank === hand[j].rank && hand[i].color !== hand[j].color) {
        badPairs.push([hand[i], hand[j]]);
        usedForBad.add(hand[i].id);
        usedForBad.add(hand[j].id);
      }
    }
  }
  if (badPairs.length >= 4) results.push({ type: 'B', name: 'four_bad_pairs', points: 5, canUseCentral: false });

  // 5 Face cards
  const faceCards = hand.filter((c) => c.rank === 'J' || c.rank === 'Q' || c.rank === 'K');
  if (faceCards.length >= 5) results.push({ type: 'B', name: 'five_face_cards', points: 5, canUseCentral: false });

  // Triple 2
  const twos = hand.filter((c) => c.rank === '2');
  if (twos.length >= 3) {
    results.push({ type: 'B', name: 'triple_two', points: twos.length === 4 ? 10 : 5, canUseCentral: false });
  }

  // 6 same suit
  for (const [, cards] of suitGroups) {
    if (cards.length >= 6) results.push({ type: 'B', name: 'six_same_suit', points: 5, canUseCentral: false });
  }

  // Under-10
  const hasHigh = hand.some((c) => {
    const v = getRankValue(c.rank);
    return v >= getRankValue(10 as Rank) && v <= getRankValue('K' as Rank);
  });
  if (!hasHigh) results.push({ type: 'B', name: 'under_ten_hand', points: 5, canUseCentral: false });

  return results;
}

// ── Scoring ──

export function calculateScore(playedRecords: PlayRecord[], centralCard: Card, instantWinSets: number, isFourTwos: boolean): number {
  let points = 0;
  const allPlayed = playedRecords.flatMap((r) => r.cards);

  points += allPlayed.filter((c) => c.rank === '2').length;
  points += allPlayed.filter((c) => c.rank === centralCard.rank).length;

  for (const record of playedRecords) {
    if (record.type === 'two_straight_good_pairs') points += 3;
    else if (record.type !== 'pass' && record.type !== 'single') points += 1;
  }

  if (isFourTwos) points += 10;
  else points += instantWinSets * 5;

  if (points === 0) points = 5;
  return points;
}

export function calculatePayout(winnerId: string, players: GamePlayer[], score: number, coinValue: number, isInstantWin: boolean): Record<string, number> {
  const payouts: Record<string, number> = {};
  const baseAmount = score * coinValue;

  for (const player of players) {
    if (player.id === winnerId) {
      payouts[player.id] = 0;
    } else {
      let multiplier = 1;
      if (player.hand.length >= 2) multiplier *= 2;
      if (isInstantWin) multiplier *= 2;
      payouts[player.id] = -(baseAmount * multiplier);
    }
  }

  const totalReceived = Object.values(payouts).filter((v) => v < 0).reduce((sum, v) => sum + Math.abs(v), 0);
  payouts[winnerId] = totalReceived;
  return payouts;
}

// ── Round Logic ──

export function shouldEndRound(roundHistory: PlayRecord[], players: GamePlayer[], lastPlayerId: string): boolean {
  const nonPassPlays = roundHistory.filter((r) => r.type !== 'pass');
  if (nonPassPlays.length === 0) return false;

  const lastNonPass = nonPassPlays[nonPassPlays.length - 1];
  const activePlayers = players.filter((p) => !p.isOut && !p.lockedOut && p.hand.length > 0);
  const others = activePlayers.filter((p) => p.id !== lastNonPass.playerId);

  if (others.length === 0) return true;

  const playedAfterLastPlay = roundHistory.slice(
    roundHistory.lastIndexOf(lastNonPass) + 1
  );

  return others.every((p) => playedAfterLastPlay.some((r) => r.playerId === p.id));
}

export function getNextPlayerIndex(players: GamePlayer[], currentIndex: number): number {
  const n = players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (currentIndex + i) % n;
    const p = players[idx];
    if (!p.isOut && !p.lockedOut && p.hand.length > 0) return idx;
  }
  return currentIndex;
}

// ── Game State Init ──

export function initGameState(players: { id: string; name: string }[], coinValue: number): GameState {
  const deck = shuffle(createDeck());
  const { hands, centralCard } = deal(deck, players.length);

  const gamePlayers: GamePlayer[] = players.map((p, i) => ({
    id: p.id,
    name: p.name,
    hand: hands[i],
    isAI: false as const,
    lockedOut: false,
    cardsPlayed: 0,
    isOut: false,
  }));

  return {
    players: gamePlayers,
    centralCard,
    deck: [],
    // Start at last player so first advanceTurn wraps to player 0
    currentPlayerIndex: gamePlayers.length - 1,
    roundHistory: [],
    currentPlay: null,
    leadingSuit: null,
    gameHistory: [],
    roundLeaderId: null,
    winner: null,
    scores: null,
    payouts: null,
    winDetail: null,
    timer: 30,
  };
}

// ── Process Actions ──

export function processPlay(state: GameState, playerId: string, cardIds: string[]): { error?: string; state?: GameState } {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { error: 'Player not found' };
  if (player.isOut || player.lockedOut) return { error: 'Cannot play — out or locked' };

  const cards = cardIds.map((id) => player.hand.find((c) => c.id === id)).filter(Boolean) as Card[];
  if (cards.length !== cardIds.length) return { error: 'Cards not in hand' };

  const playType = detectPlayType(cards);
  if (!playType) return { error: 'Invalid play' };

  if (!canBeat({ playerId, cards, type: playType }, state.currentPlay)) {
    return { error: 'Cannot beat current play' };
  }

  // Remove cards from hand
  player.hand = player.hand.filter((c) => !cardIds.includes(c.id));
  player.cardsPlayed += cards.length;

  if (player.hand.length === 0) {
    player.isOut = true;
    state.winner = playerId;
  }

  const record: PlayRecord = { playerId, cards, type: playType };
  state.roundHistory.push(record);
  state.gameHistory.push(record);
  state.currentPlay = record;

  // Set leading suit on first play of round
  if (state.leadingSuit === null && cards.length > 0) {
    state.leadingSuit = cards[0].suit;
  }

  return { state };
}

export function processPass(state: GameState, playerId: string): { error?: string; state?: GameState } {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { error: 'Player not found' };
  if (!state.currentPlay || state.currentPlay.type === 'pass') return { error: 'Must lead the round' };

  const record: PlayRecord = { playerId, cards: [], type: 'pass' };
  state.roundHistory.push(record);
  state.gameHistory.push(record);

  // Check if round ends
  if (shouldEndRound(state.roundHistory, state.players, playerId)) {
    const lastNonPass = [...state.roundHistory].reverse().find((r) => r.type !== 'pass');

    // Reset round
    const winnerIndex = state.players.findIndex((p) => p.id === lastNonPass?.playerId);
    state.currentPlayerIndex = winnerIndex >= 0 ? winnerIndex : getNextPlayerIndex(state.players, state.currentPlayerIndex);
    state.roundHistory = [];
    state.currentPlay = null;
    state.leadingSuit = null;
    state.roundLeaderId = lastNonPass?.playerId || null;
  }

  return { state };
}

function buildNormalBreakdown(gameHistory: PlayRecord[], winnerId: string, centralCard: Card) {
  const winnerRecords = gameHistory.filter((r) => r.playerId === winnerId && r.type !== 'pass');
  const twos = winnerRecords.reduce((sum, r) => sum + r.cards.filter((c) => c.rank === '2').length, 0);
  const centralMatches = winnerRecords.reduce(
    (sum, r) => sum + r.cards.filter((c) => c.rank === centralCard.rank).length, 0,
  );
  const setCounts = new Map<string, number>();
  for (const r of winnerRecords) {
    if (r.type !== 'single') {
      setCounts.set(r.type, (setCounts.get(r.type) || 0) + 1);
    }
  }
  const specialSets = Array.from(setCounts.entries()).map(([type, count]) => {
    const pts = type === 'two_straight_good_pairs' ? 3 : 1;
    return { type, count, points: pts * count };
  });
  const zeroPointBonus = twos === 0 && centralMatches === 0 && specialSets.length === 0;
  return { twos, centralMatches, specialSets, zeroPointBonus };
}

export function processInstantWin(state: GameState, playerId: string): { error?: string; state?: GameState } {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { error: 'Player not found' };

  const results = checkInstantWin(player.hand, state.centralCard);
  if (results.length === 0) return { error: 'No instant win available' };

  const isFourTwos = results.some((r) => r.name === 'triple_two' && r.points === 10);
  const score = calculateScore(state.gameHistory, state.centralCard!, results.length, isFourTwos);
  const payouts = calculatePayout(playerId, state.players, score, 0, true);

  state.winner = playerId;
  state.scores = { [playerId]: score };
  state.payouts = payouts;
  state.winDetail = {
    winType: 'instant_win',
    winnerName: player.name,
    winnerId: playerId,
    totalPoints: score,
    instantWinSets: results,
    normalBreakdown: null,
  };

  return { state };
}

export function processNormalWin(state: GameState, playerId: string, coinValue: number): GameState {
  const player = state.players.find((p) => p.id === playerId)!;
  const isFourTwos = false;
  const results: InstantWinResult[] = [];
  const score = calculateScore(state.gameHistory, state.centralCard!, results.length, isFourTwos);
  const payouts = calculatePayout(playerId, state.players, score, coinValue, false);
  const normalBreakdown = buildNormalBreakdown(state.gameHistory, playerId, state.centralCard!);

  state.winner = playerId;
  state.scores = { [playerId]: score };
  state.payouts = payouts;
  state.winDetail = {
    winType: 'normal',
    winnerName: player.name,
    winnerId: playerId,
    totalPoints: score,
    instantWinSets: [],
    normalBreakdown,
  };

  return state;
}
