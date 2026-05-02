'use strict';

const STORAGE_KEY = 'pes-tournament-app-v1';
const DEFAULT_PLAYERS = ['Emin', 'Ruhi', 'Xəyal', 'Vüsal', 'Elvin', 'Ərəstun', 'Fərman'];

const TOURNAMENT_TYPES = {
  'round-robin': {
    label: 'Hamı bir-biri ilə',
    desc: 'Random komandalar, hər oyunda yeni bölgü. Qalib — ən çox xal toplayan oyuncu.',
    icon: '🔁',
  },
  'knockout': {
    label: 'Uduzanın çıxması',
    desc: 'Klassik kubok sistemi (1v1). Sistem rəqibləri qarışıq bölür, uduzan çıxır.',
    icon: '🏆',
  },
};

const FORMATS = {
  '2v2': { label: 'Cüt-cüt (2v2)', desc: 'Hər komandada 2 oyuncu, məs. Emin+Ruhi vs Fərman+Xəyal', minPlayers: 4 },
  '1v1': { label: 'Tək-tək (1v1)', desc: 'Klassik düello — hər tərəfdə 1 oyuncu', minPlayers: 2 },
};

const state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.players) && Array.isArray(parsed.tournaments)) {
        parsed.tournaments.forEach(t => {
          if (!t.format) t.format = '1v1';
          // Migrate old fixed-teams 2v2 knockout → schedule-based
          const isOldFixed = t.format === '2v2' && t.type === 'knockout' &&
            (t.teams || t.matches.some(m => m.from || m.isBye || (m.teamA && !Array.isArray(m.teamA))));
          if (isOldFixed) {
            t.matches = generateRoundRobin2v2(t.players);
            delete t.teams;
            delete t.reserve;
          }
        });
        // Drop stale draft fields from older versions
        if (parsed.setupDraft) {
          delete parsed.setupDraft.knockoutTeams;
          delete parsed.setupDraft.knockoutReserve;
        }
        return {
          players: parsed.players,
          tournaments: parsed.tournaments,
          activeTournamentId: parsed.activeTournamentId || null,
          activeTab: parsed.activeTab || 'players',
          setupDraft: parsed.setupDraft || null,
        };
      }
    }
  } catch (_) {}
  return {
    players: [...DEFAULT_PLAYERS],
    tournaments: [],
    activeTournamentId: null,
    activeTab: 'players',
    setupDraft: null,
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid() { return Math.random().toString(36).slice(2, 10); }

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Match generation ────────────────────────────────────────────────────────
function generateRoundRobin1v1(players) {
  const list = players.slice();
  if (list.length % 2 === 1) list.push(null);
  const n = list.length;
  const matches = [];
  for (let r = 0; r < n - 1; r++) {
    for (let i = 0; i < n / 2; i++) {
      const p1 = list[i];
      const p2 = list[n - 1 - i];
      if (p1 !== null && p2 !== null) {
        matches.push({
          id: uid(),
          round: r + 1,
          player1: p1,
          player2: p2,
          score1: null,
          score2: null,
        });
      }
    }
    const last = list[n - 1];
    for (let j = n - 1; j > 1; j--) list[j] = list[j - 1];
    list[1] = last;
  }
  return matches;
}

// Generates a 2v2 schedule where every pair of players is BOTH partners
// at least once AND opponents at least once. For n=7 this produces ~11 matches.
function generateRoundRobin2v2(players) {
  const n = players.length;
  if (n < 4) return [];

  const allPairs = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      allPairs.push([players[i], players[j]]);

  const pairKey = (a, b) => [a, b].sort().join('|');
  const partnerCount = {};
  const opponentCount = {};
  const playCount = Object.fromEntries(players.map(p => [p, 0]));
  const incP = k => partnerCount[k] = (partnerCount[k] || 0) + 1;
  const incO = k => opponentCount[k] = (opponentCount[k] || 0) + 1;
  const gP = k => partnerCount[k] || 0;
  const gO = k => opponentCount[k] || 0;

  const matches = [];

  // Phase 1: cover every partnership at least once.
  // Pick (pair1, pair2) disjoint such that pair1 is unused as partners; score
  // each candidate by (a) how many new partnerships it adds, (b) how many new
  // opponent pairs it introduces, (c) how balanced play counts stay.
  let safety = 200;
  while (allPairs.some(p => gP(pairKey(p[0], p[1])) === 0) && safety-- > 0) {
    const unused = shuffle(allPairs.filter(p => gP(pairKey(p[0], p[1])) === 0));
    let best = null, bestScore = -Infinity;
    for (const pair1 of unused.slice(0, 6)) {
      const cands = shuffle(allPairs.filter(p => !pair1.includes(p[0]) && !pair1.includes(p[1])));
      for (const pair2 of cands.slice(0, 12)) {
        const partnersAlreadyUsed =
          (gP(pairKey(pair1[0], pair1[1])) > 0 ? 1 : 0) +
          (gP(pairKey(pair2[0], pair2[1])) > 0 ? 1 : 0);
        let newOpp = 0;
        for (const a of pair1) for (const b of pair2) {
          if (gO(pairKey(a, b)) === 0) newOpp++;
        }
        const playSum = [...pair1, ...pair2].reduce((s, p) => s + playCount[p], 0);
        const score = -partnersAlreadyUsed * 1000 + newOpp * 10 - playSum + Math.random();
        if (score > bestScore) { bestScore = score; best = [pair1, pair2]; }
      }
    }
    if (!best) break;
    const [p1, p2] = best;
    matches.push({
      id: uid(),
      round: matches.length + 1,
      teamA: shuffle(p1.slice()),
      teamB: shuffle(p2.slice()),
      scoreA: null,
      scoreB: null,
    });
    incP(pairKey(p1[0], p1[1]));
    incP(pairKey(p2[0], p2[1]));
    for (const a of p1) for (const b of p2) incO(pairKey(a, b));
    [...p1, ...p2].forEach(p => playCount[p]++);
  }

  // Phase 2: cover any opponent pair still missing.
  safety = 50;
  while (allPairs.some(p => gO(pairKey(p[0], p[1])) === 0) && safety-- > 0) {
    const missing = allPairs.find(p => gO(pairKey(p[0], p[1])) === 0);
    const others = players
      .filter(p => !missing.includes(p))
      .sort((a, b) => playCount[a] - playCount[b] || Math.random() - 0.5);
    const x = others[0], y = others[1];
    if (!x || !y) break;
    const teamA = [missing[0], x];
    const teamB = [missing[1], y];
    matches.push({
      id: uid(),
      round: matches.length + 1,
      teamA: shuffle(teamA),
      teamB: shuffle(teamB),
      scoreA: null,
      scoreB: null,
    });
    incP(pairKey(teamA[0], teamA[1]));
    incP(pairKey(teamB[0], teamB[1]));
    for (const a of teamA) for (const b of teamB) incO(pairKey(a, b));
    [...teamA, ...teamB].forEach(p => playCount[p]++);
  }

  return matches;
}

function generateKnockout1v1(players) {
  const shuffled = shuffle(players);
  let bracketSize = 1;
  while (bracketSize < shuffled.length) bracketSize *= 2;
  const slots = shuffled.slice();
  while (slots.length < bracketSize) slots.push(null);

  const matches = [];
  let prevRoundIds = [];
  let roundNum = 1;

  for (let i = 0; i < bracketSize; i += 2) {
    const p1 = slots[i], p2 = slots[i + 1];
    const isBye = p1 === null || p2 === null;
    const winner = isBye ? (p1 || p2) : null;
    const m = {
      id: uid(),
      round: 1,
      player1: p1,
      player2: p2,
      score1: null,
      score2: null,
      winner,
      isBye,
      from: null,
    };
    matches.push(m);
    prevRoundIds.push(m.id);
  }

  while (prevRoundIds.length > 1) {
    roundNum++;
    const nextIds = [];
    for (let i = 0; i < prevRoundIds.length; i += 2) {
      const fromA = matches.find(x => x.id === prevRoundIds[i]);
      const fromB = matches.find(x => x.id === prevRoundIds[i + 1]);
      const m = {
        id: uid(),
        round: roundNum,
        player1: fromA.winner || null,
        player2: fromB.winner || null,
        score1: null,
        score2: null,
        winner: null,
        isBye: false,
        from: [fromA.id, fromB.id],
      };
      matches.push(m);
      nextIds.push(m.id);
    }
    prevRoundIds = nextIds;
  }

  matches.forEach(m => {
    if (m.from) {
      const a = matches.find(x => x.id === m.from[0]);
      const b = matches.find(x => x.id === m.from[1]);
      m.player1 = a.winner;
      m.player2 = b.winner;
    }
  });

  return matches;
}

// ─── Tournament data helpers ─────────────────────────────────────────────────
function getCurrentTournament() {
  return state.tournaments.find(t => t.id === state.activeTournamentId) || null;
}

function groupByRound(matches) {
  const map = new Map();
  matches.forEach(m => {
    if (!map.has(m.round)) map.set(m.round, []);
    map.get(m.round).push(m);
  });
  return [...map.keys()].sort((a, b) => a - b).map(r => ({ round: r, matches: map.get(r) }));
}

function matchSides(t, m) {
  if (t.format === '2v2') {
    return {
      sideA: m.teamA || [],
      sideB: m.teamB || [],
      scoreA: m.scoreA,
      scoreB: m.scoreB,
      fieldA: 'scoreA',
      fieldB: 'scoreB',
    };
  }
  return {
    sideA: m.player1 != null ? [m.player1] : [],
    sideB: m.player2 != null ? [m.player2] : [],
    scoreA: m.score1,
    scoreB: m.score2,
    fieldA: 'score1',
    fieldB: 'score2',
  };
}

function isMatchPlayed(t, m) {
  const s = matchSides(t, m);
  return s.scoreA != null && s.scoreB != null;
}

function restingPlayers(t, m) {
  if (t.format !== '2v2') return [];
  const playing = new Set([...(m.teamA || []), ...(m.teamB || [])]);
  return t.players.filter(p => !playing.has(p));
}

function computeStandings(t) {
  const stats = {};
  t.players.forEach(p => {
    stats[p] = { player: p, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, pts: 0 };
  });
  t.matches.forEach(m => {
    const s = matchSides(t, m);
    if (s.scoreA == null || s.scoreB == null) return;
    const apply = (player, my, opp) => {
      const st = stats[player];
      if (!st) return;
      st.played++;
      st.gf += my; st.ga += opp;
      if (my > opp)      { st.won++; st.pts += 3; }
      else if (my < opp) { st.lost++; }
      else               { st.drawn++; st.pts += 1; }
    };
    s.sideA.forEach(p => apply(p, s.scoreA, s.scoreB));
    s.sideB.forEach(p => apply(p, s.scoreB, s.scoreA));
  });
  return Object.values(stats)
    .map(s => ({ ...s, gd: s.gf - s.ga }))
    .sort((a, b) =>
      b.pts - a.pts ||
      b.gd - a.gd ||
      b.gf - a.gf ||
      a.player.localeCompare(b.player, 'az')
    );
}

function knockoutRoundLabel(roundIdx, totalRounds) {
  const fromEnd = totalRounds - 1 - roundIdx;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Yarımfinal';
  if (fromEnd === 2) return 'Çeyrək final';
  if (fromEnd === 3) return '1/8 final';
  if (fromEnd === 4) return '1/16 final';
  return `${roundIdx + 1}-ci tur`;
}

function knockoutPropagate(tournament, matchId) {
  const m = tournament.matches.find(x => x.id === matchId);
  if (!m) return;

  if (m.score1 != null && m.score2 != null && m.score1 !== m.score2) {
    m.winner = m.score1 > m.score2 ? m.player1 : m.player2;
  } else {
    m.winner = null;
  }

  const dependent = tournament.matches.find(x => x.from && x.from.includes(m.id));
  if (!dependent) return;
  const idx = dependent.from.indexOf(m.id);
  const oldPlayer = idx === 0 ? dependent.player1 : dependent.player2;
  const newPlayer = m.winner;
  if (oldPlayer !== newPlayer) {
    if (idx === 0) dependent.player1 = newPlayer;
    else dependent.player2 = newPlayer;
    dependent.score1 = null;
    dependent.score2 = null;
    dependent.winner = null;
    knockoutPropagate(tournament, dependent.id);
  }
}

function knockoutChampion(tournament) {
  const last = [...tournament.matches].sort((a, b) => b.round - a.round)[0];
  return last && last.winner ? last.winner : null;
}

// ─── DOM utilities ───────────────────────────────────────────────────────────
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

function setTab(tab) {
  state.activeTab = tab;
  saveState();
  render();
}

function render() {
  $$('#tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === state.activeTab));
  $$('.panel').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== state.activeTab));

  renderPlayersPanel();
  renderSetupPanel();
  renderActivePanel();
}

