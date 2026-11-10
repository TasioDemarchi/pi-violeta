# authority-agents
Lo que un agente promete en su prosa lo tiene que imponer el harness, igual que a Jarvis.
Runner: npm test

## No-objetivos
- No se tocan los techos de turnos ni de tokens de los agentes.
- No se bloquea al `builder`: su alcance depende de que la fila declare archivos, y no los declara (D2 de authority). Queda pendiente.
- No se cambian las listas de `tools:` de los agentes: `bash` les sigue haciendo falta para mirar.
- No se cambia el vocabulario del contrato ni la forma del contrato.
- No se agregan reglas sobre la respuesta del subagente (la línea `status:`): es otra superficie.

## Specs
S1. Un subagente sabe qué agente es, en tiempo de ejecución.
    Accept: el runner le pasa su nombre al hijo en el entorno, junto al `VIOLETA_AGENTS_CHILD` que ya le pasa; el test del runner lo observa en el `env` del spawn.
    Check: node --test tests/agents-runner.test.ts

S2. La decisión conoce qué agente pide, y las reglas pueden atarse a uno.
    Accept: la petición lleva el nombre del agente cuando quien llama es un subagente, y es opcional; una regla atada a una lista de agentes no aplica a los demás ni a la sesión.
    Check: node --test tests/authority-agents.test.ts

S3. Regla `agent.read-only`: `scout` y `judge` no escriben nada, tampoco por shell.
    Accept: bloquea cualquier escritura de `scout` o `judge` dentro o fuera del proyecto, por `write`, `edit` o comando; deja pasar sus lecturas y los comandos que no escriben; no aplica a `builder` ni a la sesión.
    Check: node --test tests/authority-agents.test.ts

S4. Regla `agent.scratch-only`: `tester` sólo escribe bajo `.violeta/scratch/`.
    Accept: deja pasar una escritura bajo `.violeta/scratch/`; bloquea una escritura al proyecto o al contrato, por herramienta o por comando; no aplica a los demás agentes.
    Check: node --test tests/authority-agents.test.ts

S5. Regla `critic.contract-only`: `critic` sólo lee contratos.
    Accept: deja pasar una lectura bajo `tasks/`; bloquea una lectura de `src/`, de `agents/` o de cualquier otro lugar del proyecto; no aplica a los demás agentes.
    Check: node --test tests/authority-agents.test.ts

S6. El guard aplica las tres reglas y el bloqueo dice la regla y qué hacer en su lugar.
    Accept: un bloqueo nombra el id de la regla y la salida concreta (reportarlo en vez de arreglarlo, o escribir en scratch); las reglas de la sesión siguen funcionando igual; el guard sigue verde con `VIOLETA_AGENTS_CHILD` borrado.
    Check: node --test tests/guard-authority.test.ts

## Tasks
T1. El runner le pasa el nombre del agente al hijo. — specs: S1 — test: required — riesgo: no — commit: -
T2. La petición lleva el agente, y la fábrica de reglas sabe atarse a una lista de agentes. — specs: S2 — test: required — riesgo: no — commit: -
T3. Las reglas `agent.read-only` y `agent.scratch-only`. — specs: S3, S4 — test: required — riesgo: sí — commit: -
T4. La regla `critic.contract-only`, que mira lecturas y no escrituras. — specs: S5 — test: required — riesgo: sí — commit: -
T5. Enganche en el guard y mensajes en `src/i18n.ts`. — specs: S6 — test: required — riesgo: sí — commit: -

## Decisiones
D1. El nombre viaja por el entorno, como `VIOLETA_AGENTS_CHILD`. Es el único canal que ya llega al hijo y que el guard puede leer sin pedirle nada al modelo. Un dato que el modelo pudiera escribir no serviría: sería prosa otra vez.
D2. `builder` queda afuera de este contrato. Su regla es "sólo los archivos de su tarea" y las filas del contrato no declaran archivos; imponerle algo más flojo daría una falsa sensación de alcance. Queda registrado como deuda, igual que en `authority`.
D3. No se les saca `bash`. Los cuatro lo usan para mirar —`git log`, `git diff`, correr un test y observar su salida— y quitarlo rompería su trabajo. Lo que se impone es lo que su prosa ya promete: que miren y no escriban.
D4. `critic.contract-only` se expresa como "bajo `tasks/`", no como "exactamente el archivo que le dieron". El harness no recibe esa ruta, y pasársela sería más maquinaria para una diferencia que al critic no le cambia nada: su prosa dice "do not open the repository", y `tasks/` es justo lo que no es el repositorio.
D5. Esta es una regla sobre LECTURAS, la primera. La petición pasa a llevar también las rutas que la llamada leería, calculadas por el mismo módulo puro que ya calcula las que escribiría.
D6. El bloqueo de un subagente no ofrece declarar nada: no hay contrato que firmar ni usuario a quien avisar. La salida es la que su propia prosa indica — reportarlo como hallazgo, o escribir en scratch.

## Log
L1. "Ejecuta tu recomendacion"
L2. La recomendación, de `~/dev/pi-violeta-inventario.md` §6: P1-P3, el alcance de herramientas de scout, judge, tester y critic. El inventario encontró que los cuatro prometen en prosa que no escriben (o que leen un solo archivo) y tienen con qué hacerlo: `scout` y `judge` tienen `bash`, `tester` tiene `write` y `bash`, `critic` tiene `read` sin alcance.
L3. Desmiente a D4 de `tasks/authority-bash.md`, que excluyó a los subagentes del candado porque "ya tienen techos, alcance de herramientas y un verificador". El alcance existe para `edit` y `write` —el runner pasa `--tools`— pero no para lo que `bash` escribe.
