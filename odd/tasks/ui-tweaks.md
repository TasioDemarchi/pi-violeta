# ui-tweaks
Three UI changes requested after hands-on testing: sidebar changes cap, todo card inside the sidebar, language switch command.
Branch: feat/core-features (continue; user decides push/merge). Project: /home/tasio/Documents/violeta.
User instruction: run ONLY the tests that validate these 3 changes (targeted `node --test <files>`), not the whole suite, to be faster.

## Specs
- S1: "La cantidad de archivos bajo el titulo `CAMBIOS` en el sidebar quiero que sea un limite de 8, 7 con nombre de archivos y el octavo son ... para entender que hay mas." -> In the sidebar CAMBIOS section the file-name rows are capped at 8 rows TOTAL (across the created/updated/deleted groups, same ordering as today). If there are 8 or fewer files, show all of them (no ellipsis). If there are more than 8, show the first 7 file rows and the 8th row is just `…` (dim) meaning "there are more". The counts line (`+N ~N −N` style counters) is unchanged and still shows the true totals.
- S2: "El cuadro de `Tareas` (/todo) que aparezca en el sidebar si esta activo, si no que aparezca donde esta ahora." -> When the sidebar is active (installed AND wide enough, i.e. the same `sidebarActive` condition that already hides the footer), the Tareas card is rendered as a section `TAREAS` inside the sidebar (placed right after CAMBIOS, before MODELO), and the above-the-editor widget is NOT drawn. When the sidebar is not active (off, narrow terminal, non-fullscreen), the card appears above the editor exactly as today. `/todo` still toggles visibility wherever it is drawn. Same hide rules as today (empty, or everything done/dropped for over 1 minute). Folding `… N más` past 8 rows, width-safe at the sidebar width. The Agents card is NOT moved (stays above the editor).
- S3: "Tener la opcion con un comando de lenguaje, cambiar entre español e ingles." -> command `/idioma` (alias `/language`) with args `es` | `en` (no arg = toggle). Persists in `${PI_CODING_AGENT_DIR}/violeta.json` (key `language`, default `es`, corrupt/invalid = `es`). Switching applies immediately to everything rendered dynamically (cards, sidebar, footer, overlays, activity line, dialogs, notices, tool-result texts) and a notification confirms in the NEW language (`Idioma: Español` / `Language: English`). Text registered once at load (command descriptions) may update on next start; report that. English dictionary = the original English strings that existed before the Spanish change (see git history: `git show 08910f9:<file>` and earlier commits) so English mode matches the previous behavior. Pi's own built-in texts remain as they are.
- S4: every change has tests; run ONLY targeted tests. README updated by the parent.

## Tasks
- T1 | S1,S2,S4 | worker | sidebar changes cap 8 + TAREAS section in sidebar | done (uncommitted)
- T2 | S3,S4 | worker | /idioma es|en with persistence and English dictionary | done (uncommitted)
- T3 | S1-S4 | parent | verify targeted tests + README | commit: pending

## Log
- L1 (user): "Bien, te doy cambios a hacer: 1. La cantidad de archivos bajo el titulo `CAMBIOS` en el sidebar quiero que sea un limite de 8, 7 con nombre de archivos y el octavo son ... para entender que hay mas. 2. El cuadro de `Tareas` (/todo) que aparezca en el sidebar si esta activo, si no que aparezca donde esta ahora. 3. Tener la opcion con un comando de lenguaje, cambiar entre español e ingles. Ejecuta solo los test que validen estos 3 cambios, no todos los que existen en el proyecto. Para que todo sea mas rapido"
