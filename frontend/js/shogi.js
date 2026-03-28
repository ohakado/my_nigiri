// shogi.js - 将棋コアロジック（ES Module）

// 定数
export const PIECES = {
  FU: '歩', KY: '香', KE: '桂', GI: '銀', KI: '金',
  KA: '角', HI: '飛', OU: '玉',
  TO: 'と', NY: '成香', NK: '成桂', NG: '成銀', UM: '馬', RY: '竜'
};
export const PROMOTED = { FU: 'TO', KY: 'NY', KE: 'NK', GI: 'NG', KA: 'UM', HI: 'RY' };
export const DEMOTED = { TO: 'FU', NY: 'KY', NK: 'KE', NG: 'GI', UM: 'KA', RY: 'HI' };
export const CAN_PROMOTE = new Set(['FU', 'KY', 'KE', 'GI', 'KA', 'HI']);
export const IS_PROMOTED = new Set(['TO', 'NY', 'NK', 'NG', 'UM', 'RY']);

// SFEN変換マップ（大文字 = attacker, 小文字 = defender）
const SFEN_MAP = { FU: 'P', KY: 'L', KE: 'N', GI: 'S', KI: 'G', KA: 'B', HI: 'R', OU: 'K' };
const SFEN_REVERSE = { P: 'FU', L: 'KY', N: 'KE', S: 'GI', G: 'KI', B: 'KA', R: 'HI', K: 'OU' };

// ヘルパー関数
function inBoard(row, col) {
  return row >= 0 && row <= 8 && col >= 0 && col <= 8;
}

function opponent(owner) {
  return owner === 'attacker' ? 'defender' : 'attacker';
}

function demoted(piece) {
  return DEMOTED[piece] || piece;
}

function fwdOf(owner) {
  return owner === 'attacker' ? -1 : 1;
}

// 敵陣判定
function isEnemyZone(owner, row) {
  if (owner === 'attacker') return row <= 2;   // row 0,1,2
  return row >= 6;                              // row 6,7,8
}

// 行き所のない駒判定（打てない段）
function hasNoWhere(owner, piece, row) {
  if (owner === 'attacker') {
    if (piece === 'FU' || piece === 'KY') return row === 0;
    if (piece === 'KE') return row === 0 || row === 1;
  } else {
    if (piece === 'FU' || piece === 'KY') return row === 8;
    if (piece === 'KE') return row === 8 || row === 7;
  }
  return false;
}

// 必須成り判定
function mustPromote(owner, piece, toRow) {
  if (owner === 'attacker') {
    if (piece === 'FU' || piece === 'KY') return toRow === 0;
    if (piece === 'KE') return toRow === 0 || toRow === 1;
  } else {
    if (piece === 'FU' || piece === 'KY') return toRow === 8;
    if (piece === 'KE') return toRow === 8 || toRow === 7;
  }
  return false;
}

export class ShogiBoard {
  constructor() {
    this.board = Array.from({ length: 9 }, () => Array(9).fill(null));
    this.hands = { attacker: {}, defender: {} };
    this.turn = 'attacker';
  }

  clone() {
    const nb = new ShogiBoard();
    nb.board = this.board.map(row => row.map(cell => cell ? { ...cell } : null));
    nb.hands = {
      attacker: { ...this.hands.attacker },
      defender: { ...this.hands.defender }
    };
    nb.turn = this.turn;
    return nb;
  }

