"""
将棋ルール実装モジュール（握り詰め検証用）

座標系:
  board[row][col]
  row 0 = 1段目（上側、後手陣）、row 8 = 9段目（下側、先手陣）
  col 0 = 9筋（右）、col 8 = 1筋（左）
  attacker（先手）= 詰める側、移動方向は row 減少（上方向）
  defender（後手）= 詰められる側（玉を持つ）、移動方向は row 増加（下方向）
"""

from __future__ import annotations

import copy
import json

# --------------------------------------------------------------------------
# 定数
# --------------------------------------------------------------------------

PIECES = {"FU", "KY", "KE", "GI", "KI", "KA", "HI", "OU",
          "TO", "NY", "NK", "NG", "UM", "RY"}

# 成り前 → 成り後
PROMOTE_MAP = {
    "FU": "TO",
    "KY": "NY",
    "KE": "NK",
    "GI": "NG",
    "KA": "UM",
    "HI": "RY",
}

# 成り後 → 成り前（持ち駒に戻す際）
UNPROMOTE_MAP = {v: k for k, v in PROMOTE_MAP.items()}

# 成れる駒（成り前のみ持ち駒/打ち駒として使う）
PROMOTABLE = set(PROMOTE_MAP.keys())

# 成れない駒
NON_PROMOTABLE = {"KI", "OU"}

# 持ち駒として使える駒種（成りなし）
HAND_PIECES = {"FU", "KY", "KE", "GI", "KI", "KA", "HI"}

# SFEN 1文字 → 内部駒種名
SFEN_TO_PIECE = {
    "P": "FU",
    "L": "KY",
    "N": "KE",
    "S": "GI",
    "G": "KI",
    "B": "KA",
    "R": "HI",
    "K": "OU",
}

# 内部駒種名 → SFEN 1文字
PIECE_TO_SFEN = {v: k for k, v in SFEN_TO_PIECE.items()}


# --------------------------------------------------------------------------
# SFEN パーサー
# --------------------------------------------------------------------------

def parse_sfen(sfen: str) -> dict:
    """
    SFENをパースして {"board": [...], "hands": {...}, "turn": str} を返す

    board: 9x9 の2次元リスト。各セルは None か {"piece": str, "owner": str}
    hands: {"attacker": {"FU": n, ...}, "defender": {"FU": n, ...}}
    turn: "attacker" or "defender"
    """
    parts = sfen.strip().split()
    if len(parts) < 3:
        raise ValueError(f"Invalid SFEN: {sfen!r}")

    board_str = parts[0]
    turn_str  = parts[1]
    hand_str  = parts[2]
    # move_number = parts[3] if len(parts) > 3 else "1"

    # 手番
    turn = "attacker" if turn_str == "b" else "defender"

    # 盤面パース
    board = [[None] * 9 for _ in range(9)]
    row = 0
    col = 0
    promoted = False

    for ch in board_str:
        if ch == "/":
            row += 1
            col = 0
            promoted = False
        elif ch == "+":
            promoted = True
        elif ch.isdigit():
            col += int(ch)
            promoted = False
        else:
            # 大文字=先手(attacker)、小文字=後手(defender)
            owner = "attacker" if ch.isupper() else "defender"
            sfen_char = ch.upper()
            piece = SFEN_TO_PIECE.get(sfen_char, sfen_char)  # SFENシンボル→内部名
            if promoted:
                piece = PROMOTE_MAP.get(piece, piece)
                promoted = False
            board[row][col] = {"piece": piece, "owner": owner}
            col += 1

    # 持ち駒パース
    hands = {
        "attacker": {p: 0 for p in HAND_PIECES},
        "defender":  {p: 0 for p in HAND_PIECES},
    }
    if hand_str != "-":
        i = 0
        count_buf = ""
        while i < len(hand_str):
            ch = hand_str[i]
            if ch.isdigit():
                count_buf += ch
            else:
                owner = "attacker" if ch.isupper() else "defender"
                sfen_char = ch.upper()
                piece = SFEN_TO_PIECE.get(sfen_char, sfen_char)
                # 成り駒が持ち駒にある場合は元に戻す
                piece = UNPROMOTE_MAP.get(piece, piece)
                count = int(count_buf) if count_buf else 1
                count_buf = ""
                if piece in hands[owner]:
                    hands[owner][piece] += count
            i += 1

    return {"board": board, "hands": hands, "turn": turn}


