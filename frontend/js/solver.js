// solver.js - 詰み探索 Web Worker（module worker）

import { ShogiBoard } from './shogi.js';

// メッセージハンドラ
self.onmessage = (e) => {
  const { type, boardState, maxDepth } = e.data;
  if (type === 'solve') {
    const result = solve(boardState, maxDepth || 9);
    self.postMessage(result);
  }
};

function solve(boardState, maxDepth) {
  // boardState は SFEN文字列
  const board = new ShogiBoard();
  board.fromSFEN(boardState);

  const nodeCounter = { count: 0 };
  const MAX_NODES = 500000;

  // 反復深化（奇数手：1,3,5,7,9）
  for (let depth = 1; depth <= maxDepth; depth += 2) {
    nodeCounter.count = 0;
    const result = dfSearch(board, depth, 0, true, nodeCounter, MAX_NODES);
    if (result !== null) {
      return { found: true, moves: result, movesCount: result.length };
    }
    if (nodeCounter.count >= MAX_NODES) {
      return { found: false, reason: 'timeout' };
    }
  }
  return { found: false, reason: 'no_mate' };
}

/**
 * DFS詰み探索
 * 戻り値: moves配列（詰みあり）または null（詰みなし/上限超過）
 */
function dfSearch(board, maxDepth, currentDepth, isAttackerTurn, nodeCounter, maxNodes) {
  nodeCounter.count++;
  if (nodeCounter.count > maxNodes) return null;

  if (isAttackerTurn) {
    if (currentDepth >= maxDepth) return null; // これ以上深く探索しない

    // 攻め方: 王手になる手のみ試す
    const checkMoves = board.getCheckMoves('attacker');
    if (checkMoves.length === 0) return null;

    for (const move of checkMoves) {
      board.applyMove(move);
      const result = dfSearch(board, maxDepth, currentDepth + 1, false, nodeCounter, maxNodes);
      board.undoMove(move);

      if (result !== null) {
        return [move, ...result]; // 詰みが見つかった
      }
    }
    return null;

  } else {
    // 受け方: 全合法手を試す
    const legalMoves = board.getLegalMoves('defender');

    if (legalMoves.length === 0) {
      // 合法手ゼロ = 詰み（王手されているはず）
      return board.isInCheck('defender') ? [] : null;
    }

    // 全ての逃げ手が詰みになるか確認
    const allResults = [];
    for (const move of legalMoves) {
      board.applyMove(move);
      const result = dfSearch(board, maxDepth, currentDepth + 1, true, nodeCounter, maxNodes);
      board.undoMove(move);

      if (result === null) return null; // この手で逃げられる = 詰みなし
      allResults.push([move, ...result]);
    }

    // 全逃げ道が詰み = 最短の変化を返す
    allResults.sort((a, b) => a.length - b.length);
    return allResults[0];
  }
}
