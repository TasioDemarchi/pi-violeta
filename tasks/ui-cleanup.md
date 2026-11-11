# ui-cleanup
Five owner requests: delete the morning-brief leftover key, English-only UI with
Spanish model-facing prompts, decluttered screen, one `/btw` command, and a
read-only confirmation that pi-claude-bridge cannot fire on its own.
Runner: npm test

## No-objetivos
- **pi-claude-bridge is not touched** ("Lo pedí yo y lo quiero tener... No lo toques").
- `/context` and `/usage` are not merged (owner asked for a recommendation only; no change without his yes).
- The tasks widget is not modified ("Las tareas quedan como están").
- No new features beyond this document; `modes/jarvis.md` is not edited (Jarvis
  speaking Spanish comes from the mode, not the dictionary).
- Screen labels stay English; nothing is re-translated to Spanish.

## Specs
S1. The `briefSaid` key is gone from the live config.
    Accept: `jq 'has("briefSaid")' ~/.violeta/agent/violeta.json` prints `false`; repo grep for the brief feature returns nothing (already measured: no repo code, string, command or test references it).
    Check: manual: run the jq command and paste its output.

S2. Every dictionary string that reaches a model asks for a **Spanish** answer.
    Accept: the surviving dictionary's `btw.systemPrompt` instructs answering in Spanish (today the English one says "Answer in English" — that is why `/btw` answered in English); the second model-facing string found by measurement, `guard.explainPrompt`, asks for the explanation **in Spanish** while keeping the three English `Action:/Files:/Folders:` labels, so the parser and the dialog stay English and keep working.
    Check: node --test tests/btw-extension.test.ts tests/guard-explain.test.ts

S3. The interface is English-only and the language feature is deleted.
    Accept: no `/language` command registered, `src/language-state.ts` and `tests/language-state.test.ts` deleted, every `readLanguage`/`writeLanguage`/`setLanguage` call removed from `extensions/` (the `getLanguage`/`setLanguage` definitions inside `src/i18n.ts` itself die in T4), the `"language"` key removed from `~/.violeta/agent/violeta.json`; `grep -rn "language-state" src extensions tests` is empty.
    Check: npm test; manual: `jq 'has("language")' ~/.violeta/agent/violeta.json` prints `false`.

S4. `src/i18n.ts` holds exactly one dictionary (English) and no language plumbing.
    Accept: no `const es`, no `Language` type, no `getLanguage`/`setLanguage`, no per-access Proxy; all exported namespaces resolve directly; dictionary-driven tests assert the English strings.
    Check: npm test

S5. `PROJECT` lives only in the header.
    Accept: the header reads `violeta · pi <version> · <mode> · <project> · <branch>`; the sidebar has no PROYECTO section and the footer no longer prints the project name.
    Check: npm test tests/sidebar-content.test.ts tests/ui-extension-smoke.test.ts

S6. `MODEL` and `USAGE` are one sidebar section.
    Accept: one title covering model+thinking, context bar and tokens/cost; two separate titles no longer exist in `src/sidebar-content.ts`.
    Check: npm test tests/sidebar-content.test.ts

S7. One side chat: `/btw` and `alt+b` only.
    Accept: `/btwn` and `/btwv` are unregistered; `alt+b` keeps its current binding (opens the fullscreen reader, exactly as today — it never pointed at the panel); asking with `/btw` opens the **fullscreen reader** instead of the 3-line panel (the panel stops being one of the five above-editor widgets); dead code (`renderBtwPanel` widget path, sidebar swap, `withContext=false` plumbing) is deleted; obsolete tests deleted and counted in the close report.
    Check: npm test tests/btw-extension.test.ts tests/btw-state.test.ts tests/btw-request.test.ts

S8. README.md states the new behavior in plain Spanish.
    Accept: README documents English-only UI, header contents, `/btw`+`alt+b`, and that the bridge is untouched.
    Check: manual: owner reads the section at close.

