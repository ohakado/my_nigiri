def calculate_score(moves_count: int, attacker_piece_count: int, board_sfen: str, session) -> int:
    """
    スコア計算:
    - 手数スコア: moves_count * 10
    - 駒効率ボーナス: max(0, (16 - attacker_piece_count) * 5)
      ※ 攻め方の駒が少ないほど高得点（最大16枚として計算）
    - ユニークネスボーナス: 同一board_sfenがDBに未登録なら +50
    合計を返す
    """
    from .models import Puzzle
    from sqlmodel import select

    move_score = moves_count * 10
    efficiency_bonus = max(0, (16 - attacker_piece_count) * 5)

    # ユニークネスチェック
    existing = session.exec(select(Puzzle).where(Puzzle.board_sfen == board_sfen)).first()
    uniqueness_bonus = 0 if existing else 50

    return move_score + efficiency_bonus + uniqueness_bonus
