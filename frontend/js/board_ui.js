import { ShogiBoard, PIECES, PROMOTED, DEMOTED, IS_PROMOTED, CAN_PROMOTE } from './shogi.js';

// ランダム駒プール（OU除く7種）
const ATTACKER_POOL = ['FU','KY','KE','GI','KI','KA','HI'];
// 表示順
const PIECE_BOX_ORDER = ['HI','KA','KI','GI','KE','KY','FU'];

// アプリ全体の状態
const state = {
  board: new ShogiBoard(),
  kingPos: null,
  assignedPieces: {},          // 初期割り当て記録（握り直し・クリア用）
  pool: {},                    // 駒箱：未配置のランダム駒
  selectedPalettePiece: null,  // 駒箱から選択した駒
  selectedAttackerHand: null,  // 先手の駒台から選択した駒
  selectedDefenderHand: null,  // 後手の駒台から選択した駒
  selectedCell: null,          // 盤面で選択中のセル {row, col}
  solution: null,
  solveStatus: 'idle',
  worker: null,
};

// ========== 初期化 ==========

export function init() {
  createWorker();
  attachEventListeners();
  startGame();
}

function createWorker() {
  state.worker = new Worker('/static/js/solver.js', { type: 'module' });
  state.worker.onmessage = (e) => {
    const { found, moves, movesCount, reason } = e.data;
    if (found) {
      state.solution = moves;
      state.solveStatus = 'found';
      updateSolveStatus(`${movesCount}手詰め！解が見つかりました。`);
      document.getElementById('input-board-sfen').value = state.board.toSFEN();
      document.getElementById('input-solution-moves').value = JSON.stringify(moves);
      document.getElementById('input-moves-count').value = moves.length;
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

// ========== ゲーム開始 ==========

function startGame() {
  state.board = new ShogiBoard();
  state.selectedPalettePiece = null;
  state.selectedAttackerHand = null;
  state.selectedDefenderHand = null;
  state.selectedCell = null;
  state.solution = null;
  state.solveStatus = 'idle';
  document.getElementById('submit-btn').disabled = true;
  document.getElementById('solution-display').textContent = '';
  document.getElementById('solve-status').textContent = '';
  placeKingRandomly();
  drawPieces();
  onBoardChanged();
}

// ========== 玉のランダム配置（row 0〜2 = 1〜3段目）==========

function placeKingRandomly() {
  for (let i = 0; i < 100; i++) {
    const row = Math.floor(Math.random() * 3);
    const col = Math.floor(Math.random() * 9);
    if (!state.board.board[row][col]) {
      state.board.board[row][col] = { piece: 'OU', owner: 'defender' };
      state.kingPos = { row, col };
      return;
    }
  }
}

function rerollKing() {
  if (state.kingPos) {
    state.board.board[state.kingPos.row][state.kingPos.col] = null;
  }
  placeKingRandomly();
  onBoardChanged();
}

function isKingCell(row, col) {
  return state.kingPos && state.kingPos.row === row && state.kingPos.col === col;
}

// ========== ランダム駒割り当て ==========

function drawPieces() {
  const count = 3 + Math.floor(Math.random() * 3);  // 3, 4, 5
  const assigned = {};
  for (let i = 0; i < count; i++) {
    const piece = ATTACKER_POOL[Math.floor(Math.random() * ATTACKER_POOL.length)];
    assigned[piece] = (assigned[piece] || 0) + 1;
  }
  state.assignedPieces = { ...assigned };
  state.pool = { ...assigned };          // 駒箱に入れる
  state.board.hands.attacker = {};       // 先手の駒台は空
  state.board.hands.defender = {};       // 後手の駒台は空
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
      if (state.selectedCell?.row === row && state.selectedCell?.col === col) cell.classList.add('selected-cell');

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

// ========== 駒箱（pool）==========

function renderPieceBox() {
  const boxEl = document.getElementById('piece-box-pieces');
  if (!boxEl) return;
  boxEl.innerHTML = '';
  for (const piece of PIECE_BOX_ORDER) {
    const remaining = state.pool[piece] || 0;
    const el = document.createElement('div');
    el.className = 'piece-box-item';
    el.dataset.piece = piece;
    if (remaining > 0) el.classList.add('has-remaining');
    if (state.selectedPalettePiece?.piece === piece) el.classList.add('selected');
    el.textContent = PIECES[piece];
    if (remaining > 0) {
      const badge = document.createElement('span');
      badge.className = 'piece-remaining-badge';
      badge.textContent = remaining;
      el.appendChild(badge);
    }
    el.addEventListener('click', () => {
      if (remaining > 0) selectBoxPiece(piece);
    });
    boxEl.appendChild(el);
  }

  const total = Object.values(state.pool).reduce((a, b) => a + b, 0);
  const label = document.getElementById('pool-remaining-label');
  if (label) {
    label.textContent = total > 0 ? `未配置: ${total}枚` : '配置完了 ✓';
    label.style.color = total > 0 ? '#ffaa44' : '#88ff88';
  }
}

function selectBoxPiece(piece) {
  state.selectedPalettePiece = state.selectedPalettePiece?.piece === piece ? null : { piece };
  state.selectedAttackerHand = null;
  state.selectedDefenderHand = null;
  renderPieceBox();
  renderAttackerHand();
  renderDefenderHand();
}

// ========== 先手の駒台（hands.attacker）==========

function renderAttackerHand() {
  const el = document.getElementById('attacker-hand-pieces');
  if (!el) return;
  el.innerHTML = '';
  const hand = state.board.hands.attacker;
  let hasAny = false;
  for (const piece of PIECE_BOX_ORDER) {
    const count = hand[piece] || 0;
    if (count === 0) continue;
    hasAny = true;
    const item = document.createElement('div');
    item.className = 'attacker-hand-item';
    item.dataset.piece = piece;
    if (state.selectedAttackerHand === piece) item.classList.add('selected');
    item.textContent = PIECES[piece];
    if (count > 1) {
      const badge = document.createElement('span');
      badge.className = 'piece-remaining-badge';
      badge.textContent = count;
      item.appendChild(badge);
    }
    item.addEventListener('click', () => selectAttackerHand(piece));
    item.addEventListener('contextmenu', (e) => { e.preventDefault(); attackerHandToPool(piece); });
    el.appendChild(item);
  }
  const empty = document.getElementById('attacker-hand-empty');
  if (empty) empty.style.display = hasAny ? 'none' : 'block';
}

function selectAttackerHand(piece) {
  // 盤面の駒が選択中なら先手の駒台に移動
  if (state.selectedCell) {
    const { row, col } = state.selectedCell;
    const cell = state.board.board[row][col];
    if (cell) {
      sendToHand({ ...cell, owner: 'attacker' });
      state.board.board[row][col] = null;
    }
    state.selectedCell = null;
    onBoardChanged();
    return;
  }
  state.selectedAttackerHand = state.selectedAttackerHand === piece ? null : piece;
  state.selectedPalettePiece = null;
  state.selectedDefenderHand = null;
  renderPieceBox();
  renderAttackerHand();
  renderDefenderHand();
}

// 先手の駒台 → 駒箱に戻す
function attackerHandToPool(piece) {
  const count = state.board.hands.attacker[piece] || 0;
  if (count > 0) {
    state.board.hands.attacker[piece]--;
    if (state.board.hands.attacker[piece] === 0) delete state.board.hands.attacker[piece];
    state.pool[piece] = (state.pool[piece] || 0) + 1;
    onBoardChanged();
  }
}

// ========== 後手の駒台（hands.defender）==========

function renderDefenderHand() {
  const el = document.getElementById('defender-hand-pieces');
  if (!el) return;
  el.innerHTML = '';
  const hand = state.board.hands.defender;
  let hasAny = false;
  for (const piece of PIECE_BOX_ORDER) {
    const count = hand[piece] || 0;
    if (count === 0) continue;
    hasAny = true;
    const item = document.createElement('div');
    item.className = 'defender-hand-item';
    item.dataset.piece = piece;
    if (state.selectedDefenderHand === piece) item.classList.add('selected');
    item.textContent = PIECES[piece];
    if (count > 1) {
      const badge = document.createElement('span');
      badge.className = 'piece-remaining-badge';
      badge.textContent = count;
      item.appendChild(badge);
    }
    item.addEventListener('click', () => selectDefenderHand(piece));
    item.addEventListener('contextmenu', (e) => { e.preventDefault(); defenderHandToPool(piece); });
    el.appendChild(item);
  }
  const empty = document.getElementById('defender-hand-empty');
  if (empty) empty.style.display = hasAny ? 'none' : 'block';
}

function selectDefenderHand(piece) {
  // 盤面の駒が選択中なら後手の駒台に移動
  if (state.selectedCell) {
    const { row, col } = state.selectedCell;
    const cell = state.board.board[row][col];
    if (cell) {
      sendToHand({ ...cell, owner: 'defender' });
      state.board.board[row][col] = null;
    }
    state.selectedCell = null;
    onBoardChanged();
    return;
  }
  state.selectedDefenderHand = state.selectedDefenderHand === piece ? null : piece;
  state.selectedPalettePiece = null;
  state.selectedAttackerHand = null;
  renderPieceBox();
  renderAttackerHand();
  renderDefenderHand();
}

// 後手の駒台 → 駒箱に戻す
function defenderHandToPool(piece) {
  const count = state.board.hands.defender[piece] || 0;
  if (count > 0) {
    state.board.hands.defender[piece]--;
    if (state.board.hands.defender[piece] === 0) delete state.board.hands.defender[piece];
    state.pool[piece] = (state.pool[piece] || 0) + 1;
    onBoardChanged();
  }
}

// ========== セルクリック ==========

function onCellClick(row, col) {
  if (isKingCell(row, col)) return;
  const current = state.board.board[row][col];

  // 後手の駒台から配置（空マスのみ）
  if (state.selectedDefenderHand) {
    const piece = state.selectedDefenderHand;
    if (!current && (state.board.hands.defender[piece] || 0) > 0) {
      state.board.board[row][col] = { piece, owner: 'defender' };
      state.board.hands.defender[piece]--;
      if (state.board.hands.defender[piece] === 0) delete state.board.hands.defender[piece];
    }
    state.selectedDefenderHand = null;
    onBoardChanged();
    return;
  }

  // 先手の駒台から配置（空マスのみ）
  if (state.selectedAttackerHand) {
    const piece = state.selectedAttackerHand;
    if (!current && (state.board.hands.attacker[piece] || 0) > 0) {
      state.board.board[row][col] = { piece, owner: 'attacker' };
      state.board.hands.attacker[piece]--;
      if (state.board.hands.attacker[piece] === 0) delete state.board.hands.attacker[piece];
    }
    state.selectedAttackerHand = null;
    onBoardChanged();
    return;
  }

  // 盤面の駒が選択中
  if (state.selectedCell) {
    const from = state.selectedCell;
    if (from.row === row && from.col === col) {
      // 同マス再クリック → サイクル
      cyclePiece(row, col);
      state.selectedCell = null;
    } else if (!current) {
      // 空マスクリック → 移動
      state.board.board[row][col] = state.board.board[from.row][from.col];
      state.board.board[from.row][from.col] = null;
      state.selectedCell = null;
    } else {
      // 別の駒クリック → 選択し直し
      state.selectedCell = { row, col };
    }
    onBoardChanged();
    return;
  }

  const selected = state.selectedPalettePiece;

  if (!current) {
    // 空マス：駒箱から先手として配置（poolがある場合のみ）
    if (!selected) return;
    const piece = selected.piece;
    if ((state.pool[piece] || 0) > 0) {
      state.board.board[row][col] = { piece, owner: 'attacker' };
      state.pool[piece]--;
      if (state.pool[piece] === 0) delete state.pool[piece];
      onBoardChanged();
    }
    return;
  }

  // 駒ありマス
  const baseCurrent = IS_PROMOTED.has(current.piece) ? DEMOTED[current.piece] : current.piece;

  if (selected && selected.piece !== baseCurrent) {
    // 異種の駒が選択中 → 差し替え（poolがある場合のみ）
    const piece = selected.piece;
    if ((state.pool[piece] || 0) > 0) {
      sendToHand(current);
      state.board.board[row][col] = { piece, owner: 'attacker' };
      state.pool[piece]--;
      if (state.pool[piece] === 0) delete state.pool[piece];
      onBoardChanged();
    } else {
      // 盤面の駒を選択
      state.selectedCell = { row, col };
      state.selectedPalettePiece = null;
      onBoardChanged();
    }
    return;
  }

  // 駒を選択（1回目）
  state.selectedCell = { row, col };
  state.selectedPalettePiece = null;
  onBoardChanged();
}

// 駒の状態を循環させる（ループ）
function cyclePiece(row, col) {
  const cell = state.board.board[row][col];
  if (!cell) return;
  const { piece, owner } = cell;

  // OU は循環対象外（先手のみ想定、右クリックで削除）
  if (piece === 'OU') return;

  const isPromoted = IS_PROMOTED.has(piece);
  const baseType = isPromoted ? DEMOTED[piece] : piece;
  const canPromote = CAN_PROMOTE.has(baseType);

  if (owner === 'attacker') {
    if (!isPromoted && canPromote) {
      // 先手未成 → 先手成り
      state.board.board[row][col] = { piece: PROMOTED[piece], owner: 'attacker' };
    } else {
      // 先手成り（or 成れない）→ 後手未成
      state.board.board[row][col] = { piece: baseType, owner: 'defender' };
    }
  } else {
    if (!isPromoted && canPromote) {
      // 後手未成 → 後手成り
      state.board.board[row][col] = { piece: PROMOTED[piece], owner: 'defender' };
    } else {
      // 後手成り（or 成れない）→ 先手未成（ループ）
      state.board.board[row][col] = { piece: baseType, owner: 'attacker' };
    }
  }
}

// 右クリックで駒を手駒に戻す
function onCellRightClick(row, col) {
  if (isKingCell(row, col)) return;
  const cell = state.board.board[row][col];
  if (!cell) return;
  sendToHand(cell);
  state.board.board[row][col] = null;
  onBoardChanged();
}

// 駒を適切な手駒へ送る（先手→先手の駒台、後手→後手の駒台）
// OU は持ち駒にできないため駒箱（pool）に戻す
function sendToHand(cell) {
  const baseType = IS_PROMOTED.has(cell.piece) ? DEMOTED[cell.piece] : cell.piece;
  if (baseType === 'OU') {
    // 王将は持ち駒にできないので駒箱に戻す
    state.pool[baseType] = (state.pool[baseType] || 0) + 1;
    return;
  }
  if (cell.owner === 'attacker') {
    state.board.hands.attacker[baseType] = (state.board.hands.attacker[baseType] || 0) + 1;
  } else {
    state.board.hands.defender[baseType] = (state.board.hands.defender[baseType] || 0) + 1;
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
  renderPieceBox();
  renderAttackerHand();
  renderDefenderHand();
  // 駒台クリック時に選択中セルをクリアするため、各hand選択関数からも呼ばれる
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

// ========== 詰み確認 ==========

function checkSolution() {
  state.solveStatus = 'solving';
  updateSolveStatus('探索中...');
  document.getElementById('submit-btn').disabled = true;
  state.board.turn = 'attacker';
  const sfen = state.board.toSFEN();
  state.worker.postMessage({ type: 'solve', boardState: sfen, maxDepth: 9 });
}

// ========== 盤面リセット ==========

function clearBoard() {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (!isKingCell(r, c)) {
        state.board.board[r][c] = null;
      }
    }
  }
  state.pool = { ...state.assignedPieces };
  state.board.hands.attacker = {};
  state.board.hands.defender = {};
  onBoardChanged();
}

// ========== 握り直す ==========

function rerollPieces() {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (!isKingCell(r, c)) {
        state.board.board[r][c] = null;
      }
    }
  }
  state.selectedPalettePiece = null;
  state.selectedAttackerHand = null;
  state.selectedDefenderHand = null;
  drawPieces();
  onBoardChanged();
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
  // 駒台エリア全体クリック（駒のない部分でも選択中セルを手駒に移動できる）
  document.getElementById('attacker-hand').addEventListener('click', (e) => {
    if (!state.selectedCell) return;
    // 駒台アイテムのクリックは各 item の handler に任せる → ここでは h3/empty のみ
    if (e.target.closest('.attacker-hand-item')) return;
    selectAttackerHand(null);
  });
  document.getElementById('defender-hand').addEventListener('click', (e) => {
    if (!state.selectedCell) return;
    if (e.target.closest('.defender-hand-item')) return;
    selectDefenderHand(null);
  });

  document.getElementById('reroll-btn').addEventListener('click', () => {
    if (confirm('玉の位置を再配置しますか？（駒の配置は保持されます）')) {
      rerollKing();
    }
  });

  document.getElementById('reroll-pieces-btn').addEventListener('click', () => {
    if (confirm('駒を握り直しますか？（盤面がリセットされます）')) {
      rerollPieces();
    }
  });

  document.getElementById('solve-btn').addEventListener('click', checkSolution);

  document.getElementById('clear-btn').addEventListener('click', () => {
    if (confirm('盤面をリセットしますか？（割り当て駒は保持されます）')) {
      clearBoard();
    }
  });
}

// DOMContentLoaded で初期化
document.addEventListener('DOMContentLoaded', init);