# --------------------------------------------------------------------------
# 盤面合法性チェック
# --------------------------------------------------------------------------

def validate_board(sfen: str) -> tuple[bool, str]:
    """
    盤面の合法性チェック:
    - 玉がdefender側に1枚あるか（attackerに玉がない詰将棋形式も許容）
    - 二歩チェック（同列に歩が2枚）
    - 行き所のない駒
    - 全駒数が40枚以内
    戻り値: (is_valid, error_message)
    """
    try:
        state = parse_sfen(sfen)
    except Exception as e:
        return False, f"SFENのパースに失敗しました: {e}"

    board = state["board"]
    hands = state["hands"]

    # 全駒数チェック（駒の総数は40枚）
    total = 0
    for r in range(9):
        for c in range(9):
            if board[r][c] is not None:
                total += 1
    for owner in ("attacker", "defender"):
        for p, n in hands[owner].items():
            total += n
    if total > 40:
        return False, f"駒の総数が{total}枚で40枚を超えています"

    # defender側に玉が1枚あるか
    defender_ou = 0
    for r in range(9):
        for c in range(9):
            cell = board[r][c]
            if cell and cell["piece"] == "OU" and cell["owner"] == "defender":
                defender_ou += 1
    if defender_ou != 1:
        return False, f"玉（defender側）が{defender_ou}枚です（1枚必要）"

    # 二歩チェック（同列に同じowner の歩が2枚）
    for owner in ("attacker", "defender"):
        fu_cols = []
        for r in range(9):
            for c in range(9):
                cell = board[r][c]
                if cell and cell["piece"] == "FU" and cell["owner"] == owner:
                    fu_cols.append(c)
        if len(fu_cols) != len(set(fu_cols)):
            return False, f"{owner}側に二歩があります"

    # 行き所のない駒チェック
    for r in range(9):
        for c in range(9):
            cell = board[r][c]
            if cell is None:
                continue
            piece = cell["piece"]
            owner = cell["owner"]
            # attacker: 上方向(row減少)へ進む。1段目(row=0)に行き所なし
            # defender: 下方向(row増加)へ進む。9段目(row=8)に行き所なし
            if owner == "attacker":
                if piece == "FU" and r == 0:
                    return False, f"attacker側の歩が1段目({r},{c})にあります"
                if piece == "KY" and r == 0:
                    return False, f"attacker側の香が1段目({r},{c})にあります"
                if piece == "KE" and r <= 1:
                    return False, f"attacker側の桂が{r+1}段目({r},{c})にあります（行き所なし）"
            else:  # defender
                if piece == "FU" and r == 8:
                    return False, f"defender側の歩が9段目({r},{c})にあります"
                if piece == "KY" and r == 8:
                    return False, f"defender側の香が9段目({r},{c})にあります"
                if piece == "KE" and r >= 7:
                    return False, f"defender側の桂が{r+1}段目({r},{c})にあります（行き所なし）"

    return True, ""


# --------------------------------------------------------------------------
# 利き計算
# --------------------------------------------------------------------------

def _in_board(r: int, c: int) -> bool:
    return 0 <= r <= 8 and 0 <= c <= 8


