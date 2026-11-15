"""Where each person is looking on the flow board (`/api/focus`), kept in memory
outside the document because every left click changes it and every save of the
document keeps what it replaces. A local agent reads it back. Talking about a
job is the portal chat's (the board's bottom bar opens it); the board's own
messages (/api/messages) are gone. Evaluations, prefs and pins are document keys.
"""
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Body, Depends, FastAPI

from lilak_portal_auth import signed_in


def who(me: dict) -> str:
    return me.get("email") or me.get("username") or ""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def mount(app: FastAPI, data: Path) -> None:
    focus: dict = {}

    @app.put("/api/focus")
    def put_focus(body: dict = Body(...), me: dict = Depends(signed_in)) -> dict:
        focus[who(me)] = {**body, "user": who(me), "received": now()}
        return {"ok": True}

    @app.get("/api/focus")
    def get_focus(me: dict = Depends(signed_in)) -> dict:
        """Where the caller is looking — what a local agent asks before "this"."""
        return focus.get(who(me)) or {}
