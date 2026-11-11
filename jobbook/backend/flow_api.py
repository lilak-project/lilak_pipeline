"""The flow board tab's two live bits, outside the document because every left
click changes them and every save of the document keeps what it replaces:
where each person is looking (`/api/focus`, kept in memory — a local agent reads
it back) and the messages typed at the board's bottom bar (`messages.jsonl`,
appended, never rewritten). Evaluations, prefs and pins are document keys.
"""
import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Body, Depends, FastAPI, HTTPException

from lilak_portal_auth import signed_in


def who(me: dict) -> str:
    return me.get("email") or me.get("username") or ""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def mount(app: FastAPI, data: Path) -> None:
    messages = data / "messages.jsonl"
    focus: dict = {}
    lock = threading.Lock()

    @app.put("/api/focus")
    def put_focus(body: dict = Body(...), me: dict = Depends(signed_in)) -> dict:
        focus[who(me)] = {**body, "user": who(me), "received": now()}
        return {"ok": True}

    @app.get("/api/focus")
    def get_focus(me: dict = Depends(signed_in)) -> dict:
        """Where the caller is looking — what a local agent asks before "this"."""
        return focus.get(who(me)) or {}

    @app.post("/api/messages")
    def add_message(body: dict = Body(...), me: dict = Depends(signed_in)) -> dict:
        text = str(body.get("text") or "").strip()
        if not text:
            raise HTTPException(400, "empty message")
        msg = {"id": str(uuid.uuid4()), "at": now(), "user": who(me), "role": "user",
               "text": text[:20000], "focus": body.get("focus") or {}}
        with lock:
            data.mkdir(parents=True, exist_ok=True)
            with open(messages, "a", encoding="utf-8") as f:
                f.write(json.dumps(msg, ensure_ascii=False) + "\n")
        return msg

    @app.get("/api/messages")
    def list_messages(limit: int = 200, me: dict = Depends(signed_in)) -> list:
        if not messages.exists():
            return []
        mine = []
        with open(messages, encoding="utf-8") as f:
            for line in f:
                try:
                    m = json.loads(line)
                except ValueError:
                    continue  # a half-written last line after a crash
                if m.get("user") == who(me):
                    mine.append(m)
        return mine[-max(1, min(limit, 1000)):]