def get_attacks(board: list, piece: str, owner: str, row: int, col: int) -> list[tuple[int, int]]:
    """
    指定した駒が利いているマスのリストを返す。
    """
    # attacker は row 減少方向（-1）が前、defender は row 増加方向（+1）が前
    fwd = -1 if owner == "attacker" else 1

    attacks = []

    def slide(dr, dc):
        r, c = row + dr, col + dc
        while _in_board(r, c):
            attacks.append((r, c))
            if board[r][c] is not None:
                break
            r += dr
            c += dc

    def step(dr, dc):
        r, c = row + dr, col + dc
        if _in_board(r, c):
            attacks.append((r, c))

    if piece == "FU":
        step(fwd, 0)

    elif piece == "KY":
        slide(fwd, 0)

    elif piece == "KE":
        step(fwd * 2, -1)
        step(fwd * 2,  1)

    elif piece == "GI":
        step(fwd,  -1)
        step(fwd,   0)
        step(fwd,   1)
        step(-fwd, -1)
        step(-fwd,  1)

    elif piece in ("KI", "TO", "NY", "NK", "NG"):
        step(fwd,  -1)
        step(fwd,   0)
        step(fwd,   1)
        step(0,    -1)
        step(0,     1)
        step(-fwd,  0)

    elif piece == "KA":
        slide(1,  1)
        slide(1, -1)
        slide(-1,  1)
        slide(-1, -1)

    elif piece == "HI":
        slide(1,  0)
        slide(-1, 0)
        slide(0,  1)
        slide(0, -1)

    elif piece == "UM":
        slide(1,  1)
        slide(1, -1)
        slide(-1,  1)
        slide(-1, -1)
        step(1,  0)
        step(-1, 0)
        step(0,  1)
        step(0, -1)

    elif piece == "RY":
        slide(1,  0)
        slide(-1, 0)
        slide(0,  1)
        slide(0, -1)
        step(1,  1)
        step(1, -1)
        step(-1,  1)
        step(-1, -1)

    elif piece == "OU":
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                if dr == 0 and dc == 0:
                    continue
                step(dr, dc)

    return attacks


# --------------------------------------------------------------------------
# 王手判定・詰み判定
# --------------------------------------------------------------------------

def _find_king(board: list, owner: str) -> tuple[int, int] | None:
    for r in range(9):
        for c in range(9):
            cell = board[r][c]
            if cell and cell["piece"] == "OU" and cell["owner"] == owner:
                return (r, c)
    return None


def is_in_check(state: dict, owner: str) -> bool:
    """owner側の玉が王手されているか"""
    board = state["board"]
    king_pos = _find_king(board, owner)
    if king_pos is None:
        return False  # 玉がない（通常はない）

    opponent = "defender" if owner == "attacker" else "attacker"

    for r in range(9):
        for c in range(9):
            cell = board[r][c]
            if cell and cell["owner"] == opponent:
                attacks = get_attacks(board, cell["piece"], opponent, r, c)
                if king_pos in attacks:
                    return True
    return False


def is_checkmate(state: dict, owner: str) -> bool:
    """owner側が詰んでいるか"""
    if not is_in_check(state, owner):
        return False
    legal = get_legal_moves(state, owner)
    return len(legal) == 0


# --------------------------------------------------------------------------
# 手の適用
# --------------------------------------------------------------------------

def apply_move(state: dict, move: dict) -> dict:
    """手を適用して新しい状態を返す（元のstateは変更しない）"""
    new_state = copy.deepcopy(state)
    board = new_state["board"]
    hands = new_state["hands"]

    to_r = move["to"]["row"]
    to_c = move["to"]["col"]
    piece = move["piece"]
    promote = move.get("promote", False)
    drop = move.get("drop", False)

    # 手番（moveのownerは呼び出し側が保証する）
    # turnはstateから取得
    owner = state["turn"]
    opponent = "defender" if owner == "attacker" else "attacker"

    if drop:
        # 打ち駒
        hands[owner][piece] -= 1
        board[to_r][to_c] = {"piece": piece, "owner": owner}
    else:
        from_r = move["from"]["row"]
        from_c = move["from"]["col"]
        # 移動先に駒があれば持ち駒に追加
        target = board[to_r][to_c]
        if target:
            captured_piece = target["piece"]
            # 成り駒は元に戻す
            captured_piece = UNPROMOTE_MAP.get(captured_piece, captured_piece)
            hands[owner][captured_piece] = hands[owner].get(captured_piece, 0) + 1
        # 移動
        moving = board[from_r][from_c]
        if promote and moving["piece"] in PROMOTE_MAP:
            new_piece = PROMOTE_MAP[moving["piece"]]
        else:
            new_piece = moving["piece"]
        board[to_r][to_c] = {"piece": new_piece, "owner": owner}
        board[from_r][from_c] = None

    # 手番交代
    new_state["turn"] = opponent
    return new_state


# --------------------------------------------------------------------------
# 合法手生成
# --------------------------------------------------------------------------

