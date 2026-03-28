from datetime import datetime
from typing import Optional
from sqlmodel import SQLModel, Field


class Puzzle(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    board_sfen: str = Field(index=True)          # 初期盤面SFEN
    solution_moves: str                           # JSON文字列 [{from, to, piece, promote, drop}, ...]
    moves_count: int                              # 手数（1,3,5,7,9）
    tier: int = Field(default=1)                 # ティア（1/2/3）
    score: int = Field(default=0)
    attacker_piece_count: int = Field(default=0) # 攻め方の駒数（盤上+持ち駒）
    player_name: str = Field(default="匿名")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PuzzleCreate(SQLModel):
    board_sfen: str
    solution_moves: list[dict]
    moves_count: int
    tier: int = 1
    player_name: Optional[str] = "匿名"


class PuzzleResponse(SQLModel):
    id: int
    board_sfen: str
    moves_count: int
    tier: int
    score: int
    player_name: str
    created_at: datetime