// ─── Players panel ───────────────────────────────────────────────────────────
function renderPlayersPanel() {
  const panel = $('[data-panel="players"]');
  const players = state.players;

  panel.innerHTML = `
    <div class="grid gap-5">
      <div class="card">
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 class="section-title">Oyuncular</h2>
            <p class="section-sub">Çempionatlara qoşulacaq oyuncuları idarə et. <span class="kbd">Enter</span> ilə əlavə et.</p>
          </div>
          <div class="flex items-center gap-2">
            <span class="label-pill zinc">${players.length} oyuncu</span>
          </div>
        </div>

        <div class="divider"></div>

        <form id="addPlayerForm" class="flex gap-2 flex-wrap">
          <input id="newPlayerInput" class="input flex-1 min-w-[14rem]" type="text" placeholder="Oyuncu adı (məs. Emin)" autocomplete="off" />
          <button type="submit" class="btn btn-primary">+ Əlavə et</button>
          ${players.length === 0 ? `<button type="button" id="loadDefaultBtn" class="btn btn-secondary">Default 7 oyuncunu yüklə</button>` : ''}
        </form>

        <div class="divider"></div>

        ${players.length === 0 ? `
          <div class="empty-state">
            <div class="icon">⚽</div>
            <h3>Hələ oyuncu yoxdur</h3>
            <p>Yuxarıdan ad daxil edib oyuncu əlavə et və ya defaultdakı 7 oyuncunu yüklə.</p>
          </div>
        ` : `
          <div class="flex flex-wrap gap-2">
            ${players.map(p => `
              <div class="player-chip" data-player="${escapeHtml(p)}">
                <span class="avatar">${escapeHtml(initials(p))}</span>
                <span>${escapeHtml(p)}</span>
                <button class="btn-ghost ml-1 remove-player" data-player="${escapeHtml(p)}" title="Sil" aria-label="Sil">✕</button>
              </div>
            `).join('')}
          </div>
        `}
      </div>

      ${players.length >= 2 ? `
        <div class="card card-tight flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div class="font-semibold text-sm">Oyuncular hazırdır</div>
            <div class="section-sub">İndi yeni çempionat yarada bilərsən.</div>
          </div>
          <button class="btn btn-primary" id="goToSetupBtn">Yeni çempionat →</button>
        </div>
      ` : ''}
    </div>
  `;

  $('#addPlayerForm').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('#newPlayerInput');
    const name = input.value.trim();
    if (!name) return;
    if (state.players.some(p => p.toLowerCase() === name.toLowerCase())) {
      input.classList.add('!border-red-500');
      setTimeout(() => input.classList.remove('!border-red-500'), 800);
      return;
    }
    state.players.push(name);
    saveState();
    renderPlayersPanel();
    renderSetupPanel();
    setTimeout(() => $('#newPlayerInput')?.focus(), 0);
  });

  $$('.remove-player').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.player;
      if (!confirm(`"${name}" oyuncusu silinsin? Mövcud çempionatlar dəyişməyəcək.`)) return;
      state.players = state.players.filter(p => p !== name);
      saveState();
      renderPlayersPanel();
      renderSetupPanel();
    });
  });

  $('#loadDefaultBtn')?.addEventListener('click', () => {
    state.players = [...DEFAULT_PLAYERS];
    saveState();
    renderPlayersPanel();
    renderSetupPanel();
  });

  $('#goToSetupBtn')?.addEventListener('click', () => setTab('setup'));

  $('#newPlayerInput')?.focus();
}

