import { ShogiBoard, PIECES, PROMOTED, IS_PROMOTED, CAN_PROMOTE } from './shogi.js';

// ティアごとに玉を配置できる row の最大値
// row 0 = 1段目, row 2 = 3段目, row 5 = 6段目, row 8 = 9段目
const TIER_MAX_ROW = { 1: 2, 2: 5, 3: 8 };
const TIER_BONUS   = { 1: 0, 2: 30, 3: 70 };
const TIER_LABEL   = { 1: 'ティア1（1〜3段目）', 2: 'ティア2（1〜6段目）', 3: 'ティア3（1〜9段目）' };

// アプリ全体の状態
const state = {
  board: new ShogiBoard(),
  tier: null,              // 1 | 2 | 3
  kingPos: null,           // {row, col} — ランダム配置後ロック
  selectedPalettePiece: null,
  selectedCell: null,
  selectedHandPiece: null,
  solution: null,
  solveStatus: 'idle',     // 'idle' | 'solving' | 'found' | 'not_found'
  worker: null,
};

// ========== 初期化 ==========

export function init() {
  renderPalette();
  createWorker();
  attachEventListeners();
  showTierSelect();          // 最初はティア選択画面を表示
}

function createWorker() {
  state.worker = new Worker('/static/js/solver.js', { type: 'module' });
  state.worker.onmessage = (e) => {
    const { found, moves, movesCount, reason } = e.data;
    if (found) {
      state.solution = moves;
      state.solveStatus = 'found';
      updateSolveStatus(`${movesCount}手詰め！解が見つかりました。`);
      document.getElementById('submit-btn').disabled = false;
      document.getElementById('solution-display').textContent = formatSolution(moves);
    } else {
      state.solution = null;
      state.solveStatus = 'not_found';
      updateSolveStatus(reason === 'timeout' ? '探索上限に達しました（計算困難）' : '不詰（9手以内に詰みなし）');
      document.getElementById('submit-btn').disabled = true;
    }
  };
}

// ========== ティア選択 ==========

function showTierSelect() {
  document.getElementById('tier-select-screen').style.display = 'block';
  document.getElementById('game-screen').style.display = 'none';
}

function startGame(tier) {
  state.tier = tier;
  state.board = new ShogiBoard();
  placeKingRandomly(tier);

  document.getElementById('tier-select-screen').style.display = 'none';
  document.getElementById('game-screen').style.display = 'block';
  document.getElementById('current-tier-label').textContent = TIER_LABEL[tier];

  onBoardChanged();
}

// ========== 玉のランダム配置 ==========

function placeKingRandomly(tier) {
  const maxRow = TIER_MAX_ROW[tier];
  // 空きマスに玉を置く（最大100回リトライ）
  for (let i = 0; i < 100; i++) {
    const row = Math.floor(Math.random() * (maxRow + 1));
    const col = Math.floor(Math.random() * 9);
    if (!state.board.board[row][col]) {
      state.board.board[row][col] = { piece: 'OU', owner: 'defender' };
      state.kingPos = { row, col };
      return;
    }
  }
}

function rerollKing() {
  if (!state.tier) return;
  // 盤上の attacker 駒は保持、defender の玉だけ再配置
  if (state.kingPos) {
    state.board.board[state.kingPos.row][state.kingPos.col] = null;
  }
  // defender の全駒を削除してから玉を再配置
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (state.board.board[r][c]?.owner === 'defender') {
        state.board.board[r][c] = null;
      }
    }
  }
  placeKingRandomly(state.tier);
  onBoardChanged();
}

function isKingCell(row, col) {
  return state.kingPos && state.kingPos.row === row && state.kingPos.col === col;
}

// ========== 盤面描画 ==========

function renderBoard() {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '';
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.row = row;
      cell.dataset.col = col;

      if (row <= 2) cell.classList.add('enemy-zone');
      if (isKingCell(row, col)) cell.classList.add('king-cell');

      const piece = state.board.board[row][col];
      if (piece) {
        cell.appendChild(createPieceEl(piece.piece, piece.owner));
      }

      cell.addEventListener('click', () => onCellClick(row, col));
      cell.addEventListener('contextmenu', (e) => { e.preventDefault(); onCellRightClick(row, col); });
      boardEl.appendChild(cell);
    }
  }
}

function createPieceEl(piece, owner) {
  const el = document.createElement('div');
  el.className = `piece ${owner}`;
  if (IS_PROMOTED.has(piece)) el.classList.add('promoted');
  el.textContent = PIECES[piece];
  return el;
}