S9. The bridge rule is written down where the owner can re-read it.
    Accept: README documents that `pi-claude-bridge` fires only on an explicit `claude-bridge/*` pick in `/model` (AskClaude, the only other trigger, is not installed); the close report pastes fresh grep evidence over `modes/` and `agents/` (no `claude-bridge` model named) as the running proof.
    Check: manual: owner reads the section; Jarvis pastes the grep output at close.

## Tasks
T1. Delete `briefSaid` from `~/.violeta/agent/violeta.json` — specs: S1 — test: n/a — riesgo: no — commit: - — quién: Jarvis (live config, outside the repo; jq edit, reversible)
T2. Model-facing dictionary strings ask for Spanish answers (btw.systemPrompt, guard.explainPrompt + explainLabels) — specs: S2 — test: required — riesgo: sí — commit: - (S2: btw 22/22 y guard-explain 9/9; suite 847 en verde con `env -u VIOLETA_AGENTS_CHILD`. `explainLabels` NO se tocan, ver D2)
T3. Delete `/language`, `src/language-state.ts` and the `"language"` config key (i18n.ts itself untouched until T4) — specs: S3 — test: required — riesgo: no — commit: - — quién: Jarvis (config key only; the rest is a builder task)
T4. `src/i18n.ts` English-only: drop the Spanish dictionary and language plumbing; migrate pure-src view tests (sidebar, todo card, agents card, jobs, usage, context, palette, changes, guard, notify, models) — specs: S4 — test: required — riesgo: no — commit: -
T5. Migrate extension-level tests to the English dictionary (btw, guard dialog/unattended, mode, voice, ui smoke, shipped definitions) — specs: S4 — test: required — riesgo: no — commit: -
T6. Header gains project + branch; remove PROYECTO from the sidebar and the project name from the footer — specs: S5 — test: required — riesgo: no — commit: -
T7. Unify MODEL + USAGE under one sidebar title — specs: S6 — test: required — riesgo: no — commit: -
T8. One `/btw`: delete `/btwn` and `/btwv`, asking opens the fullscreen reader, remove the panel widget and dead code (alt+b keeps opening the reader as today) — specs: S7 — test: required — riesgo: sí — commit: -
T9. Update README.md (English-only UI, header contents, one `/btw`, bridge rule of S9) — specs: S8, S9 — test: n/a — riesgo: no — commit: -

## Decisiones
D1. `briefSaid` is data-only: no repo code, string, state or test references the brief (measured: grep over src/extensions/tests/bin/config; the only "brief" hits are an unrelated English word in voice docs and a test name). Deleting the key loses nothing else.
D2. The user's suspicion was right and there is one more case: `guard.explainPrompt` (i18n.ts:554) tells a model to explain in English. Fix: the prompt asks for the explanation **in Spanish** but demands the same English `Action:/Files:/Folders:` labels — the parser (`src/guard/explain.ts`) matches those labels and the guard dialog renders them, so the screen stays English and parsing keeps working. `explainLabels` do not change.
D3. `btw` panel vs reader: they show the same conversation two ways — panel = fixed window, last ~14 rows, no scroll; reader = fullscreen, scrollable. Making the panel fullscreen makes the reader redundant, so asking opens the reader fullscreen and the 3-line panel disappears (this is what "deja de ser uno de los cinco widgets" means in code). `alt+b` already opens the reader, so it literally does not change.
D4. `/context` shows the window state (percent, used/free, compact suggestion) that `/usage` lacks; `/usage` shows cost, cache and per-model spending that `/context` lacks. Recommendation: keep both — one answers "how much window is left", the other "how much did this session spend"; merged, the compact warning would drown in numbers. No change without approval.
D5. Bridge confirmation (read-only): it fires only when a `claude-bridge/*` model is picked via `/model`, or via the AskClaude tool — a separate package (`pi-claude-bridge-askclaude`) that is NOT installed. No mode/agent frontmatter names a claude-bridge model (all are `nan/*`), and the session default is `nan/deepseek-v4-flash`. Today there is no path that invokes it without an explicit pick; nothing to close. T9 writes the rule into the README and the close report pastes fresh grep evidence (S9).
D6. Task split (critic Q1): T3 deletes language-state.ts, `/language` and their callers; `src/i18n.ts` still contains both dictionaries and `getLanguage`/`setLanguage` after T3 — the suite stays green because nothing imports language-state anymore. T4/T5 then collapse i18n.ts to one dictionary and migrate the string assertions.
D7. Header sources (critic Q3): `<project>` is `basename(ctx.cwd)` — the same value the footer and the sidebar use today, just moved; `<branch>` comes from the `getGitBranch` the footer already exposes (`branchOf` in violeta-ui), no new git call. In a non-git directory the branch segment is omitted entirely, same rule as the footer's `if (branch)`.
D8. Sidebar unified title (critic Q7): the single section reads `MODEL · USAGE`.

