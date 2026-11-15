"""Approving a job: who said "this result stands", for whom, under which mode.

Every approval, cancel and refused agent attempt is one entry in the job's
`approvals` list, appended and never removed — the list is the record, the last
approve/revoke is the state.

    {at, action: approve|revoke|confirm|request, by: 사람|플랫폼 agent|Claude|Codex,
     who, requester, run, mode, rule, reason, undid}

An approval no person gave counts like a reference's "agent 제시": it stands, but
is no ground for a report until a person confirms it (`confirm`, people only;
POST /api/confirm does a job and everything above it at once). A person
cancelling an agent's approval marks the entry `undid` — the board then asks for
a second look at everything built on it.

The mode is decided here, per flow step (the job's recipe), from the document
key `approval`. A sub-project (tag AToM-X/ihm) takes its parent's word where it has
none of its own — the nearest project wins — and a parent's rule covers its subs:

    {kind: "mode", project, step, mode: human|rule|agent}   step "" = the project's default
    {kind: "rule", project, step, params, by, at, from}     "jobs like this approve themselves"

A rule's params narrow it: {name: {min, max}} for a number range, {name: value}
for an exact value; a job matches when every named parameter fits.

human = people only; rule = an agent may approve when a rule matches the job
(a person made it with "이런 일은 자동" while approving); agent = an agent may.
With no mode set it is human. A platform agent's own run mode (delegate's
approval: human|similar|auto) can only narrow that. People always may.
Only the portal's MCP decides `by` for a platform agent token, so an agent
cannot pass as a person.
"""
import copy
from datetime import datetime, timezone

from fastapi import Body, Depends, FastAPI, HTTPException

from lilak_portal_auth import signed_in

AGENT = "플랫폼 agent"
BYS = ("사람", AGENT, "Claude", "Codex")
MODES = ("human", "rule", "agent")


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _projects(job: dict) -> list:
    return [t for t in job.get("tags") or [] if not str(t).startswith("job/")]


def _within(tag, parent) -> bool:
    """racklist's tagWithin: the tag itself or inside it (AToM-X/ihm is inside AToM-X)."""
    t, p = str(tag or "").strip().lower(), str(parent or "").strip().lower()
    return bool(p) and (t == p or t.startswith(p + "/"))


def _depth(project: str, job: dict) -> int:
    """How deep `project` is among the job's tags it covers: -1 if it covers none. A sub-project counts deeper."""
    return str(project).count("/") if any(_within(t, project) for t in _projects(job)) else -1


def mode_of(job: dict, policy: list) -> str:
    """The nearest project's word: a sub-project's own step mode, then its default, then its parent's, …; else human."""
    step = job.get("recipe") or ""
    modes = [p for p in policy if p.get("kind") == "mode" and p.get("mode") in MODES and _depth(p.get("project"), job) >= 0]
    modes.sort(key=lambda p: (_depth(p["project"], job), p.get("step") == step), reverse=True)
    hit = next((p for p in modes if p.get("step") in (step, "", None)), None)
    return hit["mode"] if hit else "human"


def _fits(want, got) -> bool:
    if isinstance(want, dict):
        try:
            v = float(got)
        except (TypeError, ValueError):
            return False
        return (want.get("min") is None or v >= float(want["min"])) and (want.get("max") is None or v <= float(want["max"]))
    return str(want) == str(got)


def rule_for(job: dict, policy: list):
    projs, step, vals = _projects(job), job.get("recipe") or "", job.get("paramValues") or {}
    return next((p for p in policy if p.get("kind") == "rule" and p.get("step") == step
                 and (not p.get("project") or any(_within(t, p["project"]) for t in projs))
                 and all(k in vals and _fits(w, vals[k]) for k, w in (p.get("params") or {}).items())), None)


def rule_params(job: dict, asked) -> dict:
    """The parameters a new rule holds: what the person gave, else this job's own values (a number as a one-point range)."""
    if isinstance(asked, dict):
        return {str(k): v for k, v in asked.items() if isinstance(v, (dict, str, int, float))}
    out = {}
    for k, v in (job.get("paramValues") or {}).items():
        out[k] = {"min": v, "max": v} if isinstance(v, (int, float)) and not isinstance(v, bool) else v
    return out


def decide(job: dict, policy: list, by: str, run_mode: str = "") -> tuple:
    """(allowed, mode, rule id) for `by` approving `job`."""
    mode, rule = mode_of(job, policy), rule_for(job, policy)
    if by != AGENT:
        return True, mode, None
    ok = mode == "agent" or (mode == "rule" and rule is not None)
    # The run's own mode narrows: human never, similar only on a rule, auto as the step allows.
    if run_mode == "human" or (run_mode == "similar" and rule is None):
        ok = False
    return ok, mode, (rule or {}).get("id") if ok and mode == "rule" else None