def get_legal_moves(state: dict, owner: str) -> list[dict]:
    """owner側の全合法手を返す"""
    board = state["board"]
    hands = state["hands"]
    moves = []

    # ----- 盤上の駒の移動 -----
    for fr in range(9):
        for fc in range(9):
            cell = board[fr][fc]
            if not cell or cell["owner"] != owner:
                continue
            piece = cell["piece"]
            attacks = get_attacks(board, piece, owner, fr, fc)
            for (tr, tc) in attacks:
                target = board[tr][tc]
                # 自分の駒がある場所には行けない
                if target and target["owner"] == owner:
                    continue

                # 成れるか判定
                can_promote = _can_promote(piece, owner, fr, tr)
                must_promote = _must_promote(piece, owner, tr)

                if must_promote:
                    # 成らないと行き所のない駒 → 強制成り
                    if piece in PROMOTE_MAP:
                        move = {
                            "from": {"row": fr, "col": fc},
                            "to":   {"row": tr, "col": tc},
                            "piece": piece,
                            "promote": True,
                            "drop": False,
                        }
                        new_state = _apply_move_for_check(state, move, owner)
                        if not is_in_check(new_state, owner):
                            moves.append(move)
                    # 成れない駒で行き所なしは非合法（そのような状態はvalidate_boardで弾く）
                else:
                    # 成りなし
                    move = {
                        "from": {"row": fr, "col": fc},
                        "to":   {"row": tr, "col": tc},
                        "piece": piece,
                        "promote": False,
                        "drop": False,
                    }
                    new_state = _apply_move_for_check(state, move, owner)
                    if not is_in_check(new_state, owner):
                        moves.append(move)

                    # 成りあり（任意成り）
                    if can_promote and not must_promote and piece in PROMOTE_MAP:
                        move_p = {
                            "from": {"row": fr, "col": fc},
                            "to":   {"row": tr, "col": tc},
                            "piece": piece,
                            "promote": True,
                            "drop": False,
                        }
                        new_state_p = _apply_move_for_check(state, move_p, owner)
                        if not is_in_check(new_state_p, owner):
                            moves.append(move_p)

    # ----- 打ち駒 -----
    for piece, count in hands[owner].items():
        if count <= 0:
            continue
        for tr in range(9):
            for tc in range(9):
                if board[tr][tc] is not None:
                    continue  # 空きマスのみ
                # 行き所のない打ち駒は非合法
                if _drop_forbidden_by_position(piece, owner, tr):
                    continue
                # 二歩チェック
                if piece == "FU" and _is_nifu(board, owner, tc):
                    continue
                # 打ち歩詰め
                if piece == "FU":
                    move = {
                        "from": None,
                        "to":   {"row": tr, "col": tc},
                        "piece": piece,
                        "promote": False,
                        "drop": True,
                    }
                    new_state = _apply_move_for_check(state, move, owner)
                    if is_in_check(new_state, owner):
                        continue  # 自玉が王手に入ってはダメ
                    opponent = "defender" if owner == "attacker" else "attacker"
                    if is_checkmate(new_state, opponent):
                        continue  # 打ち歩詰め禁止
                    moves.append(move)
                else:
                    move = {
                        "from": None,
                        "to":   {"row": tr, "col": tc},
                        "piece": piece,
                        "promote": False,
                        "drop": True,
                    }
                    new_state = _apply_move_for_check(state, move, owner)
                    if not is_in_check(new_state, owner):
                        moves.append(move)

    return moves


def _apply_move_for_check(state: dict, move: dict, owner: str) -> dict:
    """王手チェック用に手を仮適用する（turn を owner に固定）"""
    # stateのturnがownerになっていることを保証
    s = dict(state)
    s["turn"] = owner
    return apply_move(s, move)


def _can_promote(piece: str, owner: str, from_row: int, to_row: int) -> bool:
    """成れるか（移動元か移動先が敵陣）"""
    if piece not in PROMOTE_MAP:
        return False
    if owner == "attacker":
        # 敵陣は row 0-2
        return from_row <= 2 or to_row <= 2
    else:
        # 敵陣は row 6-8
        return from_row >= 6 or to_row >= 6


def _must_promote(piece: str, owner: str, to_row: int) -> bool:
    """
    成らなければ行き所がない（必ず成る必要がある）
    """
    if owner == "attacker":
        if piece == "FU" and to_row == 0:
            return True
        if piece == "KY" and to_row == 0:
            return True
        if piece == "KE" and to_row <= 1:
            return True
    else:
        if piece == "FU" and to_row == 8:
            return True
        if piece == "KY" and to_row == 8:
            return True
        if piece == "KE" and to_row >= 7:
            return True
    return False