  /**
   * 駒の利き計算
   * 戻り値: [{row, col}, ...] 盤内の利きマス
   * スライド系は途中に駒があれば含めてstop
   */
  getAttacks(piece, row, col, owner) {
    const fwd = fwdOf(owner);
    const result = [];

    const addSlide = (dr, dc) => {
      let r = row + dr, c = col + dc;
      while (inBoard(r, c)) {
        result.push({ row: r, col: c });
        if (this.board[r][c] !== null) break; // 駒があれば止まる
        r += dr;
        c += dc;
      }
    };

    const addStep = (dr, dc) => {
      const r = row + dr, c = col + dc;
      if (inBoard(r, c)) result.push({ row: r, col: c });
    };

    switch (piece) {
      case 'FU':
        addStep(fwd, 0);
        break;

      case 'KY':
        addSlide(fwd, 0);
        break;

      case 'KE':
        addStep(fwd * 2, -1);
        addStep(fwd * 2, 1);
        break;

      case 'GI':
        addStep(fwd, -1);
        addStep(fwd, 0);
        addStep(fwd, 1);
        addStep(-fwd, -1);
        addStep(-fwd, 1);
        break;

      case 'KI':
      case 'TO':
      case 'NY':
      case 'NK':
      case 'NG':
        addStep(fwd, -1);
        addStep(fwd, 0);
        addStep(fwd, 1);
        addStep(0, -1);
        addStep(0, 1);
        addStep(-fwd, 0);
        break;

      case 'KA':
        addSlide(-1, -1);
        addSlide(-1, 1);
        addSlide(1, -1);
        addSlide(1, 1);
        break;

      case 'HI':
        addSlide(-1, 0);
        addSlide(1, 0);
        addSlide(0, -1);
        addSlide(0, 1);
        break;

      case 'UM':
        addSlide(-1, -1);
        addSlide(-1, 1);
        addSlide(1, -1);
        addSlide(1, 1);
        addStep(-1, 0);
        addStep(1, 0);
        addStep(0, -1);
        addStep(0, 1);
        break;

      case 'RY':
        addSlide(-1, 0);
        addSlide(1, 0);
        addSlide(0, -1);
        addSlide(0, 1);
        addStep(-1, -1);
        addStep(-1, 1);
        addStep(1, -1);
        addStep(1, 1);
        break;

      case 'OU':
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr !== 0 || dc !== 0) addStep(dr, dc);
          }
        }
        break;
    }

    return result;
  }

  /**
   * owner側の玉が王手されているか
   */
  isInCheck(owner) {
    // 玉の位置を探す
    let kingRow = -1, kingCol = -1;
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const cell = this.board[r][c];
        if (cell && cell.owner === owner && cell.piece === 'OU') {
          kingRow = r;
          kingCol = c;
          break;
        }
      }
      if (kingRow !== -1) break;
    }
    if (kingRow === -1) return false; // 玉がない（通常はありえない）

    const opp = opponent(owner);
    // 相手の全駒の利きに玉がいるか確認
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const cell = this.board[r][c];
        if (!cell || cell.owner !== opp) continue;
        const attacks = this.getAttacks(cell.piece, r, c, opp);
        for (const sq of attacks) {
          if (sq.row === kingRow && sq.col === kingCol) return true;
        }
      }
    }
    return false;
  }

  /**
   * owner側の全合法手（自殺手・打ち歩詰め除外済み）
   */
  getLegalMoves(owner) {
    const moves = [];
    const opp = opponent(owner);

    // 1. 盤上の駒の移動
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const cell = this.board[r][c];
        if (!cell || cell.owner !== owner) continue;
        const piece = cell.piece;

        const attacks = this.getAttacks(piece, r, c, owner);
        for (const to of attacks) {
          const targetCell = this.board[to.row][to.col];
          // 味方駒がいる場所には移動不可
          if (targetCell && targetCell.owner === owner) continue;

          const captured = targetCell ? targetCell.piece : null;

          // 必須成り判定
          if (CAN_PROMOTE.has(piece) && mustPromote(owner, piece, to.row)) {
            // 強制成りのみ
            moves.push({
              from: { row: r, col: c },
              to: { row: to.row, col: to.col },
              piece,
              promote: true,
              captured,
              drop: false
            });
          } else {
            // 通常移動
            moves.push({
              from: { row: r, col: c },
              to: { row: to.row, col: to.col },
              piece,
              promote: false,
              captured,
              drop: false
            });

            // 任意成り: CAN_PROMOTE かつ敵陣を経由する場合
            if (CAN_PROMOTE.has(piece) && !IS_PROMOTED.has(piece)) {
              const fromInEnemy = isEnemyZone(owner, r);
              const toInEnemy = isEnemyZone(owner, to.row);
              if (fromInEnemy || toInEnemy) {
                moves.push({
                  from: { row: r, col: c },
                  to: { row: to.row, col: to.col },
                  piece,
                  promote: true,
                  captured,
                  drop: false
                });
              }
            }
          }
        }
      }
    }

    // 2. 持ち駒の打ち込み
    const hand = this.hands[owner];
    for (const piece of Object.keys(hand)) {
      if (!hand[piece] || hand[piece] <= 0) continue;

      // 歩の二歩チェック用: ownerの歩がいる筋を収集
      let fuCols = new Set();
      if (piece === 'FU') {
        for (let r = 0; r < 9; r++) {
          for (let c = 0; c < 9; c++) {
            const cell = this.board[r][c];
            if (cell && cell.owner === owner && cell.piece === 'FU') {
              fuCols.add(c);
            }
          }
        }
      }

      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          if (this.board[r][c] !== null) continue; // 空マスのみ
          if (hasNoWhere(owner, piece, r)) continue; // 行き所のない駒

          // 二歩チェック
          if (piece === 'FU' && fuCols.has(c)) continue;

          moves.push({
            from: null,
            to: { row: r, col: c },
            piece,
            promote: false,
            captured: null,
            drop: true
          });
        }
      }
    }

    // 3. 自殺手除外・打ち歩詰め除外
    const legalMoves = [];
    for (const move of moves) {
      // applyMove は turn を反転させるので、事前にセット
      this.applyMove(move);
      // applyMove 後、turnが反転している（ownerの手を指したので相手のターン）
      // isInCheck(owner) で自殺手チェック
      const inCheck = this.isInCheck(owner);
      this.undoMove(move);

      if (inCheck) continue; // 自殺手除外

      // 打ち歩詰め除外（歩打ちのみ）
      if (move.drop && move.piece === 'FU') {
        this.applyMove(move);
        const isMated = this.isCheckmate(opp);
        this.undoMove(move);
        if (isMated) continue; // 打ち歩詰め除外
      }

      legalMoves.push(move);
    }

    return legalMoves;
  }

  /**
   * owner側の王手になる合法手のみ
   */
  getCheckMoves(owner) {
    const opp = opponent(owner);
    const legalMoves = this.getLegalMoves(owner);
    return legalMoves.filter(move => {
      this.applyMove(move);
      const inCheck = this.isInCheck(opp);
      this.undoMove(move);
      return inCheck;
    });
  }

  /**
   * owner側が詰んでいるか（王手かつ合法手ゼロ）
   */
  isCheckmate(owner) {
    if (!this.isInCheck(owner)) return false;
    const legalMoves = this.getLegalMoves(owner);
    return legalMoves.length === 0;
  }

  /**
   * 手を適用（破壊的）
   */
  applyMove(move) {
    const owner = this.turn;
    const opp = opponent(owner);

    if (move.drop) {
      // 打ち駒
      this.board[move.to.row][move.to.col] = { piece: move.piece, owner };
      if (this.hands[owner][move.piece]) {
        this.hands[owner][move.piece]--;
      }
    } else {
      // 盤上の駒を移動
      const newPiece = move.promote ? PROMOTED[move.piece] : move.piece;

      if (move.captured) {
        // 取った駒を持ち駒に加算（成り前に戻す）
        const dem = demoted(move.captured);
        this.hands[owner][dem] = (this.hands[owner][dem] || 0) + 1;
      }

      this.board[move.to.row][move.to.col] = { piece: newPiece, owner };
      this.board[move.from.row][move.from.col] = null;
    }

    this.turn = opp;
  }

  /**
   * 手を巻き戻す（破壊的）
   */
  undoMove(move) {
    // turn を元の手番に戻す
    this.turn = opponent(this.turn);
    const owner = this.turn;
    const opp = opponent(owner);

    if (move.drop) {
      // 打ち駒を戻す
      this.board[move.to.row][move.to.col] = null;
      this.hands[owner][move.piece] = (this.hands[owner][move.piece] || 0) + 1;
    } else {
      // 移動を戻す
      this.board[move.from.row][move.from.col] = { piece: move.piece, owner };

      if (move.captured) {
        // 取った駒を盤上に戻す
        this.board[move.to.row][move.to.col] = { piece: move.captured, owner: opp };
        // 持ち駒から減算
        const dem = demoted(move.captured);
        if (this.hands[owner][dem]) {
          this.hands[owner][dem]--;
          if (this.hands[owner][dem] === 0) delete this.hands[owner][dem];
        }
      } else {
        this.board[move.to.row][move.to.col] = null;
      }
    }
  }

  /**
   * SFEN文字列に変換
   */
  toSFEN() {
    // 盤面部分
    const rows = [];
    for (let r = 0; r < 9; r++) {
      let rowStr = '';
      let emptyCount = 0;
      for (let c = 0; c < 9; c++) {
        const cell = this.board[r][c];
        if (!cell) {
          emptyCount++;
        } else {
          if (emptyCount > 0) {
            rowStr += emptyCount;
            emptyCount = 0;
          }
          // 駒の基本形（成り前）を取得
          const basePiece = IS_PROMOTED.has(cell.piece) ? demoted(cell.piece) : cell.piece;
          const sfenChar = SFEN_MAP[basePiece] || '';
          const prefix = IS_PROMOTED.has(cell.piece) ? '+' : '';
          if (cell.owner === 'attacker') {
            rowStr += prefix + sfenChar.toUpperCase();
          } else {
            rowStr += prefix + sfenChar.toLowerCase();
          }
        }
      }
      if (emptyCount > 0) rowStr += emptyCount;
      rows.push(rowStr);
    }
    const boardStr = rows.join('/');

    // 手番
    const turnStr = this.turn === 'attacker' ? 'b' : 'w';

    // 持ち駒
    const handOrder = ['HI', 'KA', 'KI', 'GI', 'KE', 'KY', 'FU'];
    let handStr = '';

    for (const p of handOrder) {
      const count = this.hands.attacker[p] || 0;
      if (count > 0) {
        handStr += (count > 1 ? count : '') + SFEN_MAP[p].toUpperCase();
      }
    }
    for (const p of handOrder) {
      const count = this.hands.defender[p] || 0;
      if (count > 0) {
        handStr += (count > 1 ? count : '') + SFEN_MAP[p].toLowerCase();
      }
    }

    if (!handStr) handStr = '-';

    return `${boardStr} ${turnStr} ${handStr} 1`;
  }

  /**
   * SFEN文字列からパース
   */
  fromSFEN(sfen) {
    const parts = sfen.trim().split(' ');
    if (parts.length < 3) throw new Error('Invalid SFEN: ' + sfen);

    const [boardPart, turnPart, handPart] = parts;

    // 盤面リセット
    this.board = Array.from({ length: 9 }, () => Array(9).fill(null));
    this.hands = { attacker: {}, defender: {} };

    // 手番
    this.turn = turnPart === 'b' ? 'attacker' : 'defender';

    // 盤面パース
    const rows = boardPart.split('/');
    for (let r = 0; r < 9; r++) {
      const rowStr = rows[r] || '';
      let c = 0;
      let i = 0;
      while (i < rowStr.length && c < 9) {
        const ch = rowStr[i];

        if (ch >= '1' && ch <= '9') {
          c += parseInt(ch, 10);
          i++;
        } else if (ch === '+') {
          // 成り駒
          i++;
          const nextCh = rowStr[i];
          if (!nextCh) break;
          const upper = nextCh.toUpperCase();
          const base = SFEN_REVERSE[upper];
          const promoted = PROMOTED[base];
          const owner = nextCh === nextCh.toUpperCase() ? 'attacker' : 'defender';
          if (promoted && c < 9) {
            this.board[r][c] = { piece: promoted, owner };
          }
          c++;
          i++;
        } else {
          const upper = ch.toUpperCase();
          const base = SFEN_REVERSE[upper];
          const owner = ch === ch.toUpperCase() ? 'attacker' : 'defender';
          if (base && c < 9) {
            this.board[r][c] = { piece: base, owner };
          }
          c++;
          i++;
        }
      }
    }

    // 持ち駒パース
    if (handPart !== '-') {
      let i = 0;
      while (i < handPart.length) {
        let count = 0;
        while (i < handPart.length && handPart[i] >= '0' && handPart[i] <= '9') {
          count = count * 10 + parseInt(handPart[i], 10);
          i++;
        }
        if (count === 0) count = 1;

        const ch = handPart[i];
        if (!ch) break;

        const upper = ch.toUpperCase();
        const piece = SFEN_REVERSE[upper];
        const owner = ch === ch.toUpperCase() ? 'attacker' : 'defender';

        if (piece) {
          this.hands[owner][piece] = (this.hands[owner][piece] || 0) + count;
        }
        i++;
      }
    }
  }
}
