import json
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session, select

from .database import create_db, get_session, engine
from .models import Puzzle, PuzzleCreate, PuzzleResponse
from . import solver
from . import scoring as scoring_module

# --------------------------------------------------------------------------
# アプリ初期化
# --------------------------------------------------------------------------

app = FastAPI(title="握り詰め API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# frontend ディレクトリのパス（main.py の親ディレクトリの親）
BASE_DIR = Path(__file__).parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"


@app.on_event("startup")
def on_startup():
    create_db()


# --------------------------------------------------------------------------
# 静的ファイル配信
# --------------------------------------------------------------------------

# /static パスで frontend/ を配信（存在する場合のみマウント）
if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


# --------------------------------------------------------------------------
# ページルート
# --------------------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
def index():
    html_path = FRONTEND_DIR / "index.html"
    if html_path.exists():
        return HTMLResponse(content=html_path.read_text(encoding="utf-8"))
    return HTMLResponse(content="<h1>frontend/index.html が見つかりません</h1>", status_code=404)


@app.get("/ranking", response_class=HTMLResponse)
def ranking_page():
    html_path = FRONTEND_DIR / "ranking.html"
    if html_path.exists():
        return HTMLResponse(content=html_path.read_text(encoding="utf-8"))
    return HTMLResponse(content="<h1>frontend/ranking.html が見つかりません</h1>", status_code=404)


# --------------------------------------------------------------------------
# API: 問題投稿
# --------------------------------------------------------------------------

TIER_BONUS = {1: 0, 2: 30, 3: 70}
TIER_LABEL = {1: "ティア1", 2: "ティア2", 3: "ティア3"}


@app.post("/api/submit", response_class=HTMLResponse)
def submit_puzzle(
    board_sfen: str = Form(...),
    solution_moves: str = Form(...),   # JSON文字列
    moves_count: int = Form(...),
    tier: int = Form(default=1),
    player_name: Optional[str] = Form(default="匿名"),
    session: Session = Depends(get_session),
):
    player_name = player_name or "匿名"
    try:
        solution_moves_list = json.loads(solution_moves)
    except json.JSONDecodeError:
        return HTMLResponse(
            content='<div class="result-card error"><h2>⚠️ エラー</h2><p>解の手順のフォーマットが不正です</p></div>',
            status_code=200,
        )

    # 1. 盤面合法性チェック
    valid, err = solver.validate_board(board_sfen)
    if not valid:
        return HTMLResponse(
            content=f"""<div class="result-card error">
  <h2>⚠️ エラー</h2>
  <p>{err}</p>
</div>""",
            status_code=200,
        )

    # 2. 解の手順検証
    valid, err = solver.verify_solution(board_sfen, solution_moves_list)
    if not valid:
        return HTMLResponse(
            content=f"""<div class="result-card error">
  <h2>⚠️ エラー</h2>
  <p>{err}</p>
</div>""",
            status_code=200,
        )

    # 3. 攻め方の駒数カウント
    attacker_piece_count = solver.count_attacker_pieces(board_sfen)

    # 4. スコア計算
    move_score = moves_count * 10
    efficiency_bonus = max(0, (16 - attacker_piece_count) * 5)
    tier_bonus = TIER_BONUS.get(tier, 0)
    from sqlmodel import select as sql_select
    existing = session.exec(
        sql_select(Puzzle).where(Puzzle.board_sfen == board_sfen)
    ).first()
    uniqueness_bonus = 0 if existing else 50
    score = move_score + efficiency_bonus + tier_bonus + uniqueness_bonus

    # 5. DB保存
    puzzle = Puzzle(
        board_sfen=board_sfen,
        solution_moves=json.dumps(solution_moves_list, ensure_ascii=False),
        moves_count=moves_count,
        tier=tier,
        score=score,
        attacker_piece_count=attacker_piece_count,
        player_name=player_name,
    )
    session.add(puzzle)
    session.commit()
    session.refresh(puzzle)

    # 6. HTML断片を返す
    return HTMLResponse(
        content=f"""<div class="result-card success">
  <h2>🎉 登録完了！</h2>
  <p>{TIER_LABEL.get(tier, '')} / {moves_count}手詰め</p>
  <p>スコア: <strong>{score}点</strong></p>
  <p style="font-size:0.85rem; color:#555;">
    手数 {move_score} + 効率 {efficiency_bonus} + ティア {tier_bonus} + ユニーク {uniqueness_bonus}
  </p>
</div>""",
        status_code=200,
    )


# --------------------------------------------------------------------------
# API: ランキング
# --------------------------------------------------------------------------

@app.get("/api/ranking")
def get_ranking(session: Session = Depends(get_session)):
    statement = (
        select(Puzzle)
        .order_by(Puzzle.score.desc(), Puzzle.created_at.asc())
        .limit(20)
    )
    puzzles = session.exec(statement).all()
    return [
        PuzzleResponse(
            id=p.id,
            board_sfen=p.board_sfen,
            moves_count=p.moves_count,
            score=p.score,
            player_name=p.player_name,
            created_at=p.created_at,
        )
        for p in puzzles
    ]


# --------------------------------------------------------------------------
# API: ランキング（HTML断片）
# --------------------------------------------------------------------------

@app.get("/api/ranking/html", response_class=HTMLResponse)
def get_ranking_html(session: Session = Depends(get_session)):
    statement = (
        select(Puzzle)
        .order_by(Puzzle.score.desc(), Puzzle.created_at.asc())
        .limit(20)
    )
    puzzles = session.exec(statement).all()

    if not puzzles:
        return HTMLResponse(content='<p style="text-align:center; color:#888;">まだ投稿がありません</p>')

    tier_labels = {1: "T1", 2: "T2", 3: "T3"}
    rows = ""
    for i, p in enumerate(puzzles, start=1):
        rank_class = f"rank-{i}" if i <= 3 else ""
        medal = ["🥇", "🥈", "🥉"][i - 1] if i <= 3 else str(i)
        tlabel = tier_labels.get(p.tier, f"T{p.tier}")
        rows += f"""
        <tr class="{rank_class}">
          <td>{medal}</td>
          <td>{p.player_name}</td>
          <td><span class="tier-badge tier{p.tier}">{tlabel}</span></td>
          <td>{p.moves_count}手詰め</td>
          <td>{p.score}点</td>
          <td>{p.created_at.strftime('%Y-%m-%d %H:%M')}</td>
        </tr>"""

    return HTMLResponse(content=f"""
<table class="ranking-table">
  <thead>
    <tr>
      <th>順位</th>
      <th>投稿者</th>
      <th>ティア</th>
      <th>手数</th>
      <th>スコア</th>
      <th>投稿日時</th>
    </tr>
  </thead>
  <tbody>{rows}</tbody>
</table>""")


# --------------------------------------------------------------------------
# API: 問題一覧
# --------------------------------------------------------------------------

@app.get("/api/puzzles")
def list_puzzles(session: Session = Depends(get_session)):
    statement = (
        select(Puzzle)
        .order_by(Puzzle.created_at.desc())
        .limit(20)
    )
    puzzles = session.exec(statement).all()
    return [
        PuzzleResponse(
            id=p.id,
            board_sfen=p.board_sfen,
            moves_count=p.moves_count,
            score=p.score,
            player_name=p.player_name,
            created_at=p.created_at,
        )
        for p in puzzles
    ]


# --------------------------------------------------------------------------
# API: 問題詳細
# --------------------------------------------------------------------------

@app.get("/api/puzzles/{puzzle_id}")
def get_puzzle(puzzle_id: int, session: Session = Depends(get_session)):
    puzzle = session.get(Puzzle, puzzle_id)
    if not puzzle:
        raise HTTPException(status_code=404, detail="Puzzle not found")
    return {
        "id": puzzle.id,
        "board_sfen": puzzle.board_sfen,
        "solution_moves": json.loads(puzzle.solution_moves),
        "moves_count": puzzle.moves_count,
        "score": puzzle.score,
        "attacker_piece_count": puzzle.attacker_piece_count,
        "player_name": puzzle.player_name,
        "created_at": puzzle.created_at,
    }
