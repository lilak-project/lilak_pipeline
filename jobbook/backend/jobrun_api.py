"""One job's live side, read from its jobrun when the flow tab asks: the log's
end, the output files, the recipe's own description, and a file to show.

The record says which source the job came from (`server`); the same sources
pull_stark reads (JOBBOOK_PULL_SSH, JOBBOOK_PULL_LOCAL) answer here. A file is
served only if jobrun lists it in that job's output folder.
"""
import json
import mimetypes
import shlex
import subprocess

from fastapi import Depends, FastAPI, HTTPException, Response

from lilak_portal_auth import signed_in
from pull_stark import JOB_ID, sources


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
