"""Evidence that keeps pointing at the same place in a source becomes a part.

A job's `evidence` links a reference_manager record and a place in it
({svc, proj, id, place, why, by, at}). When the same place of the same source is
cited a second time, the board asks whether to make that place a reference of its
own (a `part`, reference_manager's: type 'part', parent {id}, locator). Two routes:

    POST /api/evidence/promote {svc, proj, id, place, title?, citeKey?}
        Make the part in reference_manager (or take the one already there: same
        parent, same locator), then re-point EVERY job's evidence at that place to it:
        {..., id: <part>, place: "", placeWas: <place>, promotedAt}. One save.
    POST /api/evidence/decline {svc, proj, id, place, count}
        "Not now": ask again when the place has been cited twice as often
        (2 → 4 → 8); after three declines, never.

Both leave a line in the document key `evidence_log`, one record per place:
{id: "ev:<svc>/<proj>/<id>/<place>", svc, proj, ref, place, declines, nextAsk,
stop, promoted: [{at, by, part, count, created}]} — the decline list and the
promotion record together.

Writing in reference_manager is done for the person with a delegated token
(lilak_portal_auth.delegate), never with their own (web_service/CLAUDE.md).
"""
import copy
import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timezone

from fastapi import Body, Depends, FastAPI, HTTPException, Request

from lilak_portal_auth import delegate, signed_in

NEVER_AFTER = 3   # declines


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def log_id(svc, proj, ref, place) -> str:
    return f"ev:{svc}/{proj}/{ref}/{place}"


def count_place(jobs: list, svc, proj, ref, place) -> int:
    """How many evidence links, over every job, point at this place of this source."""
    return sum(1 for j in jobs for e in j.get("evidence") or []
               if isinstance(e, dict) and (e.get("svc"), e.get("proj"), str(e.get("id")), e.get("place") or "")
               == (svc, proj, str(ref), place))


def repoint(jobs: list, svc, proj, ref, place, part_id, at) -> int:
    """Every link at (source, place) now points at the part; the place it named is kept. Returns how many moved."""
    moved = 0
    for j in jobs:
        out = []
        for e in j.get("evidence") or []:
            if isinstance(e, dict) and (e.get("svc"), e.get("proj"), str(e.get("id")), e.get("place") or "") \
                    == (svc, proj, str(ref), place):
                e = {**e, "id": part_id, "place": "", "placeWas": place, "promotedAt": at}
                moved += 1
                if any((x.get("svc"), x.get("proj"), x.get("id"), x.get("place")) == (svc, proj, part_id, "") for x in out):
                    continue   # the job already pointed at the part itself: one link is enough
            out.append(e)
        if out != (j.get("evidence") or []):
            j["evidence"] = out
            j["updatedAt"] = at
    return moved


def declined(entry: dict, count: int, who: str, at: str) -> dict:
    """The log entry after one more "not now": ask again at twice this count; never after three."""
    n = int(entry.get("declines") or 0) + 1
    return {**entry, "declines": n, "nextAsk": max(2, count) * 2, "stop": n >= NEVER_AFTER,
            "lastDeclined": {"at": at, "by": who}, "updatedAt": at}