def state(approvals: list) -> dict:
    """The job's approval now: the last approve/revoke, a person's confirm after it, and a request left after it."""
    last = next((a for a in reversed(approvals or []) if a.get("action") in ("approve", "revoke")), None)
    asked = next((a for a in reversed(approvals or []) if a.get("action") == "request"), None)
    approved = bool(last and last["action"] == "approve")
    by = last.get("by") if approved else None
    confirmed = approved and (by == "사람" or any(a.get("action") == "confirm" and a["at"] >= last["at"]
                                                   for a in approvals))
    return {"approved": approved, "by": by, "confirmed": bool(confirmed),
            "requested": bool(asked and (not last or asked["at"] > last["at"]) and not approved)}


def mount(app: FastAPI, store) -> None:
    @app.post("/api/approve/{rid}")
    def approve(rid: str, body: dict = Body(...), me: dict = Depends(signed_in)) -> dict:
        action = body.get("action") or "approve"
        if action not in ("approve", "revoke", "confirm"):
            raise HTTPException(400, "action is one of approve, revoke, confirm")
        by = body.get("by") or "사람"
        if by not in BYS:
            raise HTTPException(400, f"by is one of {', '.join(BYS)}")
        who = me.get("username") or (me.get("email") or "").split("@")[0]
        with store.lock:
            cur = store.read()
            new = copy.deepcopy(cur)
            job = next((j for j in new.get("jobs") or [] if str(j.get("id")) == rid), None)
            if job is None:
                raise HTTPException(404, "no such job")
            policy = new.get("approval") or []
            if action == "confirm":
                entry = _confirm(job, by, who, body.get("reason"))
                ok, mode = True, mode_of(job, policy)
            else:
                ok, mode, rule = decide(job, policy, by, str(body.get("run_mode") or ""))
                was = state(job.get("approvals"))
                entry = {"at": now(), "action": action if ok else "request", "by": by, "who": who,
                         "requester": body.get("requester") or (who if by != "사람" else ""),
                         "run": body.get("run") or "", "mode": mode, "rule": rule or "",
                         "reason": str(body.get("reason") or "")[:4000],
                         # a person taking back an approval no person gave: what was built on it needs a look
                         "undid": was["by"] if ok and action == "revoke" and was["approved"] and was["by"] != "사람" else ""}
                _append(job, entry)
            # A person approving may say "jobs like this approve themselves": a rule for this step.
            if ok and action == "approve" and by == "사람" and body.get("make_rule"):
                # in the job's deepest project: a rule made in AToM-X/ihm stays there; one made in AToM-X covers its subs
                projs = sorted(_projects(job), key=lambda t: str(t).count("/"), reverse=True)
                new["approval"] = [{"id": f"rule-{rid}-{entry['at']}", "kind": "rule", "project": projs[0] if projs else "",
                                    "step": job.get("recipe") or "", "params": rule_params(job, body.get("rule_params")),
                                    "by": who, "from": rid,
                                    "createdAt": entry["at"], "updatedAt": entry["at"]}, *policy]
            store.write(new, me.get("email") or who, replaces=cur)
        return {"allowed": ok, "mode": mode, "entry": entry, "state": state(job["approvals"])}

    @app.post("/api/confirm")
    def confirm_all(body: dict = Body(...), me: dict = Depends(signed_in)) -> dict:
        """A person confirms, in one save, every approval no person gave among `ids` (a result and all above it)."""
        ids = {str(i) for i in body.get("ids") or []}
        who = me.get("username") or (me.get("email") or "").split("@")[0]
        with store.lock:
            cur = store.read()
            new = copy.deepcopy(cur)
            done = []
            for job in new.get("jobs") or []:
                s_ = state(job.get("approvals"))
                if str(job.get("id")) in ids and s_["approved"] and not s_["confirmed"]:
                    _confirm(job, "사람", who, body.get("reason"))
                    done.append(job["id"])
            if done:
                store.write(new, me.get("email") or who, replaces=cur)
        return {"confirmed": done}


def _append(job: dict, entry: dict) -> None:
    job["approvals"] = [*(job.get("approvals") or []), {k: v for k, v in entry.items() if v != ""}]
    job["updatedAt"] = entry["at"]


def _confirm(job: dict, by: str, who: str, reason) -> dict:
    """A person's word that an agent's approval stands; refused for anyone else, or with nothing to confirm."""
    if by != "사람":
        raise HTTPException(403, "only a person can confirm")
    s_ = state(job.get("approvals"))
    if not s_["approved"] or s_["confirmed"]:
        raise HTTPException(409, "no agent approval to confirm")
    entry = {"at": now(), "action": "confirm", "by": by, "who": who, "reason": str(reason or "")[:4000]}
    _append(job, entry)
    return entry