def _drop_forbidden_by_position(piece: str, owner: str, to_row: int) -> bool:
    """打ち駒の位置が行き所なしか"""
    if owner == "attacker":
        if piece == "FU" and to_row == 0:
            return True
        if piece == "KY" and to_row == 0:
            return True
        if piece == "KE" and to_row <= 1:
            return True
    else:
        if piece == "FU" and to_row == 8:
            return True
        if piece == "KY" and to_row == 8:
            return True
        if piece == "KE" and to_row >= 7:
            return True
    return False


def _is_nifu(board: list, owner: str, col: int) -> bool:
    """同じcolに同じownerの歩があるか（二歩チェック）"""
    for r in range(9):
        cell = board[r][col]
        if cell and cell["piece"] == "FU" and cell["owner"] == owner:
            return True
    return False


# --------------------------------------------------------------------------
# 解の検証
# --------------------------------------------------------------------------

def verify_solution(sfen: str, moves: list[dict]) -> tuple[bool, str]:
    """
    解の手順を検証:
    - 各手が合法手か
    - 攻め方の手は必ず王手になっているか
    - 最終局面が詰みか
    戻り値: (is_valid, error_message)
    """
    try:
        state = parse_sfen(sfen)
    except Exception as e:
        return False, f"SFENのパースに失敗: {e}"

    if not moves:
        return False, "手順が空です"

    if len(moves) % 2 == 0:
        return False, f"手数が偶数({len(moves)})です。奇数手数の詰め将棋が必要です"

    for i, move in enumerate(moves):
        current_owner = state["turn"]
        expected_owner = "attacker" if i % 2 == 0 else "defender"

        if current_owner != expected_owner:
            # 手番を強制的に合わせる
            state["turn"] = expected_owner
            current_owner = expected_owner

        # 合法手チェック
        legal = get_legal_moves(state, current_owner)
        if not _move_in_legal(move, legal):
            return False, f"手{i+1}が非合法手です: {move}"

        # 攻め方の手は王手でなければならない
        if current_owner == "attacker":
            new_state = _apply_move_for_check(state, move, current_owner)
            if not is_in_check(new_state, "defender"):
                return False, f"手{i+1}（攻め方）が王手になっていません: {move}"

        state = apply_move(state, move)

    # 最終局面が詰みか
    # 最後の手はdefenderの手のはず（奇数手の詰め将棋なら最後はdefenderが応じた後）
    # 実際には attacker の最後の手の後 defender が詰んでいる
    # 最後の手は attacker の手（手数が奇数なのでindex 0,2,4,...が attacker）
    # apply後、defenderが詰んでいるか確認
    if not is_checkmate(state, "defender"):
        return False, "最終局面でdefender側が詰んでいません"

    return True, ""


def _move_in_legal(move: dict, legal_moves: list[dict]) -> bool:
    """moveがlegal_movesに含まれるか（フィールド比較）"""
    for lm in legal_moves:
        if lm["drop"] != move.get("drop", False):
            continue
        if lm["promote"] != move.get("promote", False):
            continue
        if lm["piece"] != move.get("piece", ""):
            continue
        # to の比較
        if lm["to"]["row"] != move["to"]["row"]:
            continue
        if lm["to"]["col"] != move["to"]["col"]:
            continue
        # from の比較
        if move.get("drop", False):
            if lm["from"] is not None:
                continue
        else:
            if lm["from"] is None:
                continue
            if move.get("from") is None:
                continue
            if lm["from"]["row"] != move["from"]["row"]:
                continue
            if lm["from"]["col"] != move["from"]["col"]:
                continue
        return True
    return False


# --------------------------------------------------------------------------
# 攻め方の駒数カウント
# --------------------------------------------------------------------------

def count_attacker_pieces(sfen: str) -> int:
    """攻め方の駒数（盤上+持ち駒）を数える"""
    try:
        state = parse_sfen(sfen)
    except Exception:
        return 0

    board = state["board"]
    hands = state["hands"]
    count = 0

    for r in range(9):
        for c in range(9):
            cell = board[r][c]
            if cell and cell["owner"] == "attacker":
                count += 1

    for piece, n in hands["attacker"].items():
        count += n

    return count