// ========== 駒パレット ==========

function renderPalette() {
  // 攻め方パレット（OU除く — 問題上ありえるが通常は不要）
  const attackerPieces = ['FU','KY','KE','GI','KI','KA','HI','TO','NY','NK','NG','UM','RY'];
  const attackerGrid = document.getElementById('palette-attacker');
  attackerGrid.innerHTML = '';
  for (const piece of attackerPieces) {
    const el = document.createElement('div');
    el.className = 'palette-piece';
    el.textContent = PIECES[piece];
    el.title = PIECES[piece] + '（攻め方）';
    el.addEventListener('click', () => selectPalettePiece(piece, 'attacker'));
    attackerGrid.appendChild(el);
  }

  // 受け方パレット（玉除く — 玉はランダム配置済み）
  const defenderPieces = ['FU','KY','KE','GI','KI','KA','HI'];
  const defenderGrid = document.getElementById('palette-defender');
  defenderGrid.innerHTML = '';
  for (const piece of defenderPieces) {
    const el = document.createElement('div');
    el.className = 'palette-piece defender-piece';
    el.textContent = PIECES[piece];
    el.title = PIECES[piece] + '（受け方）';
    el.addEventListener('click', () => selectPalettePiece(piece, 'defender'));
    defenderGrid.appendChild(el);
  }
}

function selectPalettePiece(piece, owner) {
  state.selectedPalettePiece = { piece, owner };
  state.selectedCell = null;
  state.selectedHandPiece = null;
  updateSelectionHighlight();
}

// ========== 持ち駒 ==========

function renderHands() {
  const handEl = document.getElementById('hand-pieces-attacker');
  handEl.innerHTML = '';
  const hand = state.board.hands.attacker;
  const pieces = ['HI','KA','KI','GI','KE','KY','FU'];
  for (const piece of pieces) {
    const count = hand[piece] || 0;
    const el = document.createElement('div');
    el.className = 'hand-piece';
    el.textContent = PIECES[piece];
    const countEl = document.createElement('span');
    countEl.className = 'count';
    countEl.textContent = count > 0 ? count : '';
    el.appendChild(countEl);
    el.style.opacity = count > 0 ? '1' : '0.3';
    if (count > 0) {
      el.addEventListener('click', () => selectHandPiece(piece));
    }
    handEl.appendChild(el);
  }
}

function selectHandPiece(piece) {
  state.selectedHandPiece = piece;
  state.selectedPalettePiece = null;
  state.selectedCell = null;
  updateSelectionHighlight();
}

// ========== セルクリック ==========

function onCellClick(row, col) {
  // 玉マスへの上書き・移動は禁止
  if (isKingCell(row, col) && !state.selectedCell) {
    // 玉マス自体を選択しようとした場合も何もしない
    state.selectedPalettePiece = null;
    state.selectedHandPiece = null;
    return;
  }

  const currentPiece = state.board.board[row][col];

  // パレットから配置
  if (state.selectedPalettePiece) {
    if (isKingCell(row, col)) return; // 玉マスには置けない
    state.board.board[row][col] = {
      piece: state.selectedPalettePiece.piece,
      owner: state.selectedPalettePiece.owner,
    };
    onBoardChanged();
    return;
  }

  // 持ち駒から打ち込む
  if (state.selectedHandPiece) {
    if (!currentPiece) {
      const count = state.board.hands.attacker[state.selectedHandPiece] || 0;
      if (count > 0) {
        state.board.board[row][col] = { piece: state.selectedHandPiece, owner: 'attacker' };
        state.board.hands.attacker[state.selectedHandPiece]--;
      }
    }
    state.selectedHandPiece = null;
    onBoardChanged();
    return;
  }

  // 盤上の駒を移動（編集モード）
  if (state.selectedCell) {
    const from = state.selectedCell;
    if (from.row === row && from.col === col) {
      // 同じマスを再クリック → 選択解除
      state.selectedCell = null;
      updateSelectionHighlight();
      return;
    }
    if (isKingCell(row, col)) {
      // 玉マスへの移動禁止
      state.selectedCell = null;
      updateSelectionHighlight();
      return;
    }
    const fromPiece = state.board.board[from.row][from.col];
    if (fromPiece) {
      state.board.board[row][col] = fromPiece;
      state.board.board[from.row][from.col] = null;
    }
    state.selectedCell = null;
    onBoardChanged();
    return;
  }

  // 駒を選択（玉マスは選択不可）
  if (currentPiece && !isKingCell(row, col)) {
    state.selectedCell = { row, col };
    updateSelectionHighlight();
  }
}