if __name__ == "__main__":
    job = {"id": "j", "recipe": "ihm-scan", "tags": ["job/abc123", "AToM-X"]}
    assert decide(job, [], AGENT, "auto") == (False, "human", None), "no mode set: people only"
    assert decide(job, [], "사람")[0], "a person always may"
    pol = [{"kind": "mode", "project": "AToM-X", "step": "", "mode": "rule"}]
    assert decide(job, pol, AGENT, "auto")[0] is False, "rule mode with no rule"
    pol.append({"id": "r1", "kind": "rule", "project": "AToM-X", "step": "ihm-scan"})
    assert decide(job, pol, AGENT, "auto") == (True, "rule", "r1")
    assert decide(job, pol, AGENT, "similar")[0] and not decide(job, pol, AGENT, "human")[0]
    pol.append({"kind": "mode", "project": "AToM-X", "step": "ihm-scan", "mode": "human"})
    assert not decide(job, pol, AGENT, "auto")[0], "the step's own mode wins over the project's"
    pol[-1]["mode"] = "agent"
    assert decide(job, pol, AGENT, "auto")[0] and decide(job, pol, AGENT, "similar")[0], "similar still needs the rule, which is there"
    assert state([{"at": "1", "action": "approve", "by": AGENT}]) == {"approved": True, "by": AGENT, "confirmed": False, "requested": False}
    assert state([{"at": "1", "action": "approve", "by": "사람"}, {"at": "2", "action": "revoke", "by": "사람"},
                  {"at": "3", "action": "request", "by": AGENT}]) == {"approved": False, "by": None, "confirmed": False, "requested": True}
    assert state([{"at": "1", "action": "approve", "by": AGENT}])["confirmed"] is False
    assert state([{"at": "1", "action": "approve", "by": AGENT}, {"at": "2", "action": "confirm", "by": "사람"}])["confirmed"]
    assert state([{"at": "1", "action": "approve", "by": "사람"}])["confirmed"], "a person's approval needs no confirm"
    j = {"id": "k", "approvals": [{"at": "1", "action": "approve", "by": AGENT}]}
    _confirm(j, "사람", "me", "")
    try:
        _confirm(j, "사람", "me", "")
        raise AssertionError("confirmed twice")
    except HTTPException:
        pass
    try:
        _confirm({"approvals": [{"at": "1", "action": "approve", "by": AGENT}]}, AGENT, "a", "")
        raise AssertionError("an agent confirmed")
    except HTTPException:
        pass
    # Parameter ranges: the rule made from a job holds its values; a range widens it.
    scan = {**job, "paramValues": {"vmin": 0, "vmax": 500, "gas": "He"}}
    rp = rule_params(scan, None)
    assert rp == {"vmin": {"min": 0, "max": 0}, "vmax": {"min": 500, "max": 500}, "gas": "He"}
    pol = [{"kind": "mode", "project": "AToM-X", "mode": "rule"},
           {"id": "r2", "kind": "rule", "project": "AToM-X", "step": "ihm-scan", "params": {"vmax": {"min": 100, "max": 600}, "gas": "He"}}]
    assert decide(scan, pol, AGENT, "auto")[0]
    assert not decide({**scan, "paramValues": {"vmax": 700, "gas": "He"}}, pol, AGENT, "auto")[0], "out of range"
    assert not decide({**scan, "paramValues": {"vmax": 500, "gas": "Ar"}}, pol, AGENT, "auto")[0], "other gas"
    assert not decide({**scan, "paramValues": {"gas": "He"}}, pol, AGENT, "auto")[0], "a named parameter missing"
    # Sub-projects: the nearest project's word; a parent's rule covers its subs, a sub's stays in it.
    sub = {"id": "s", "recipe": "ihm-scan", "tags": ["job/s1", "AToM-X/ihm"], "paramValues": {}}
    pol = [{"kind": "mode", "project": "AToM-X", "step": "", "mode": "agent"}]
    assert mode_of(sub, pol) == "agent", "a sub with no word of its own takes its parent's"
    pol.append({"kind": "mode", "project": "AToM-X/ihm", "step": "", "mode": "human"})
    assert mode_of(sub, pol) == "human", "the sub's own default beats the parent's"
    pol.append({"kind": "mode", "project": "AToM-X", "step": "ihm-scan", "mode": "rule"})
    assert mode_of(sub, pol) == "human", "nearer project first, even over the parent's step mode"
    assert mode_of({**sub, "tags": ["AToM-X"]}, pol) == "rule"
    pol = [{"kind": "mode", "project": "AToM-X", "mode": "rule"},
           {"id": "rp", "kind": "rule", "project": "AToM-X", "step": "ihm-scan"}]
    assert decide(sub, pol, AGENT, "auto") == (True, "rule", "rp"), "a parent's rule covers its sub"
    pol[1]["project"] = "AToM-X/other"
    assert not decide(sub, pol, AGENT, "auto")[0], "a sibling's rule does not"
    assert _within("AToM-X/ihm", "atom-x") and not _within("AToM-Xtra", "AToM-X")
    print("ok")
