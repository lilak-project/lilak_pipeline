"""One job's live side, read from its jobrun when the flow tab asks: the log's
end, the output files, the recipe's own description, and a file to show. And the
way in: each source's recipes (`/api/recipes`) and a new job (`/api/submit`),
which the portal's MCP tools (job_recipes, submit_job) call.

The record says which source the job came from (`server`); the same sources
pull_stark reads (JOBBOARD_PULL_SSH, JOBBOARD_PULL_LOCAL) answer here. A file is
served only if jobrun lists it in that job's output folder.
"""
import json
import mimetypes
import os
import urllib.request
from pathlib import Path
import shlex
import subprocess

from fastapi import Body, Depends, FastAPI, HTTPException, Request, Response

from lilak_portal_auth import signed_in
from pull_stark import JOB_ID, pull_once, sources


def projects_place() -> str:
    """The project_manager project this jobboard's projects live in: its share set's (jobboard's
    set holds project_manager/research), else project_manager's main project."""
    root = Path(os.environ.get("PORTAL_DATA_ROOT", ""))
    svc, proj = os.environ.get("PORTAL_SERVICE", "jobboard"), os.environ.get("PORTAL_PROJECT", "")
    try:
        for st in json.loads((root / "_portal" / "share_sets.json").read_text()).get("sets") or []:
            m = st.get("members") or {}
            if m.get(svc) == proj and m.get("project_manager"):
                return m["project_manager"]
    except (OSError, ValueError):
        pass
    try:
        return json.loads((root / "project_manager" / "service.json").read_text()).get("entry_project") or ""
    except (OSError, ValueError):
        return ""


def own_tag(rec: dict) -> str:
    """A project's place, as the board and jobrun read it: the tag that is its name or ends in it (AToM-X/ihm)."""
    name = str(rec.get("name") or "")
    own = [t for t in rec.get("tags") or [] if isinstance(t, str)
           and (t.lower() == name.lower() or t.lower().endswith("/" + name.lower()))]
    return own[0] if own else name


def resolve_project(want: str, records: list) -> str:
    """The project's tag path for `want` (its name or its path), or a ValueError saying what exists."""
    w = want.strip().lower()
    hits = sorted({own_tag(r) for r in records if r.get("name") and w in (str(r["name"]).lower(), own_tag(r).lower())})
    if len(hits) == 1:
        return hits[0]
    if hits:
        raise ValueError(f"{want!r} 에 맞는 프로젝트가 여럿입니다: {', '.join(hits)} — 경로로 주세요")
    raise ValueError(f"그런 프로젝트가 없습니다: {want!r} — 먼저 만드세요 (있는 것: {', '.join(sorted(own_tag(r) for r in records if r.get('name'))) or '없음'})")