## Log
L1. "Quiero sacarle a violeta cosas que se fueron acumulando y que no pedí, y arreglar la pantalla. Ya decidí qué quiero — no necesito que me ofrezcas alternativas, necesito que lo midas, lo escribas en un contrato y lo construyas." — cinco pedidos: 1) borrar `briefSaid`; 2) interfaz solo en inglés con instrucciones-a-modelo pidiendo español; 3) PROJECT al header, MODEL+USAGE unificados, tareas como están, `/btw` a pantalla completa; 4) dejar solo `/btw` y `alt+b`; 5) el puente de Claude no se toca, solo confirmar que no puede invocarse solo.
L2. Medido en T2: `src/guard/explain.ts` lee solo los NOMBRES de etiqueta y se queda el valor tal cual, así que el `"none"` inglés del prompt no lo parsea nadie y se quedó como estaba. Con la suite completa, `env -u VIOLETA_AGENTS_CHILD` importa: con la variable puesta (subagente) `tests/contract-state-spike.test.ts` falla en un solo test porque su `mkdtempSync(os.tmpdir())` choca con el guard; sin ella, 847/847.

## Observed checks
- T1: `jq 'has("briefSaid")' ~/.violeta/agent/violeta.json` → `false`.
- T2: 38515a1; suite `env -u VIOLETA_AGENTS_CHILD npm test` → 847 pass / 0 fail.
- T3: 624553c; suite → 843/843; `jq 'has("language")'` → `false`.
- T4: 7ddd2b4; suite → 831/831; `i18n.ts` 466 líneas; grep de setLanguage/getLanguage vacío en src/extensions/tests.
- T5: absorbido por las olas de T4 (misma suite, 831/831 audita estos archivos). Los acentos restantes en tests/ son fixtures deliberadas: guiones de `Voz:` (la salida hablada ES en español por diseño), prose de `modes/`, y datos del harness (`estado: fallada`, `por verificar`), no cadenas del diccionario.
- T6: 257b9d8; suite 838/838; header `violeta · pi <version> · <mode> · <project> · <branch>` via `src/header-lines.ts`.
- T7: 81f7018; suite 839/839; un título `MODEL · USAGE`, sin secciones separadas.
- T8: 7dc19dc; suite 826/826; grep btwn/btwv vacío; 17 tests obsoletos borrados (neto −13).
- Juez: 4 hallazgos de T8 + 1 de T2; ronda única de fixes aprobada → 0a4c9d1; suite 828/828.
- T9: f3a75de; suite 828/828; README sin /language, /btwn, /btwv, ni prosa del panel; sección del puente escrita.
- Tester (desde copias limpias): suite 828/828 en checkout limpio; header correcto con/sin rama y con/sin modo; sidebar con exactamente un `MODEL · USAGE` y cero `PROJECT`; comandos registrados = {agents, unattended, grants, todo, jobs, changes, models, mode, btw, palette}; /btw abre exactamente un overlay fullscreen; parser del guard lee etiquetas inglesas y españolas; README consistente. Hallazgos: P1 (tests/guard-authority.test.ts no desarma VIOLETA_AGENT_NAME — la familia de la trampa conocida, solo falla si se corre la suite desde dentro de una sesión de agente), P2 (un fragmento español incrustado en `resumeDeclined`), P3 (alias singular `Archivo:/Carpeta:` no aliasados — pérdida menor de detalle). Reporte completo en .violeta/scratch/probe/informe.md (se borra al cerrar).
