"""Copy jobrun job lists into jobboard, every INTERVAL seconds.

Two sources, each on only when its variable is set (the manifest's start.env):
JOBBOARD_PULL_SSH names an SSH host (the analysis server, `jobrun/jobrun.py list`
there), JOBBOARD_PULL_LOCAL a local jobrun command (this Mac's, e.g.
~/Research/jobrun_local/jobrun). The job DBs stay the original: fields from them
are overwritten here, and what people add in jobboard (note, tags, params)
is left alone. `inputs` comes from the job when the job names parents (a `job`
parameter); otherwise it is left to people too.
"""
import copy
import json
import os
import re
import subprocess
import threading
import time
from datetime import datetime, timezone

INTERVAL = 30
STATUS = {"queued": "대기", "running": "실행", "done": "성공", "failed": "실패"}
# ponytail: a parent is recognised by the shape of a jobrun id; read `jobrun recipes` for the `job` type if a param ever looks like one by chance.
JOB_ID = re.compile(r"^\d{8}-\d{6}-[0-9a-f]{6}$")


def to_record(job, server):
    parents = [v for v in job["params"].values() if isinstance(v, str) and JOB_ID.match(v)]
    # The name: the recipe, then each parameter as k=v — not the parents (the flow draws those), not one left empty.
    params = " ".join(f"{k}={v}" for k, v in job["params"].items() if v not in parents and v not in (None, ""))
    title = f"{job['recipe']} {params}".strip()
    if job["error"]:
        title += f" — {job['error']}"
    rec = {
        "id": f"jobrun-{job['id']}", "jobId": job["id"], "title": title,
        "date": job["submitted_at"][:10], "time": job["submitted_at"][11:16],
        "status": STATUS[job["state"]], "recipe": job["recipe"], "server": server,
        "submitter": job["submitted_by"], "output": job["output_dir"],
        "paramValues": job["params"], "error": job["error"],
        "started": job.get("started_at"), "ended": job.get("ended_at"),
        "command": " ".join(job.get("argv") or []),
        "outputSize": job.get("out_bytes"),  # bytes in the output folder once the job ended
    }
    if parents:
        rec["inputs"] = [{"id": f"jobrun-{p}"} for p in parents]
    return rec


def apply_jobs(doc, jobs, server):
    """Lay the jobs over doc["jobs"]. True if anything changed."""
    now = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    have = {r.get("id"): r for r in doc["jobs"]}
    changed = False
    for job in jobs:
        rec = to_record(job, server)
        # Every job wears a tag of its own, job/<the id's last six hex>, beside whatever people tag it with.
        # ponytail: six random hex per job, unique until some 10^3–10^4 jobs; widen to the full id if two ever meet.
        tag = f"job/{job['id'].rsplit('-', 1)[-1]}"
        old = have.get(rec["id"])
        if old is None:
            # The project it was submitted under (jobrun --project) puts it on that project's
            # board: projects are made wearing their own name. Only on arrival — taken off
            # the board later, it stays off.
            tags = [tag, *([job["project"]] if job.get("project") else [])]
            doc["jobs"].insert(0, {**rec, "tags": tags, "createdAt": now, "updatedAt": now})
            changed = True
            continue
        if any(old.get(k) != v for k, v in rec.items()):
            old.update(rec, updatedAt=now)
            changed = True
        if tag not in (old.get("tags") or []):
            old.update(tags=[*(old.get("tags") or []), tag], updatedAt=now)
            changed = True
    return changed


def sources():
    """(server name, argv that prints the job list) for each source that is on."""
    out = []
    if os.environ.get("JOBBOARD_PULL_SSH"):
        host = os.environ["JOBBOARD_PULL_SSH"]
        out.append((host, ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host,
                           "python3 jobrun/jobrun.py list"]))
    if os.environ.get("JOBBOARD_PULL_LOCAL"):
        out.append(("local", [os.path.expanduser(os.environ["JOBBOARD_PULL_LOCAL"]), "list"]))
    return out


def pull_once(store, server, argv):
    done = subprocess.run(argv, capture_output=True, text=True, timeout=60, check=True)
    jobs = json.loads(done.stdout)
    with store.lock:
        cur = store.read()
        new = copy.deepcopy(cur)
        if apply_jobs(new, jobs, server):
            store.write(new, "jobrun", replaces=cur)


def start(store):
    srcs = sources()
    if not srcs:
        return

    def loop():
        # ponytail: fetches the whole list each time; add a since= when jobs reach the thousands.
        while True:
            for server, argv in srcs:
                try:
                    pull_once(store, server, argv)
                except Exception as exc:  # a source being away must not stop the loop
                    why = (getattr(exc, "stderr", "") or "").strip()[-300:]   # ssh says why it gave up
                    print(f"[pull_stark] {server}: {exc!r}{f' — {why}' if why else ''}", flush=True)
            time.sleep(INTERVAL)

    threading.Thread(target=loop, daemon=True, name="pull_stark").start()


if __name__ == "__main__":  # self-check: python3 pull_stark.py
    job = {"id": "j1", "recipe": "fail", "params": {"code": 9}, "error": None, "state": "running",
           "submitted_at": "2026-11-09T07:16:19.468+09:00", "submitted_by": "me", "output_dir": "/o"}
    doc = {"jobs": []}
    assert apply_jobs(doc, [job], "h")
    r = doc["jobs"][0]
    assert (r["status"], r["date"], r["time"], r["title"]) == ("실행", "2026-11-09", "07:16", "fail code=9")
    assert r["tags"] == ["job/j1"]
    assert not apply_jobs(doc, [job], "h"), "unchanged job must not write"
    r["note"] = "mine"
    assert apply_jobs(doc, [{**job, "state": "failed", "error": "exit code 9"}], "h")
    assert len(doc["jobs"]) == 1 and r["status"] == "실패" and r["note"] == "mine"
    assert r["title"] == "fail code=9 — exit code 9"
    assert "inputs" not in r, "a job with no parent leaves inputs to people"
    r["tags"] = ["STARK"]
    assert apply_jobs(doc, [{**job, "state": "failed", "error": "exit code 9"}], "h")
    assert r["tags"] == ["STARK", "job/j1"], "its own tag comes back, people's tags stay"
    assert not apply_jobs(doc, [{**job, "state": "failed", "error": "exit code 9"}], "h")
    kid = {**job, "id": "j2", "recipe": "plot", "params": {"scan": "20261110-220405-219c0f"}, "state": "done"}
    assert to_record(kid, "h")["inputs"] == [{"id": "jobrun-20261110-220405-219c0f"}]
    assert to_record(kid, "h")["title"] == "plot", "a parent id is the edge, not the title"
    assert to_record({**kid, "params": {"scan": "20261110-220405-219c0f", "more": "", "n": 3}}, "h")["title"] == "plot n=3", "an empty one is left out"
    assert to_record({**kid, "out_bytes": 1234}, "h")["outputSize"] == 1234
    fresh = {"jobs": []}
    apply_jobs(fresh, [{**job, "id": "20261111-000000-abc123", "project": "AToM-X"}], "h")
    assert fresh["jobs"][0]["tags"] == ["job/abc123", "AToM-X"], "it arrives on its project's board"
    fresh["jobs"][0]["tags"] = ["job/abc123"]
    apply_jobs(fresh, [{**job, "id": "20261111-000000-abc123", "project": "AToM-X", "state": "done"}], "h")
    assert fresh["jobs"][0]["tags"] == ["job/abc123"], "taken off its board, it stays off"
    print("ok")