def mount(app: FastAPI, store) -> None:
    def source(job_id: str) -> list:
        if not JOB_ID.match(job_id):
            raise HTTPException(400, "not a jobrun id")
        rec = next((r for r in store.read().get("jobs", []) if r.get("jobId") == job_id), None)
        if rec is None:
            raise HTTPException(404, "no such job here")
        argv = dict(sources()).get(rec.get("server"))
        if argv is None:
            raise HTTPException(409, f"source {rec.get('server')!r} is not on")
        return argv[:-1]  # the source's command without its last word: "list", or for ssh the remote line

    def jobrun(argv: list, *args: str) -> dict:
        if argv[0] == "ssh":  # the remote side gets one command line
            cmd = argv + [shlex.join(["python3", "jobrun/jobrun.py", *args])]
        else:
            cmd = argv + list(args)
        try:
            done = subprocess.run(cmd, capture_output=True, text=True, timeout=60, check=True)
        except (subprocess.SubprocessError, OSError) as exc:
            raise HTTPException(502, f"jobrun: {exc}") from None
        return json.loads(done.stdout)

    @app.get("/api/recipes")
    def recipes(me: dict = Depends(signed_in)) -> dict:
        """{server: {recipe: {description, params}}} for every source that is on; a source away says why."""
        out = {}
        for server, argv in sources():
            try:
                out[server] = jobrun(argv[:-1], "recipes")
            except HTTPException as exc:
                out[server] = {"error": exc.detail}
        return out

    def project_records(request: Request) -> list:
        """The projects of this jobboard's set — only their names and tags, to check a submit's
        project against — read from project_manager's store on disk (one record a file), as
        projects_place reads the sets. Not through /pp as the caller: a submit the inbox makes
        for a person carries a delegated token good at jobboard alone (web_service/CLAUDE.md,
        "How services reach each other"), and project_manager refuses it."""
        place = projects_place()
        d = Path(os.environ.get("PORTAL_DATA_ROOT", "")) / "project_manager" / "projects" / place / "data" / "projects"
        if not place or not d.is_dir():
            raise HTTPException(502, f"project_manager/{place or '?'} 를 읽을 수 없습니다: 프로젝트 목록이 없습니다")
        out = []
        for f in sorted(d.glob("*.json")):
            if f.name.startswith("_"):           # the store's own (order, local state)
                continue
            try:
                rec = json.loads(f.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue                          # half-written: the next submit reads it
            if isinstance(rec, dict):
                out.append(rec)
        return out

    def _recipes_of(argv: list) -> dict:
        try:
            return jobrun(argv[:-1], "recipes")
        except HTTPException:
            return {}   # a source away has none to offer

    @app.post("/api/submit")
    def submit(request: Request, body: dict = Body(...), me: dict = Depends(signed_in)) -> dict:
        """A job to jobrun on `server` (a source's name; if omitted, the one source that has the recipe), as the caller.
        jobrun checks the recipe, the parameters and the project, and says what is wrong."""
        srcs = dict(sources())
        recipe, params, project = str(body.get("recipe") or ""), body.get("params") or {}, str(body.get("project") or "")
        if not recipe or not isinstance(params, dict):
            raise HTTPException(400, "recipe and params (name: value) are needed")
        server = body.get("server") or ""
        if not server:   # none named: the one place that has this recipe
            have = [n for n, argv in srcs.items() if recipe in _recipes_of(argv)]
            if len(have) != 1:
                raise HTTPException(400, f"recipe {recipe!r} is on " + (
                    f"several servers ({', '.join(have)}): name one" if have else "no server that is on"))
            server = have[0]
        if server not in srcs:
            raise HTTPException(400, f"server {server!r} is not one of {', '.join(srcs) or '(none on)'}")
        # The project is checked here, against this jobboard's own project list (its share set's
        # project_manager), and handed to jobrun as its tag path — the same on every jobrun host.
        try:
            project = resolve_project(project, project_records(request))
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from None
        who = me.get("username") or (me.get("email") or "").split("@")[0]
        args = ["submit", recipe, *[f"{k}={v}" for k, v in params.items()], "--user", who, "--project", project]
        argv = srcs[server][:-1]
        cmd = argv + [shlex.join(["python3", "jobrun/jobrun.py", *args])] if argv[0] == "ssh" else argv + args
        try:
            done = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        except (subprocess.SubprocessError, OSError) as exc:
            raise HTTPException(502, f"jobrun: {exc}") from None
        if done.returncode != 0:   # jobrun's own word: unknown recipe, bad parameter, no such project
            raise HTTPException(400, (done.stderr or done.stdout).strip()[-500:] or f"jobrun exit {done.returncode}")
        job_id = json.loads(done.stdout)["id"]
        try:
            pull_once(store, server, srcs[server])   # on the board now, not in up to 30 s
        except Exception:  # noqa: BLE001 — the next pull brings it
            pass
        return {"id": f"jobrun-{job_id}", "jobId": job_id, "server": server}

    @app.get("/api/jobrun/{job_id}")
    def job(job_id: str, me: dict = Depends(signed_in)) -> dict:
        argv = source(job_id)
        out = jobrun(argv, "result", job_id)
        out["recipe_info"] = jobrun(argv, "recipes").get(out["recipe"], {})
        return out

    @app.get("/api/jobrun/{job_id}/file/{name}")
    def file(job_id: str, name: str, me: dict = Depends(signed_in)) -> Response:
        argv = source(job_id)
        res = jobrun(argv, "result", job_id)
        if name not in res["files"] or "/" in name:
            raise HTTPException(404, "not in this job's output")
        path = f"{res['output_dir']}/{name}"
        cmd = argv + [shlex.join(["cat", path])] if argv[0] == "ssh" else ["cat", path]
        try:
            body = subprocess.run(cmd, capture_output=True, timeout=60, check=True).stdout
        except (subprocess.SubprocessError, OSError) as exc:
            raise HTTPException(502, f"read: {exc}") from None
        return Response(body, media_type=mimetypes.guess_type(name)[0] or "application/octet-stream")


if __name__ == "__main__":  # self-check: python jobrun_api.py (with lilak_portal_auth on the path)
    recs = [{"name": "AToM-X", "tags": ["AToM-X"]}, {"name": "ihm", "tags": ["AToM-X/ihm"]},
            {"name": "KO-25-20", "tags": ["ELARK", "KO-25-20"]}]
    assert resolve_project("ihm", recs) == resolve_project("atom-x/IHM", recs) == "AToM-X/ihm"
    assert resolve_project("KO-25-20", recs) == "KO-25-20", "its own tag, not its first"
    try:
        resolve_project("nope", recs)
        raise AssertionError("an unknown project passed")
    except ValueError as exc:
        assert "AToM-X/ihm" in str(exc)
    print("ok")