// ─── Setup panel ─────────────────────────────────────────────────────────────
function getSetupDraft() {
  if (!state.setupDraft) {
    state.setupDraft = {
      name: '',
      type: 'round-robin',
      format: '2v2',
      selectedPlayers: [...state.players],
    };
  }
  state.setupDraft.selectedPlayers = state.setupDraft.selectedPlayers.filter(p => state.players.includes(p));
  if (!state.setupDraft.format) state.setupDraft.format = state.setupDraft.type === 'knockout' ? '1v1' : '2v2';
  return state.setupDraft;
}

function renderSetupPanel() {
  const panel = $('[data-panel="setup"]');
  if (state.players.length < 2) {
    panel.innerHTML = `
      <div class="card">
        <div class="empty-state">
          <div class="icon">👥</div>
          <h3>Ən az 2 oyuncu lazımdır</h3>
          <p>Çempionat yaratmaq üçün əvvəlcə oyuncu əlavə et.</p>
          <button class="btn btn-primary mt-4" id="goToPlayersBtn">Oyuncular bölməsinə keç</button>
        </div>
      </div>
    `;
    $('#goToPlayersBtn')?.addEventListener('click', () => setTab('players'));
    return;
  }

  const draft = getSetupDraft();

  const formatAvailable = true; // both types support 1v1 and 2v2 now
  const minForFormat = FORMATS[draft.format].minPlayers;
  const enoughPlayers = draft.selectedPlayers.length >= minForFormat;

  // Info
  let info = '';
  if (draft.format === '2v2') {
    const n = draft.selectedPlayers.length;
    const totalPairs = n >= 2 ? (n * (n - 1)) / 2 : 0;
    const estMatches = Math.ceil(totalPairs / 2);
    const modeLabel = draft.type === 'knockout' ? '2v2 — uduzan çıxır (xal yox)' : '2v2 — xal sistemi';
    info = `
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="label-pill green">${modeLabel}</span>
          <span class="text-zinc-400">${n} oyuncu</span>
          <span class="text-zinc-700">·</span>
          <span class="text-zinc-400">~${estMatches} oyun</span>
          ${n > 4 ? `<span class="text-zinc-700">·</span><span class="text-amber-300/80">hər oyunda ${n - 4} nəfər dincələcək</span>` : ''}
        </div>
        <div class="text-xs text-zinc-500">Hər oyunda komandalar random bölünəcək. Hər oyuncu digər ${n - 1} nəfərlə həm partnyor, həm rəqib olacaq.</div>
      </div>
    `;
  } else if (draft.type === 'round-robin' && draft.format === '1v1') {
    const n = draft.selectedPlayers.length;
    const total = n >= 2 ? (n * (n - 1)) / 2 : 0;
    info = `
      <div class="flex items-center gap-2 flex-wrap">
        <span class="label-pill green">1v1 round-robin</span>
        <span class="text-zinc-400">${n} oyuncu</span>
        <span class="text-zinc-700">·</span>
        <span class="text-zinc-400">${total} oyun</span>
        ${n % 2 === 1 ? `<span class="text-zinc-700">·</span><span class="text-amber-300/80">tək saydır — hər turda 1 nəfər istirahət edir</span>` : ''}
      </div>
    `;
  } else {
    const n = draft.selectedPlayers.length;
    let bs = 1; while (bs < n) bs *= 2;
    let r = 0, x = bs; while (x > 1) { x /= 2; r++; }
    const byes = Math.max(0, bs - n);
    info = `
      <div class="flex items-center gap-2 flex-wrap">
        <span class="label-pill green">1v1 uduzan çıxır</span>
        <span class="text-zinc-400">${n} oyuncu</span>
        <span class="text-zinc-700">·</span>
        <span class="text-zinc-400">${r} tur</span>
        ${byes > 0 ? `<span class="text-zinc-700">·</span><span class="text-amber-300/80">${byes} bye (avtomatik keçid)</span>` : ''}
      </div>
    `;
  }

  panel.innerHTML = `
    <div class="grid gap-5">
      <div class="card">
        <h2 class="section-title">Yeni çempionat</h2>
        <p class="section-sub">Növ seç, oyuncuları işarələ və yarat.</p>

        <div class="divider"></div>

        <div class="grid gap-5">
          <div>
            <label class="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Çempionat adı</label>
            <input id="tournamentName" class="input" type="text" placeholder="məs. Mart Liqası" value="${escapeHtml(draft.name)}" />
          </div>

          <div>
            <label class="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Çempionat növü</label>
            <div class="grid sm:grid-cols-2 gap-3">
              ${Object.entries(TOURNAMENT_TYPES).map(([key, t]) => `
                <div class="radio-card ${draft.type === key ? 'selected' : ''}" data-type="${key}">
                  <div class="flex items-center gap-2">
                    <span class="text-lg">${t.icon}</span>
                    <span class="title">${t.label}</span>
                  </div>
                  <div class="desc">${t.desc}</div>
                </div>
              `).join('')}
            </div>
          </div>

          ${formatAvailable ? `
          <div>
            <label class="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Komanda formatı</label>
            <div class="grid sm:grid-cols-2 gap-3">
              ${Object.entries(FORMATS).map(([key, f]) => `
                <div class="radio-card ${draft.format === key ? 'selected' : ''}" data-format="${key}">
                  <div class="title">${f.label}</div>
                  <div class="desc">${f.desc}</div>
                </div>
              `).join('')}
            </div>
          </div>
          ` : ''}

          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">İştirakçılar</label>
              <div class="flex gap-2 text-xs">
                <button id="selectAllBtn" type="button" class="text-zinc-400 hover:text-zinc-200">Hamısını seç</button>
                <span class="text-zinc-700">·</span>
                <button id="selectNoneBtn" type="button" class="text-zinc-400 hover:text-zinc-200">Heç biri</button>
              </div>
            </div>
            <div class="grid sm:grid-cols-2 md:grid-cols-3 gap-2">
              ${state.players.map(p => {
                const checked = draft.selectedPlayers.includes(p);
                return `
                  <label class="checkbox-row ${checked ? 'checked' : ''}" data-player="${escapeHtml(p)}">
                    <input type="checkbox" ${checked ? 'checked' : ''} />
                    <span class="avatar-mini">${escapeHtml(initials(p))}</span>
                    <span class="text-sm font-medium">${escapeHtml(p)}</span>
                  </label>
                `;
              }).join('')}
            </div>
          </div>

          <div class="card-tight rounded-lg bg-zinc-900/50 border border-zinc-800 text-sm">
            ${info}
            ${!enoughPlayers ? `<div class="mt-2 text-amber-300/80 text-xs">Bu format üçün ən az ${minForFormat} oyuncu lazımdır.</div>` : ''}
          </div>

          <div class="flex flex-wrap items-center gap-3 justify-end">
            <button id="cancelDraftBtn" type="button" class="btn btn-secondary">Sıfırla</button>
            <button id="createTournamentBtn" type="button" class="btn btn-primary" ${!enoughPlayers ? 'disabled' : ''}>Çempionatı yarat →</button>
          </div>
        </div>
      </div>
    </div>
  `;

  $('#tournamentName').addEventListener('input', e => {
    draft.name = e.target.value;
    saveState();
  });

  $$('.radio-card[data-type]').forEach(el => {
    el.addEventListener('click', () => {
      draft.type = el.dataset.type;
      saveState();
      renderSetupPanel();
    });
  });

  $$('.radio-card[data-format]').forEach(el => {
    el.addEventListener('click', () => {
      draft.format = el.dataset.format;
      saveState();
      renderSetupPanel();
    });
  });

  $$('.checkbox-row').forEach(el => {
    el.addEventListener('click', e => {
      const name = el.dataset.player;
      const isChecked = draft.selectedPlayers.includes(name);
      if (isChecked) draft.selectedPlayers = draft.selectedPlayers.filter(p => p !== name);
      else draft.selectedPlayers.push(name);
      saveState();
      renderSetupPanel();
      e.preventDefault();
    });
  });

  $('#selectAllBtn').addEventListener('click', () => {
    draft.selectedPlayers = [...state.players];
    saveState();
    renderSetupPanel();
  });
  $('#selectNoneBtn').addEventListener('click', () => {
    draft.selectedPlayers = [];
    saveState();
    renderSetupPanel();
  });

  $('#cancelDraftBtn').addEventListener('click', () => {
    state.setupDraft = null;
    saveState();
    renderSetupPanel();
  });

  $('#createTournamentBtn').addEventListener('click', () => {
    if (draft.selectedPlayers.length < FORMATS[draft.format].minPlayers) return;
    const name = (draft.name || '').trim() || defaultTournamentName(draft.type, draft.format);
    let matches;
    if (draft.format === '2v2') {
      matches = generateRoundRobin2v2(draft.selectedPlayers);
    } else if (draft.type === 'round-robin') {
      matches = generateRoundRobin1v1(draft.selectedPlayers);
    } else {
      matches = generateKnockout1v1(draft.selectedPlayers);
    }
    const tournament = {
      id: uid(),
      name,
      type: draft.type,
      format: draft.format,
      players: [...draft.selectedPlayers],
      matches,
      createdAt: Date.now(),
    };
    state.tournaments.push(tournament);
    state.activeTournamentId = tournament.id;
    state.setupDraft = null;
    saveState();
    setTab('active');
  });
}

