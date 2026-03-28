import { ShogiBoard, PIECES, PROMOTED, IS_PROMOTED, CAN_PROMOTE } from './shogi.js';

// 盤面の状態
const state = {
  board: new ShogiBoard(),
  selectedPalettePiece: null,  // {piece, owner} | null
  selectedCell: null,           // {row, col} | null  (盤上の駒を選択)
  selectedHandPiece: null,      // {piece} | null (持ち駒を選択)
  solution: null,               // 探索結果 [{move...}] | null
  solveStatus: 'idle',          // 'idle' | 'solving' | 'found' | 'not_found'
  worker: null,
};

// 初期化
export function init() {
  renderBoard();
  renderPalette();
  renderHands();
  attachEventListeners();
  createWorker();
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

// 盤面描画
function renderBoard() {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '';
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.row = row;
      cell.dataset.col = col;

      // 敵陣ハイライト（攻め方の成り可能ゾーン row 0-2）
      if (row <= 2) cell.classList.add('enemy-zone');

      // セル内の駒
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

// 駒要素を作成
function createPieceEl(piece, owner) {
  const el = document.createElement('div');
  el.className = `piece ${owner}`;
  if (IS_PROMOTED.has(piece)) el.classList.add('promoted');
  // 駒名表示: 通常駒は漢字1文字、成り駒は2文字
  el.textContent = PIECES[piece];
  return el;
}

// パレット描画（攻め方の駒一覧）
function renderPalette() {
  // 攻め方パレット
  const attackerPieces = ['FU','KY','KE','GI','KI','KA','HI','OU','TO','NY','NK','NG','UM','RY'];
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

  // 守り方パレット（玉のみ + 配置可能な駒）
  const defenderPieces = ['FU','KY','KE','GI','KI','KA','HI','OU'];
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

// パレットの駒を選択
function selectPalettePiece(piece, owner) {
  state.selectedPalettePiece = { piece, owner };
  state.selectedCell = null;
  state.selectedHandPiece = null;
  updateSelectionHighlight();
}

// 持ち駒エリア描画
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
    if (count > 0) {
      el.style.opacity = '1';
      el.addEventListener('click', () => selectHandPiece(piece));
    } else {
      el.style.opacity = '0.3';
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

// セルクリック処理
function onCellClick(row, col) {
  const currentPiece = state.board.board[row][col];

  // パレットから駒を配置
  if (state.selectedPalettePiece) {
    // 既存の駒は削除して新しい駒を配置（上書き）
    if (currentPiece) {
      // 盤から取り除く（持ち駒には加えない）
    }
    state.board.board[row][col] = {
      piece: state.selectedPalettePiece.piece,
      owner: state.selectedPalettePiece.owner
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

  // 盤上の駒を選択・移動（編集モードなので単純に移動）
  if (state.selectedCell) {
    const from = state.selectedCell;
    const fromPiece = state.board.board[from.row][from.col];
    if (fromPiece) {
      // 移動先の駒があれば持ち駒（攻め方）に戻す
      if (currentPiece) {
        // 単純な盤面編集なので持ち駒管理はスキップ
      }
      state.board.board[row][col] = fromPiece;
      state.board.board[from.row][from.col] = null;
    }
    state.selectedCell = null;
    onBoardChanged();
    return;
  }

  // 駒を選択
  if (currentPiece) {
    state.selectedCell = { row, col };
    updateSelectionHighlight();
  }
}

// 右クリックで駒削除（持ち駒に戻す）
function onCellRightClick(row, col) {
  const piece = state.board.board[row][col];
  if (piece) {
    // 攻め方の駒は持ち駒に戻す（成り前に戻す）
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

// 盤面変更後の処理
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
  document.querySelectorAll('.cell').forEach(cell => {
    cell.classList.remove('selected-cell');
  });
  if (state.selectedCell) {
    const idx = state.selectedCell.row * 9 + state.selectedCell.col;
    const cells = document.querySelectorAll('.cell');
    if (cells[idx]) cells[idx].classList.add('selected-cell');
  }

  // パレット選択ハイライト
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

// 解の手順を文字列にフォーマット
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

// イベントリスナー
function attachEventListeners() {
  // 詰み確認ボタン
  document.getElementById('solve-btn').addEventListener('click', () => {
    state.solveStatus = 'solving';
    updateSolveStatus('探索中...');
    document.getElementById('submit-btn').disabled = true;

    state.board.turn = 'attacker';
    const sfen = state.board.toSFEN();
    state.worker.postMessage({ type: 'solve', boardState: sfen, maxDepth: 9 });
  });

  // クリアボタン
  document.getElementById('clear-btn').addEventListener('click', () => {
    if (confirm('盤面をクリアしますか？')) {
      state.board = new ShogiBoard();
      onBoardChanged();
    }
  });

  // 投稿フォームのsubmit前処理（htmxイベント）
  // htmx:configRequest 時点でパラメータを直接上書きする
  document.getElementById('submit-form').addEventListener('htmx:configRequest', (e) => {
    e.detail.parameters['board_sfen'] = state.board.toSFEN();
    e.detail.parameters['solution_moves'] = JSON.stringify(state.solution || []);
    e.detail.parameters['moves_count'] = state.solution ? state.solution.length : 0;
  });
}

// DOMContentLoaded で初期化
document.addEventListener('DOMContentLoaded', init);