def _portal(path: str, auth: str, body=None):
    url = f"http://127.0.0.1:{os.environ.get('PORTAL_PORT', '8025')}{path}"
    req = urllib.request.Request(url, method="POST" if body is not None else "GET",
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": auth, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise HTTPException(502, f"{path}: {e.code} {e.read()[:200]!r}") from None
    except (OSError, ValueError) as e:
        raise HTTPException(502, f"{path}: {e}") from None


def mount(app: FastAPI, store) -> None:
    def who_of(me):
        return me.get("username") or (me.get("email") or "").split("@")[0]

    def key_of(body):
        svc, proj, ref, place = (str(body.get(k) or "") for k in ("svc", "proj", "id", "place"))
        if svc != "reference_manager" or not proj or not ref or not place:
            raise HTTPException(400, "svc(reference_manager), proj, id, place 가 필요합니다.")
        return svc, proj, ref, place

    def log_put(doc, entry):
        doc["evidence_log"] = [entry, *[x for x in doc.get("evidence_log") or [] if x.get("id") != entry["id"]]]

    @app.post("/api/evidence/promote")
    def promote(request: Request, body: dict = Body(...), me: dict = Depends(signed_in)) -> dict:
        svc, proj, ref, place = key_of(body)
        try:
            auth = delegate(request.headers.get("authorization", ""), f"{svc}/{proj}")
        except PermissionError as e:
            raise HTTPException(403, f"{svc}/{proj} 에 쓸 수 없습니다: {e}") from None
        base = f"/pp/{svc}/{proj}/api"
        refs = _portal(f"{base}/data", auth).get("references") or []
        parent = next((r for r in refs if str(r.get("id")) == ref), None)
        if parent is None:
            raise HTTPException(404, "그 레퍼런스가 없습니다.")
        pid = lambda r: (r.get("parent") or {}).get("id") if isinstance(r.get("parent"), dict) else r.get("parent")
        part = next((r for r in refs if r.get("type") == "part" and str(pid(r)) == ref and r.get("locator") == place), None)
        created = part is None
        if created:   # reference_manager's own shape: everything bibliographic stays on the parent
            rec = {"type": "part", "parent": {"id": ref}, "locator": place,
                   "title": str(body.get("title") or place),
                   "citeKey": str(body.get("citeKey") or f"{parent.get('citeKey') or ref}/{place.replace(' ', '_')}")}
            part = _portal(f"{base}/records", auth, {"key": "references", "record": rec})["record"]
        at, who = now(), who_of(me)
        with store.lock:
            cur = store.read()
            new = copy.deepcopy(cur)
            jobs = new.get("jobs") or []
            count = count_place(jobs, svc, proj, ref, place)
            moved = repoint(jobs, svc, proj, ref, place, str(part["id"]), at)
            lid = log_id(svc, proj, ref, place)
            entry = next((x for x in new.get("evidence_log") or [] if x.get("id") == lid), None) or \
                {"id": lid, "svc": svc, "proj": proj, "ref": ref, "place": place, "createdAt": at}
            entry = {**entry, "updatedAt": at, "promoted": [*(entry.get("promoted") or []),
                     {"at": at, "by": who, "part": str(part["id"]), "count": count, "moved": moved, "created": created}]}
            log_put(new, entry)
            store.write(new, me.get("email") or who, replaces=cur)
        return {"part": {"id": part["id"], "citeKey": part.get("citeKey"), "locator": part.get("locator")},
                "created": created, "moved": moved}

    @app.post("/api/evidence/decline")
    def decline(body: dict = Body(...), me: dict = Depends(signed_in)) -> dict:
        svc, proj, ref, place = key_of(body)
        at, who = now(), who_of(me)
        with store.lock:
            cur = store.read()
            new = copy.deepcopy(cur)
            count = count_place(new.get("jobs") or [], svc, proj, ref, place)
            lid = log_id(svc, proj, ref, place)
            entry = next((x for x in new.get("evidence_log") or [] if x.get("id") == lid), None) or \
                {"id": lid, "svc": svc, "proj": proj, "ref": ref, "place": place, "createdAt": at}
            entry = declined(entry, count, who, at)
            log_put(new, entry)
            store.write(new, me.get("email") or who, replaces=cur)
        return entry


if __name__ == "__main__":  # self-check
    J = lambda *ev: {"evidence": [dict(svc="reference_manager", proj="papers", id=i, place=p) for i, p in ev]}
    jobs = [J(("r1", "Figure 3")), J(("r1", "Figure 3"), ("r1", "Table 2")), J(("r2", "Figure 3"))]
    assert count_place(jobs, "reference_manager", "papers", "r1", "Figure 3") == 2
    assert count_place(jobs, "reference_manager", "papers", "r1", "") == 0
    assert repoint(jobs, "reference_manager", "papers", "r1", "Figure 3", "p9", "t") == 2
    assert jobs[0]["evidence"][0] == {"svc": "reference_manager", "proj": "papers", "id": "p9", "place": "",
                                      "placeWas": "Figure 3", "promotedAt": "t"}
    assert jobs[1]["evidence"][1]["place"] == "Table 2" and jobs[2]["evidence"][0]["id"] == "r2", "others untouched"
    both = [J(("p9", ""), ("r1", "Figure 3"))]
    repoint(both, "reference_manager", "papers", "r1", "Figure 3", "p9", "t")
    assert len(both[0]["evidence"]) == 1, "a job already on the part keeps one link"
    e = declined({}, 2, "me", "t")
    assert (e["declines"], e["nextAsk"], e["stop"]) == (1, 4, False)
    e = declined(e, 4, "me", "t")
    assert (e["declines"], e["nextAsk"], e["stop"]) == (2, 8, False)
    assert declined(e, 8, "me", "t")["stop"], "three declines: never again"
    print("ok")
