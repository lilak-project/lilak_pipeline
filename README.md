# lilak_pipeline

The analysis pipeline services of the [LILAK Web Portal](https://github.com/lilak-project).

| folder | what |
|---|---|
| `jobbook/` | one record per job: status, tool, recipe, runs, server, who submitted it, fixed label, parameter sets, related logs, earlier jobs, output path. Its **flow board** tab (`src-lilak/flow/`) shows the analysis flow around one task: everything upstream, one path downstream; left click focuses (and re-centres on a task), right click / long press opens a task's details. It keeps evaluations, each person's start task / favourites / pinned flows and the project's shared pins in the same document. `npm run check` tests the drawing rules; `?demo=1` shows made-up tasks |
| `seed/` | each service's portal manifest |

Drawn with lilak_rack's frame (`racklist`, aliased as `../../lilak_rack/racklist`) and stored by
its `rackstore`, so the portal's stack needs `lilak_rack` beside this checkout. Parameter and log
links point at `lilak_log`'s `parameters` and `logbook`. Tags are their own set: `capabilities.tags`
is `"jobs"`.

A job's original record is the analysis server's job DB; `jobbook` is the portal's copy to read.
