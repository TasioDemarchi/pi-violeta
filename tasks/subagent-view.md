# subagent-view
Visual layer for subagents in violeta (card above the editor + alt+a overlay), fed by a neutral launcher with no built-in roles.
Branch: main (work-unit commits when user asks). Project: /home/tasio/Documents/violeta.

## Specs
- S1: "como se muestran los sub agentes y la convinacion de teclas `alt+a` para visualizarlo." (from gentle-shell)
- S2: "Yo solo quiero la parte visual. Despues voy a determinar que estructura de agentes, sub-agentes y filosofia voy a usar."
- S3: Neutral launcher: tool `subagent_run` launches a child `pi --mode rpc` from ANY definition `~/.violeta/agent/agents/*.md` (frontmatter: name, description, model, thinking, tools; body = prompt). Zero roles/ODD/philosophy baked into the engine. One throwaway agent `example.md` exists only to test and MUST be deleted when everything is finished ("Recorda que ese agente de ejemplo hay que eliminarlo cuando este todo finalizado").
- S4: Card above the editor like gentle-shell: one row per task with status glyph, name, label, and fixed right-aligned columns `model · effort`, tokens, cost, elapsed; header `Agents · N active · M done`; finished rows stay 1 min (max 3); max ~a quarter of the terminal, rest folded into `… N more · alt+a to view`; degrades columns when narrow (task text, then model, tokens, cost; elapsed last); queued shows `queued`. Palette violeta (base #7502c7).
- S5: `alt+a` (and `/agents`) opens a full-terminal overlay: split view (task list left, selected task's thread right: header `name · status · model · tokens · elapsed`, thinking dimmed, text, tool calls), `j/k` task, `ctrl+j/k` scroll, `f` follow, `esc` back, `q` close; closing never cancels children; finished tasks remain listed as history with frozen elapsed.
- S6: Children's questions/exit handled safely: a silent child times out via stall watchdog; closing violeta stops running children; finished tasks persisted to `~/.violeta/agent/agents-history/`.

## Tasks
- T1 | S3,S6 | worker | engine: definitions loader, task store/thread model, rpc runner, tools (subagent_list_agents, subagent_run task|background, subagent_status, subagent_result, subagent_cancel), tests | done (uncommitted)
- T2 | S4,S5 | worker | views: card above editor + alt+a overlay on the T1 store contract, tests + pty validation | done (uncommitted)
- T3 | S3 | parent | create throwaway ~/.violeta/agent/agents/example.md for testing | commit: n/a
- T4 | S1-S6 | parent | independent verify per S#, README | commit: pending
- T5 | S3 | parent | DELETE ~/.violeta/agent/agents/example.md after everything is finished and confirm | commit: n/a

## Log
- L1 (user): "Bien, ahora de gentle-shell quiero traerme como se muestran los sub agentes y la convinacion de teclas `alt+a` para visualizarlo. Lista de tareas / Guardas contra comandos destructivos y grants para repos externos / jobs en backgroud y monitors" (todo list, guards, jobs are separate later features)
- L2 (user): "Como se configure el motor de sub-agentes determina que sub-agentes existira ? o el motor es sobre la parte visual ?. Yo solo quiero la parte visual. Despues voy a determinar que estructura de agentes, sub-agentes y filosofia voy a usar."
- L3 (user): "Vamos asi. Recorda que ese agente de ejemplo hay que eliminarlo cuando este todo finalizado"
