# authority
El harness decide quién puede escribir qué, en vez de pedírselo a la prosa.
Runner: npm test

## No-objetivos
- No se tocan los techos de turnos ni de tokens de los agentes: ya funcionan.
- No se cambia el vocabulario del contrato (`riesgo:`, `## Decisiones`, `en curso`): es otro trabajo, con su propio costo.
- No se toca el modo desatendido.
- No se agregan reglas para builder, scout ni judge en este contrato: son otra superficie (la respuesta del subagente), y entran después.
- No se elige modelo para ninguna silla.

## Specs
S1. Los roles del equipo se nombran en inglés: `critico` pasa a `critic` y `probador` a `tester`.
    Accept: no queda ninguna mención de `critico` ni `probador` en `agents/`, `modes/`, `src/`, `extensions/`, `tests/`, `README.md` ni `CONTINUAR.md`; el roster de jarvis queda `[scout, critic, builder, judge, tester]` y la suite entera queda verde.
    Check: npm test

S2. Un módulo puro decide si una escritura está permitida, a partir del contrato activo y de quién la pide.
    Accept: es una función sin terminal, sin modelo y sin disco, que recibe la herramienta, las rutas, quién llama y el texto del contrato, y devuelve permitido, o bloqueado con el id de la regla y la salida declarada; un contrato ilegible o ausente devuelve permitido en vez de romper.
    Check: node --test tests/authority-decide.test.ts

S3. Regla `jarvis.write-lock`: con un contrato activo que tenga alguna tarea sin terminar, la sesión principal no escribe archivos del proyecto.
    Accept: bloquea `edit` y `write` desde la sesión principal; deja pasar el archivo del contrato activo y cualquier ruta bajo `.violeta/scratch/`; deja pasar cuando la fila de la tarea declara `— quién: Jarvis`; no aplica cuando todas las tareas están hechas; no aplica a un subagente.
    Check: node --test tests/authority-write-lock.test.ts

S4. Regla `jarvis.tests-readonly`: la sesión principal nunca escribe en `tests/`.
    Accept: bloquea `edit` y `write` sobre cualquier ruta bajo `tests/` desde la sesión principal, haya contrato o no; no aplica a un subagente.
    Check: node --test tests/authority-tests-readonly.test.ts

S5. El guard aplica la decisión en el único `tool_call` que ya tiene, y el bloqueo dice la regla y la salida.
    Accept: una escritura bloqueada devuelve un mensaje en español que nombra el id de la regla y la salida concreta a tomar; una escritura permitida sigue el camino de permisos de hoy sin cambios; el guard sigue verde con `VIOLETA_AGENTS_CHILD` borrado.
    Check: node --test tests/guard-authority.test.ts

## Tasks
T1. Renombrar `critico` a `critic` y `probador` a `tester` en los archivos de agente, el roster de jarvis, el README, CONTINUAR y los tests que los nombran. — specs: S1 — test: n/a — riesgo: no — commit: PENDIENTE
T2. El módulo puro de decisión en `src/authority/`, con su tabla de reglas y el id de cada una viajando en la respuesta. Sin reglas todavía: el armazón y el caso "permitido". — specs: S2 — test: required — riesgo: no — commit: -
T3. La regla `jarvis.write-lock` dentro del módulo, leyendo el contrato activo y el campo de salida. — specs: S3 — test: required — riesgo: sí — commit: -
T4. La regla `jarvis.tests-readonly` dentro del módulo. — specs: S4 — test: required — riesgo: sí — commit: -
T5. Enganchar el módulo en `extensions/violeta-guard.ts` y escribir los mensajes de bloqueo en `src/i18n.ts`. — specs: S5 — test: required — riesgo: sí — commit: -

## Decisiones
D1. El campo de salida se lee por alias, `quién` y `who`, para que un futuro pase del contrato a inglés no invalide los contratos ya escritos. Una línea de código hoy evita una migración después.
D2. La regla bloquea toda escritura del proyecto, no "los archivos de una tarea ajena". Motivo medido: las filas del contrato declaran `specs:`, `test:`, `riesgo:` y `commit:`, nunca archivos; agregar un campo `archivos:` obligaría a Jarvis a adivinarlos antes de empezar y se equivocaría seguido. La regla estricta es además más barata de chequear.
D3. El id de la regla viaja en el mensaje de bloqueo para poder buscarlo en `~/dev/pi-violeta-estatuto.md`, que es donde vive el criterio.
D4. Los subagentes quedan fuera del alcance de estas dos reglas: ya tienen techos, alcance de herramientas y un verificador. Las reglas que les tocan son otra superficie.
D5. El bloqueo obliga a declarar, no prohíbe: la salida siempre existe y es una línea en el contrato (`— quién: Jarvis`), que queda escrita y es discutible después. Prohibir a secas dejaría al dueño trabado sin camino.

## Log
L1. "Vamos a hacerlo todo lo mas estructurado posible en la parte de harness. Si hay que agregar codigo, se agrega.\n\nPor otro lado esas fases que estan en español como critico y tester, habria que pasarlo a ingles"
L2. Contexto medido el 10/11/2026 y guardado en `~/dev/pi-violeta-estatuto.md`: Jarvis escribió código 51 veces contra 30 corridas de builder, 34 de ellas sobre archivos que un builder ya trabajaba, y cuatro tareas de `estado-de-tareas.md` las cerró él mismo tras un handoff por presupuesto, declarándolo en el campo `commit:`.
