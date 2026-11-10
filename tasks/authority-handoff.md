# authority-handoff
Una entrega no se interpreta: o trae lo que el contrato de retorno pide, o no es una entrega.
Runner: npm test

## No-objetivos
- No se cambia qué marca el harness en la fila: eso lo sigue decidiendo el `Check` observado, no lo que el trabajador diga de sí mismo.
- No se borra ni se oculta la respuesta del trabajador: se le agrega el veredicto del harness, nunca se la reemplaza.
- No se valida el contenido de un hallazgo ni la calidad del código: sólo que los campos que el contrato de retorno exige estén.
- No se toca la regla del `lens:` del judge: es de bajo valor y entra en el pulido.
- No se toca el alcance del `builder` sobre archivos: sigue trabado por las filas que no los declaran.

## Specs
S1. Un módulo puro dice si una entrega cumple su contrato de retorno.
    Accept: recibe el nombre del agente, el texto de la respuesta y la fila de la tarea, y devuelve el problema encontrado o nada; no toca disco ni modelo; un texto vacío o basura devuelve un problema en vez de romper.
    Check: node --test tests/handoff.test.ts

S2. Una respuesta sin línea `status:` no es una entrega.
    Accept: detecta la ausencia de `status:` en cualquier agente; acepta `status: completed`, `partial`, `blocked` e `interaction_required`; un `status:` dentro de un bloque de código citado no cuenta como el propio.
    Check: node --test tests/handoff.test.ts

S3. Un `partial` sin `remaining:` no deja a nadie continuar.
    Accept: `status: partial` sin `remaining:`, o con `remaining:` vacío, es un problema; con contenido, pasa; sólo aplica a los agentes cuyo contrato de retorno tiene ese campo.
    Check: node --test tests/handoff.test.ts

S4. El `builder` declara lo que agregó y no saltea un test exigido.
    Accept: una respuesta de builder sin `extras:` es un problema; con `extras: none` pasa; si la fila de la tarea dice `test: required` y el `RED:` de la respuesta dice `n/a` o falta, es un problema.
    Check: node --test tests/handoff.test.ts

S5. El harness le agrega su veredicto a la entrega, sin pisarla.
    Accept: ante un problema, el resultado del despacho vuelve marcado como error y con un texto al final que nombra qué faltó y qué hacer; el texto original del trabajador sigue entero y primero; sin problema, el resultado vuelve tal cual.
    Check: node --test tests/task-handoff.test.ts

S6. Regla `agent.no-secrets`: ningún agente lee ni escribe secretos.
    Accept: bloquea `.env` y sus variantes, `*.pem`, `*.key`, `id_rsa`, `id_ed25519`, `credentials`, `auth.json`, `.npmrc`, `.netrc` y `.git-credentials`, por lectura, escritura o comando; no bloquea un archivo que sólo se les parece (`.env.example`, `keys.ts`); no aplica a la sesión, que es del dueño.
    Check: node --test tests/authority-agents.test.ts

S7. Regla `agent.no-delivery`: la entrega es del dueño.
    Accept: bloquea `git add`, `commit`, `push`, `tag`, `npm publish` y `gh pr create` desde un subagente; deja pasar `git status`, `git diff`, `git log` y `git show`; no aplica a la sesión.
    Check: node --test tests/authority-agents.test.ts

## Tasks
T1. El módulo puro `src/authority/handoff.ts` con la inspección de la entrega. — specs: S1, S2, S3, S4 — test: required — riesgo: no — commit: 0a799af (S1-S4: handoff 16/16)
T2. El harness agrega su veredicto al resultado del despacho, sin pisarlo. — specs: S5 — test: required — riesgo: sí — commit: 0a799af (S5: task-handoff 7/7)
T3. La regla `agent.no-secrets`. — specs: S6 — test: required — riesgo: sí — commit: 0a799af (S6: authority-agents; corregido después: un comando se juzga por lo que nombra)
T4. La regla `agent.no-delivery`. — specs: S7 — test: required — riesgo: sí — commit: 0a799af (S7: authority-agents 29/29)
T5. Probar las cuatro contra una instancia real, con las herramientas del agente. — specs: S5, S6, S7 — test: required — riesgo: sí — quién: Jarvis — commit: 0a799af (S5-S7: e2e, siete fases en verde; encontró el agujero de `cat .env`)

## Decisiones
D1. El veredicto se **agrega** a la respuesta, nunca la reemplaza. El orquestador necesita leer lo que el trabajador dijo para poder continuar; borrárselo convertiría un problema de forma en una pérdida de trabajo.
D2. El estado de la fila lo sigue decidiendo el `Check` observado por el harness, no la autoevaluación del trabajador. Una entrega mal formada vuelve marcada como error, pero si el `Check` pasó, la tarea quedó hecha: el hecho observado gana sobre lo que alguien diga de sí mismo.
D3. Un `status:` dentro de un bloque de código citado no cuenta. Un builder que pega el contrato de retorno como ejemplo no está entregando nada.
D4. `agent.no-secrets` y `agent.no-delivery` atan a cualquier subagente, no a una lista de nombres: la prosa del builder las enuncia, pero valen para todos y un agente nuevo debería nacer con ellas puestas.
D5. No aplican a la sesión. El dueño lee sus propios secretos y commitea cuando quiere; la regla existe para lo que corre sin que él mire.
D6. `P20` ("nunca edites código que no leíste") queda afuera de este contrato. Necesita que el harness recuerde qué se leyó en la sesión, que es estado y no una función pura, y el resto de este contrato no lo necesita. Entra en el pulido.

## Log
L1. "Vamos a hacer lo necesario primero y hago una prueba haciendo un proyecto real, y luego validamos y vemos de hacer el pulido"
L2. De `~/dev/pi-violeta-inventario.md` §3: P5 a P9 son la superficie de la respuesta del subagente, y P18 y P19 son las dos listas de denegación que siguen siendo prosa. jarvis.md §4 ya dice "a worker whose answer has no `status:` line did not finish", y hasta hoy eso lo tenía que mirar el orquestador.