// 右クリックで駒削除（玉マスは削除不可）
function onCellRightClick(row, col) {
  if (isKingCell(row, col)) return;
  const piece = state.board.board[row][col];
  if (piece) {
    if (piece.owner === 'attacker') {
      const basePiece = IS_PROMOTED.has(piece.piece)
        ? { TO:'FU', NY:'KY', NK:'KE', NG:'GI', UM:'KA', RY:'HI' }[piece.piece]
        : piece.piece;
      if (basePiece !== 'OU') {
        state.board.hands.attacker[basePiece] = (state.board.hands.attacker[basePiece] || 0) + 1;
      }
    }
    state.board.board[row][col] = null;
    onBoardChanged();
  }
}

// ========== 状態変化後の処理 ==========

function onBoardChanged() {
  state.solution = null;
  state.solveStatus = 'idle';
  document.getElementById('submit-btn').disabled = true;
  document.getElementById('solution-display').textContent = '';
  updateSolveStatus('');
  renderBoard();
  renderHands();
  updateSelectionHighlight();
}

function updateSelectionHighlight() {
  document.querySelectorAll('.cell').forEach(cell => cell.classList.remove('selected-cell'));
  if (state.selectedCell) {
    const idx = state.selectedCell.row * 9 + state.selectedCell.col;
    const cells = document.querySelectorAll('.cell');
    if (cells[idx]) cells[idx].classList.add('selected-cell');
  }
  document.querySelectorAll('.palette-piece').forEach(el => el.classList.remove('selected'));
}

function updateSolveStatus(msg) {
  const el = document.getElementById('solve-status');
  el.textContent = msg;
  if (state.solveStatus === 'solving') {
    el.classList.add('solving');
  } else {
    el.classList.remove('solving');
  }
}

// ========== 手順フォーマット ==========

function formatSolution(moves) {
  if (!moves || moves.length === 0) return '';
  return moves.map((m, i) => {
    const mover = i % 2 === 0 ? '▲' : '△';
    const to = `${9 - m.to.col}${m.to.row + 1}`;
    const pieceName = PIECES[m.piece] || m.piece;
    const drop = m.drop ? '打' : '';
    const prom = m.promote ? '成' : '';
    return `${mover}${to}${pieceName}${drop}${prom}`;
  }).join(' ');
}

// ========== イベントリスナー ==========

function attachEventListeners() {
  // ティア選択ボタン
  document.querySelectorAll('.tier-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tier = parseInt(btn.dataset.tier);
      startGame(tier);
    });
  });

  // 玉の再配置ボタン
  document.getElementById('reroll-btn').addEventListener('click', () => {
    if (confirm('玉の位置を再配置しますか？（攻め駒は保持されます）')) {
      rerollKing();
    }
  });

  // ティア変更ボタン
  document.getElementById('change-tier-btn').addEventListener('click', () => {
    showTierSelect();
  });

  // 詰み確認ボタン
  document.getElementById('solve-btn').addEventListener('click', () => {
    state.solveStatus = 'solving';
    updateSolveStatus('探索中...');
    document.getElementById('submit-btn').disabled = true;
    state.board.turn = 'attacker';
    const sfen = state.board.toSFEN();
    state.worker.postMessage({ type: 'solve', boardState: sfen, maxDepth: 9 });
  });

  // クリアボタン（玉は保持、攻め駒のみ削除）
  document.getElementById('clear-btn').addEventListener('click', () => {
    if (confirm('攻め駒をクリアしますか？（玉の位置は保持されます）')) {
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          if (!isKingCell(r, c)) {
            const piece = state.board.board[r][c];
            if (piece?.owner === 'attacker') {
              state.board.board[r][c] = null;
            } else if (piece?.owner === 'defender' && piece.piece !== 'OU') {
              state.board.board[r][c] = null;
            }
          }
        }
      }
      state.board.hands = { attacker: {}, defender: {} };
      onBoardChanged();
    }
  });

  // 投稿フォームのsubmit前処理
  document.getElementById('submit-form').addEventListener('htmx:configRequest', (e) => {
    e.detail.parameters['board_sfen'] = state.board.toSFEN();
    e.detail.parameters['solution_moves'] = JSON.stringify(state.solution || []);
    e.detail.parameters['moves_count'] = state.solution ? state.solution.length : 0;
    e.detail.parameters['tier'] = state.tier || 1;
  });
}

// DOMContentLoaded で初期化
document.addEventListener('DOMContentLoaded', init);
