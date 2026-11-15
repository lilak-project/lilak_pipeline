"""One job record's history: when it was made, each later change, which fields it
touched and how much the record grew or shrank.

Read from what rackstore already keeps: every save copies the record it replaces
to .history/<key>/<record>/<version>.json (kept keep_days, 30 here), and the
record itself is the newest state. Nothing extra is stored.
"""
import json
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException

from lilak_portal_auth import signed_in

SKIP = {"updatedAt"}  # stamped on every save: not a change of its own
OUT = "outputSize"  # bytes in the job's output folder (jobrun, once the job ended): shown as its own number


def changes(states: list) -> list:
    """[(record, size)] oldest first → [{at, size, delta, kind, added, removed, changed}], newest first."""
    out, prev = [], None
    for rec, size in states:
        if prev is None:
            # The first state kept is the making of it only if nothing came before (else history ran out).
            made = rec.get("createdAt") and rec.get("updatedAt") in (None, rec.get("createdAt"))
            entry = {"kind": "created" if made else "oldest", "added": [], "removed": [], "changed": []}
        else:
            old, new = prev[0], rec
            keys = (set(old) | set(new)) - SKIP - {OUT}
            entry = {
                "kind": "updated",
                "added": sorted(k for k in keys if k not in old and new.get(k) not in (None, "", [])),
                "removed": sorted(k for k in keys if k in old and old.get(k) not in (None, "", []) and new.get(k) in (None, "", [])),
                "changed": sorted(k for k in keys if k in old and k in new and old[k] != new[k]
                                  and old[k] not in (None, "", []) and new[k] not in (None, "", [])),
            }
            if not (entry["added"] or entry["removed"] or entry["changed"]) and old.get(OUT) == new.get(OUT):
                prev = (rec, size)
                continue
        entry.update(at=rec.get("updatedAt") or rec.get("createdAt") or "", size=size,
                     delta=size - prev[1] if prev else size)
        if rec.get(OUT) is not None and (prev is None or prev[0].get(OUT) != rec[OUT]):
            entry.update(out=rec[OUT], outDelta=rec[OUT] - (prev[0].get(OUT) or 0) if prev else rec[OUT])
        out.append(entry)
        prev = (rec, size)
    return out[::-1]


def mount(app: FastAPI, store) -> None:
    @app.get("/api/history/jobs/{rid}")
    def history(rid: str, _: dict = Depends(signed_in)) -> list:
        cur = store._rec("jobs", rid)
        if not cur.exists():
            raise HTTPException(404, "no such job")
        kept = store.dir / ".history" / "jobs" / store._fname(rid)
        files = sorted(kept.glob("*.json"), key=lambda p: int(p.stem) if p.stem.isdigit() else 0) if kept.exists() else []
        states = []
        for f in [*files, cur]:
            try:
                states.append((json.loads(f.read_text()), f.stat().st_size))
            except (OSError, ValueError):
                continue
        return changes(states)


if __name__ == "__main__":
    a = {"id": "j", "createdAt": "t0", "updatedAt": "t0", "title": "x", "status": "대기"}
    b = {**a, "updatedAt": "t1", "status": "성공", "goal": "why we ran it"}
    c = {**b, "updatedAt": "t2", "goal": ""}
    d = {**c, "updatedAt": "t3"}  # a save that changed nothing
    log = changes([(a, 100), (b, 160), (c, 140), (d, 140)])
    assert [e["kind"] for e in log] == ["updated", "updated", "created"], log
    assert log[0]["removed"] == ["goal"] and log[0]["delta"] == -20 and log[0]["at"] == "t2"
    assert log[1]["added"] == ["goal"] and log[1]["changed"] == ["status"] and log[1]["delta"] == 60
    assert log[2]["size"] == 100 and log[2]["delta"] == 100
    assert changes([(b, 160), (c, 140)])[-1]["kind"] == "oldest", "history ran out: not called the making"
    e = {**d, "updatedAt": "t4", OUT: 5000}
    f = {**e, "updatedAt": "t5", OUT: 3000}
    log = changes([(d, 140), (e, 160), (f, 160)])
    assert (log[0]["out"], log[0]["outDelta"], log[0]["changed"]) == (3000, -2000, []), log[0]
    assert (log[1]["out"], log[1]["outDelta"], log[1]["added"]) == (5000, 5000, []), log[1]
    assert "out" not in log[2]
    print("ok")