function defaultTournamentName(type, format) {
  const d = new Date();
  const months = ['Yanvar','Fevral','Mart','Aprel','May','İyun','İyul','Avqust','Sentyabr','Oktyabr','Noyabr','Dekabr'];
  const prefix = type === 'round-robin' ? (format === '2v2' ? 'Liqa 2v2' : 'Liqa 1v1') : 'Kubok';
  return `${prefix} · ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// ─── Active panel ────────────────────────────────────────────────────────────
function renderActivePanel() {
  const panel = $('[data-panel="active"]');
  if (state.tournaments.length === 0) {
    panel.innerHTML = `
      <div class="card">
        <div class="empty-state">
          <div class="icon">🏆</div>
          <h3>Hələ çempionat yoxdur</h3>
          <p>Yeni çempionat yaratdıqdan sonra cədvəl və nəticələr burada görünəcək.</p>
          <button class="btn btn-primary mt-4" id="goCreateBtn">Yeni çempionat yarat</button>
        </div>
      </div>
    `;
    $('#goCreateBtn')?.addEventListener('click', () => setTab('setup'));
    return;
  }

  const current = getCurrentTournament() || state.tournaments[state.tournaments.length - 1];
  state.activeTournamentId = current.id;

  const formatLabel = current.format === '2v2' ? '2v2' : (current.type === 'knockout' ? '1v1 Kubok' : '1v1');

  panel.innerHTML = `
    <div class="grid gap-5">
      <div class="card">
        <div class="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <span class="label-pill green">${TOURNAMENT_TYPES[current.type].icon} ${TOURNAMENT_TYPES[current.type].label}</span>
              <span class="label-pill zinc">${formatLabel}</span>
              <span class="label-pill zinc">${current.players.length} oyuncu</span>
              <span class="label-pill zinc">${current.matches.length} oyun</span>
            </div>
            <h2 class="section-title mt-2">${escapeHtml(current.name)}</h2>
            <p class="section-sub">Yaradılıb: ${formatDate(current.createdAt)}</p>
          </div>
          <div class="flex items-center gap-2">
            ${current.format === '2v2' ? `<button class="btn btn-secondary" id="reshuffleBtn">🎲 Yenidən bölüşdür</button>` : ''}
            <button class="btn btn-secondary" id="resetTournamentBtn">Nəticələri sıfırla</button>
            <button class="btn btn-danger" id="deleteTournamentBtn">Sil</button>
          </div>
        </div>

        ${state.tournaments.length > 1 ? `
          <div class="divider"></div>
          <div>
            <div class="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Çempionatlar</div>
            <div class="flex flex-wrap gap-2">
              ${state.tournaments.map(t => `
                <button class="tournament-pill ${t.id === current.id ? 'active' : ''}" data-tid="${t.id}">
                  <span class="dot"></span>
                  <span>${escapeHtml(t.name)}</span>
                </button>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>

      ${current.format === '2v2' ? render2v2View(current) : (current.type === 'round-robin' ? renderRoundRobinView(current) : renderKnockoutView(current))}
    </div>
  `;

  $$('.tournament-pill').forEach(el => {
    el.addEventListener('click', () => {
      state.activeTournamentId = el.dataset.tid;
      saveState();
      renderActivePanel();
    });
  });

  $('#resetTournamentBtn').addEventListener('click', () => {
    if (!confirm('Bütün nəticələr sıfırlansın?')) return;
    current.matches.forEach(m => {
      if (current.format === '2v2') {
        m.scoreA = null; m.scoreB = null;
      } else {
        m.score1 = null; m.score2 = null;
      }
      if (current.type === 'knockout' && current.format !== '2v2') {
        if (!m.isBye) m.winner = null;
        if (m.from) { m.player1 = null; m.player2 = null; }
      }
    });
    if (current.type === 'knockout' && current.format !== '2v2') {
      current.matches.filter(m => m.round === 1).forEach(m => knockoutPropagate(current, m.id));
    }
    saveState();
    renderActivePanel();
  });

  $('#deleteTournamentBtn').addEventListener('click', () => {
    if (!confirm(`"${current.name}" çempionatı silinsin?`)) return;
    state.tournaments = state.tournaments.filter(t => t.id !== current.id);
    state.activeTournamentId = state.tournaments.length ? state.tournaments[state.tournaments.length - 1].id : null;
    saveState();
    renderActivePanel();
  });

  $('#reshuffleBtn')?.addEventListener('click', () => {
    if (!confirm('Yeni random bölgü yaradılsın? Hesablar silinəcək.')) return;
    current.matches = generateRoundRobin2v2(current.players);
    saveState();
    renderActivePanel();
  });

  bindMatchInputs(current);
}

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('az-AZ', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Round-robin view ────────────────────────────────────────────────────────
function renderRoundRobinView(t) {
  const standings = computeStandings(t);
  const playedCount = t.matches.filter(m => isMatchPlayed(t, m)).length;
  const matchesHTML = t.format === '2v2'
    ? render2v2MatchesList(t)
    : render1v1MatchesList(t);

  return `
    <div class="grid lg:grid-cols-[1fr_1.4fr] gap-5">
      <div class="card">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="section-title">Turnir cədvəli</h3>
            <p class="section-sub" id="playedCounter">${playedCount}/${t.matches.length} oyun oynandı</p>
          </div>
          ${playedCount === t.matches.length && t.matches.length > 0 ? `<span class="label-pill green">🥇 ${escapeHtml(standings[0].player)}</span>` : ''}
        </div>
        <div class="divider"></div>
        <div class="overflow-x-auto">
          <table class="standings-table">
            <thead>
              <tr>
                <th class="pos">#</th>
                <th class="player-cell" style="text-align:left;">Oyuncu</th>
                <th title="Oynadığı">O</th>
                <th title="Qalibiyyət">Q</th>
                <th title="Heç-heçə">H</th>
                <th title="Məğlubiyyət">M</th>
                <th title="Vurulan">V</th>
                <th title="Buraxılan">B</th>
                <th title="Fərq">F</th>
                <th class="pts">XAL</th>
              </tr>
            </thead>
            <tbody id="standingsBody">
              ${renderStandingsRows(standings)}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h3 class="section-title">Oyunlar</h3>
        <p class="section-sub">Hesabı yaz — cədvəl avtomatik yenilənəcək.</p>
        <div class="divider"></div>
        ${matchesHTML}
      </div>
    </div>
  `;
}

function renderStandingsRows(standings, showPoints = true) {
  return standings.map((s, i) => `
    <tr class="top-${i + 1}">
      <td class="pos">${i + 1}</td>
      <td class="player-cell">
        <span class="inline-flex items-center gap-2">
          <span class="avatar-mini">${escapeHtml(initials(s.player))}</span>
          <span>${escapeHtml(s.player)}</span>
        </span>
      </td>
      <td>${s.played}</td>
      <td>${s.won}</td>
      <td>${s.drawn}</td>
      <td>${s.lost}</td>
      <td>${s.gf}</td>
      <td>${s.ga}</td>
      <td>${s.gd > 0 ? '+' + s.gd : s.gd}</td>
      ${showPoints ? `<td class="pts">${s.pts}</td>` : ''}
    </tr>
  `).join('');
}

function render1v1MatchesList(t) {
  const rounds = groupByRound(t.matches);
  return `
    <div class="grid gap-5" id="roundsContainer">
      ${rounds.map(({ round, matches }) => `
        <div data-round="${round}">
          <div class="flex items-center gap-2 mb-2">
            <span class="label-pill zinc">Tur ${round}</span>
            <span class="text-xs text-zinc-500 round-counter">${matches.filter(m => isMatchPlayed(t, m)).length}/${matches.length} oynanıb</span>
          </div>
          <div class="grid gap-2">
            ${matches.map(m => renderMatchRow(t, m)).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function render2v2MatchesList(t) {
  return `
    <div class="grid gap-2" id="matchesList">
      ${t.matches.map((m, i) => renderMatch2v2(t, m, i + 1)).join('')}
    </div>
  `;
}

function renderMatchRow(t, m) {
  const s = matchSides(t, m);
  const played = s.scoreA != null && s.scoreB != null;
  const wA = played && s.scoreA > s.scoreB;
  const wB = played && s.scoreB > s.scoreA;
  const p1 = s.sideA[0], p2 = s.sideB[0];
  return `
    <div class="match-row ${played ? 'played' : ''}" data-mid="${m.id}">
      <div class="name name-left ${wA ? 'winner' : (wB ? 'loser' : '')}">
        <span class="inline-flex items-center gap-2 justify-end w-full">
          <span>${escapeHtml(p1)}</span>
          <span class="avatar-mini">${escapeHtml(initials(p1))}</span>
        </span>
      </div>
      <div class="scoreboard">
        <input type="number" min="0" max="99" class="score-input" data-mid="${m.id}" data-side="A" value="${s.scoreA ?? ''}" placeholder="–" />
        <span class="vs">:</span>
        <input type="number" min="0" max="99" class="score-input" data-mid="${m.id}" data-side="B" value="${s.scoreB ?? ''}" placeholder="–" />
      </div>
      <div class="name name-right ${wB ? 'winner' : (wA ? 'loser' : '')}">
        <span class="inline-flex items-center gap-2">
          <span class="avatar-mini">${escapeHtml(initials(p2))}</span>
          <span>${escapeHtml(p2)}</span>
        </span>
      </div>
    </div>
  `;
}

function renderMatch2v2(t, m, num) {
  const played = m.scoreA != null && m.scoreB != null;
  const wA = played && m.scoreA > m.scoreB;
  const wB = played && m.scoreB > m.scoreA;
  const resting = restingPlayers(t, m);

  const teamHTML = (players, isLeft, win, lose) => {
    const align = isLeft ? 'items-end text-right' : 'items-start text-left';
    return `
      <div class="team-cell ${win ? 'winner' : (lose ? 'loser' : '')}">
        <div class="flex flex-col ${align} gap-1">
          ${players.map(p => `
            <span class="inline-flex items-center gap-2 ${isLeft ? 'flex-row' : 'flex-row-reverse'}">
              <span class="font-semibold">${escapeHtml(p)}</span>
              <span class="avatar-mini">${escapeHtml(initials(p))}</span>
            </span>
          `).join('')}
        </div>
      </div>
    `;
  };

  return `
    <div class="match-2v2 ${played ? 'played' : ''}" data-mid="${m.id}">
      <div class="match-2v2-head">
        <span class="label-pill zinc">Oyun ${num}</span>
        ${resting.length > 0 ? `<span class="text-xs text-zinc-500">Dincələn: ${resting.map(escapeHtml).join(', ')}</span>` : ''}
      </div>
      <div class="match-2v2-body">
        ${teamHTML(m.teamA, true, wA, wB)}
        <div class="scoreboard">
          <input type="number" min="0" max="99" class="score-input" data-mid="${m.id}" data-side="A" value="${m.scoreA ?? ''}" placeholder="–" />
          <span class="vs">:</span>
          <input type="number" min="0" max="99" class="score-input" data-mid="${m.id}" data-side="B" value="${m.scoreB ?? ''}" placeholder="–" />
        </div>
        ${teamHTML(m.teamB, false, wB, wA)}
      </div>
    </div>
  `;
}

// ─── 2v2 view (round-robin AND knockout share the same schedule) ────────────
function render2v2View(t) {
  const standings = computeStandings(t);
  const playedCount = t.matches.filter(m => isMatchPlayed(t, m)).length;
  const matchesHTML = render2v2MatchesList(t);
  const isKnockout = t.type === 'knockout';
  const allDone = playedCount === t.matches.length && t.matches.length > 0;

  const ranking = isKnockout ? rankByWins(standings) : standings;
  const top = allDone ? ranking[0] : null;
  const bottom = allDone ? ranking[ranking.length - 1] : null;

  const headerBadge = top
    ? (isKnockout
        ? `<span class="label-pill green">🏆 ${escapeHtml(top.player)}</span>`
        : `<span class="label-pill green">🥇 ${escapeHtml(top.player)}</span>`)
    : '';

  return `
    <div class="grid lg:grid-cols-[1fr_1.4fr] gap-5">
      <div class="card">
        <div class="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 class="section-title">${isKnockout ? 'Sıralama' : 'Turnir cədvəli'}</h3>
            <p class="section-sub" id="playedCounter">${playedCount}/${t.matches.length} oyun oynandı</p>
          </div>
          ${headerBadge}
        </div>
        <div class="divider"></div>
        <div class="overflow-x-auto">
          <table class="standings-table">
            <thead>
              <tr>
                <th class="pos">#</th>
                <th class="player-cell" style="text-align:left;">Oyuncu</th>
                <th title="Oynadığı">O</th>
                <th title="Qalibiyyət">Q</th>
                <th title="Heç-heçə">H</th>
                <th title="Məğlubiyyət">M</th>
                <th title="Vurulan">V</th>
                <th title="Buraxılan">B</th>
                <th title="Fərq">F</th>
                ${isKnockout ? '' : '<th class="pts">XAL</th>'}
              </tr>
            </thead>
            <tbody id="standingsBody">
              ${renderStandingsRows(ranking, !isKnockout)}
            </tbody>
          </table>
        </div>
        ${isKnockout && bottom ? `
          <div class="mt-4 p-3 rounded-lg bg-red-950/20 border border-red-900/40 flex items-center gap-3 text-sm">
            <span class="text-lg">❌</span>
            <span>Uduzan: <span class="font-semibold text-red-300">${escapeHtml(bottom.player)}</span> <span class="text-zinc-500">(${bottom.lost} məğlubiyyət, ${bottom.won} qalibiyyət)</span></span>
          </div>
        ` : ''}
      </div>

      <div class="card">
        <h3 class="section-title">Oyunlar</h3>
        <p class="section-sub">Hər oyunda komandalar random bölünüb. Hesabı yaz — sıralama avtomatik yenilənəcək.</p>
        <div class="divider"></div>
        ${matchesHTML}
      </div>
    </div>
  `;
}

function rankByWins(standings) {
  return [...standings].sort((a, b) =>
    b.won - a.won ||
    a.lost - b.lost ||
    b.gd - a.gd ||
    b.gf - a.gf ||
    a.player.localeCompare(b.player, 'az')
  );
}

// ─── Knockout (1v1) view ─────────────────────────────────────────────────────
function renderKnockoutView(t) {
  const rounds = groupByRound(t.matches);
  const champion = knockoutChampion(t);

  return `
    <div class="card">
      <div class="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 class="section-title">Kubok cədvəli</h3>
          <p class="section-sub">Hər oyunda hesabı doldur, qalib avtomatik növbəti tura keçəcək.</p>
        </div>
        ${champion ? `<span class="label-pill green">🏆 Çempion: ${escapeHtml(champion)}</span>` : ''}
      </div>
      <div class="divider"></div>
      <div class="grid gap-5 md:gap-6 overflow-x-auto" style="grid-template-columns: repeat(${rounds.length}, minmax(14rem, 1fr));">
        ${rounds.map(({ round, matches }, idx) => `
          <div>
            <div class="mb-3 flex items-center justify-center">
              <span class="label-pill zinc">${knockoutRoundLabel(idx, rounds.length)}</span>
            </div>
            <div class="grid gap-3" style="align-content: space-around; min-height: 100%;">
              ${matches.map(m => renderBracketMatch(m)).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderBracketMatch(m) {
  const played = m.score1 != null && m.score2 != null;
  const w1 = m.winner && m.winner === m.player1;
  const w2 = m.winner && m.winner === m.player2;
  const ready = m.player1 != null && m.player2 != null && !m.isBye;
  const isBye = m.isBye;

  const sideHTML = (player, score, side, win, lose, ph) => `
    <div class="bracket-side ${win ? 'win' : ''} ${lose ? 'lose' : ''}">
      <span class="truncate ${player == null ? 'ph' : ''}">${player == null ? ph : escapeHtml(player)}</span>
      ${ready ? `<input type="number" min="0" max="99" class="score-input" data-mid="${m.id}" data-side="${side}" value="${score ?? ''}" placeholder="–" />`
        : (player != null ? `<span class="text-xs text-zinc-500">bye</span>` : '')}
    </div>
  `;

  const ph1 = m.from ? `Qalib · ${m.from[0].slice(0, 4)}` : 'Müəyyən deyil';
  const ph2 = m.from ? `Qalib · ${m.from[1].slice(0, 4)}` : 'Müəyyən deyil';

  return `
    <div class="bracket-match ${m.winner ? 'decided' : ''} ${isBye ? 'bye' : ''}" data-mid="${m.id}">
      ${sideHTML(m.player1, m.score1, 1, w1, played && !w1, ph1)}
      <div class="h-px bg-zinc-800"></div>
      ${sideHTML(m.player2, m.score2, 2, w2, played && !w2, ph2)}
    </div>
  `;
}

// ─── Match input wiring ──────────────────────────────────────────────────────
function bindMatchInputs(tournament) {
  $$('.score-input').forEach(input => {
    input.addEventListener('input', () => onScoreInput(tournament, input));
    input.addEventListener('blur', () => onScoreCommit(tournament, input));
  });
}

function parseScore(val) {
  if (val === '' || val == null) return null;
  const n = parseInt(val, 10);
  if (isNaN(n) || n < 0) return null;
  return Math.min(n, 99);
}

function onScoreInput(tournament, input) {
  const mid = input.dataset.mid;
  const side = input.dataset.side;
  const m = tournament.matches.find(x => x.id === mid);
  if (!m) return;
  const val = parseScore(input.value);

  if (tournament.format === '2v2') {
    if (side === 'A') m.scoreA = val;
    else m.scoreB = val;
  } else {
    if (side === '1' || side === 'A') m.score1 = val;
    else m.score2 = val;
  }
  saveState();

  // For both round-robin AND knockout 2v2, the standings/ranking refreshes live.
  // Only 1v1 knockout uses the bracket-propagation path.
  if (tournament.format === '2v2' || tournament.type === 'round-robin') {
    refreshStandingsLive(tournament);
    refreshMatchVisualState(tournament, m);
  }
}

function onScoreCommit(tournament, input) {
  const mid = input.dataset.mid;
  const m = tournament.matches.find(x => x.id === mid);
  if (!m) return;
  // Only 1v1 knockout propagates winners through a bracket.
  if (tournament.type === 'knockout' && tournament.format !== '2v2') {
    const prevWinner = m.winner;
    knockoutPropagate(tournament, m.id);
    saveState();
    if (m.winner !== prevWinner) renderActivePanel();
    else refreshBracketMatchState(m);
  }
}

function refreshStandingsLive(tournament) {
  const tbody = $('#standingsBody');
  if (!tbody) return;
  const isKnockout2v2 = tournament.format === '2v2' && tournament.type === 'knockout';
  const standings = computeStandings(tournament);
  const ranking = isKnockout2v2 ? rankByWins(standings) : standings;
  tbody.innerHTML = renderStandingsRows(ranking, !isKnockout2v2);

  const playedCounter = $('#playedCounter');
  const playedCount = tournament.matches.filter(m => isMatchPlayed(tournament, m)).length;
  if (playedCounter) playedCounter.textContent = `${playedCount}/${tournament.matches.length} oyun oynandı`;

  // 1v1: per-round counters
  $$('#roundsContainer > div').forEach(div => {
    const roundN = parseInt(div.dataset.round, 10);
    const roundMatches = tournament.matches.filter(mm => mm.round === roundN);
    const played = roundMatches.filter(mm => isMatchPlayed(tournament, mm)).length;
    const counter = div.querySelector('.round-counter');
    if (counter) counter.textContent = `${played}/${roundMatches.length} oynanıb`;
  });
}

function refreshMatchVisualState(t, m) {
  const played = isMatchPlayed(t, m);
  // 1v1 row
  const row = document.querySelector(`.match-row[data-mid="${m.id}"]`);
  if (row) {
    row.classList.toggle('played', played);
    const left = row.querySelector('.name-left');
    const right = row.querySelector('.name-right');
    if (left && right) {
      left.classList.remove('winner', 'loser');
      right.classList.remove('winner', 'loser');
      const s = matchSides(t, m);
      if (played) {
        if (s.scoreA > s.scoreB) { left.classList.add('winner'); right.classList.add('loser'); }
        else if (s.scoreB > s.scoreA) { right.classList.add('winner'); left.classList.add('loser'); }
      }
    }
  }
  // 2v2 card
  const card = document.querySelector(`.match-2v2[data-mid="${m.id}"]`);
  if (card) {
    card.classList.toggle('played', played);
    const teams = card.querySelectorAll('.team-cell');
    if (teams.length >= 2) {
      teams[0].classList.remove('winner', 'loser');
      teams[1].classList.remove('winner', 'loser');
      if (played) {
        if (m.scoreA > m.scoreB) { teams[0].classList.add('winner'); teams[1].classList.add('loser'); }
        else if (m.scoreB > m.scoreA) { teams[1].classList.add('winner'); teams[0].classList.add('loser'); }
      }
    }
  }
}

function refreshBracketMatchState(m) {
  const card = document.querySelector(`.bracket-match[data-mid="${m.id}"]`);
  if (!card) return;
  card.classList.toggle('decided', !!m.winner);
  const sides = card.querySelectorAll('.bracket-side');
  if (sides.length < 2) return;
  const played = m.score1 != null && m.score2 != null;
  const w1 = m.winner && m.winner === m.player1;
  const w2 = m.winner && m.winner === m.player2;
  sides[0].classList.toggle('win', !!w1);
  sides[0].classList.toggle('lose', played && !w1 && !!m.winner);
  sides[1].classList.toggle('win', !!w2);
  sides[1].classList.toggle('lose', played && !w2 && !!m.winner);
}

// ─── Init ────────────────────────────────────────────────────────────────────
function init() {
  $$('#tabs .tab').forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));
  render();
}

document.addEventListener('DOMContentLoaded', init);
