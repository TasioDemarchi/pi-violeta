# authority-bash
El candado también cubre la shell: una escritura por `bash` no es distinta de una por `write`.
Runner: npm test

## No-objetivos
- No se bloquea `rm`: borrar ya pasa por el diálogo destructivo del guard, que pregunta antes.
- No se bloquea `git`, `npm`, `node` ni ningún corredor de tests: ésa es la verificación que Jarvis tiene que seguir haciendo.
- No se toca `recognizeDestructiveCommands` ni el diálogo destructivo: conviven, no se reemplazan.
- No se agregan reglas para builder, scout, judge ni tester.
- No se cambia el vocabulario del contrato.

## Specs
S1. El tokenizador de comandos del guard es uno solo, reutilizable, en vez de dos parsers que pueden discrepar.
    Accept: `tokenize` y `segments` quedan exportados desde `src/guard/command-guard.ts` y la regla nueva los usa; los tests de comandos de hoy siguen verdes sin cambios.
    Check: node --test tests/guard-command.test.ts

S2. Un módulo puro dice qué rutas del proyecto escribe un comando de shell, y no confunde una lectura con una escritura.
    Accept: detecta redirección (`>`, `>>`, `tee`), editores en el lugar (`sed -i`, `perl -i`, `awk -i inplace`) y comandos que producen archivos (`cp`, `mv`, `install`, `touch`, `truncate`, `dd`, `patch`, `ln`); no detecta nada en `npm test 2>&1 | tail`, `git status`, `node --test`, `grep`, `cat`; un `>` dentro de comillas es texto, no una redirección; el cuerpo de un heredoc es dato.
    Check: node --test tests/bash-writes.test.ts

S3. Regla `jarvis.bash-write`: con un contrato activo y tareas pendientes, la sesión principal no escribe el proyecto por shell.
    Accept: bloquea un comando que escribe dentro del proyecto; deja pasar el contrato activo y `.violeta/scratch/`; deja pasar con `— quién: Jarvis`; deja pasar fuera del proyecto; no aplica a un subagente; `tests/` queda bloqueado también por shell, con su propia regla.
    Check: node --test tests/authority-bash.test.ts

S4. El bloqueo llega por el mismo camino que los otros dos y dice la regla y la salida.
    Accept: el guard devuelve el bloqueo antes del diálogo destructivo, con el id de la regla y la salida; un comando permitido sigue el camino de hoy; el guard sigue verde con `VIOLETA_AGENTS_CHILD` borrado.
    Check: node --test tests/guard-authority.test.ts

S5. Probado contra una instancia real de violeta, no sólo contra la suite.
    Accept: en un proyecto de prueba con un contrato con tareas pendientes, `violeta-test -p` recibe un pedido de modificar un archivo del proyecto y el archivo queda intacto; el mismo pedido con todas las tareas cerradas lo modifica.
    Check: manual: `bash tests/e2e/authority.sh` y leer su salida

## Tasks
T1. Exportar `tokenize` y `segments` desde el guard, sin cambiar su comportamiento. — specs: S1 — test: required — riesgo: no — commit: 3c3742f (S1: guard-command 13/13 sin cambios; tokenize/segments/headCursor exportados)
T2. El detector puro de escrituras de shell en `src/authority/bash-writes.ts`. — specs: S2 — test: required — riesgo: sí — commit: 3c3742f (S2: bash-writes 17/17)
T3. La regla `jarvis.bash-write` y su entrada en la tabla. — specs: S3 — test: required — riesgo: sí — commit: 3c3742f (S3: authority-bash 13/13; regla por fábrica, compartida con write-lock)
T4. Enganchar la autoridad para las herramientas de shell en el guard, antes del diálogo destructivo. — specs: S4 — test: required — riesgo: sí — commit: 3c3742f (S4: guard-authority 14/14; suite 782 en verde)
T5. La prueba por prompt contra una instancia real, guionada y repetible. — specs: S5 — test: required — riesgo: sí — quién: Jarvis — commit: 2c37787 (S5: las tres fases en verde contra violeta-test real; encontró 3 errores en la propia prueba y ninguno en el candado)

## Decisiones
D1. Se exportan `tokenize` y `segments` en vez de escribir un segundo parser. Dos definiciones de "qué es un segmento de shell" terminarían discrepando, y el guard ya resuelve comillas, heredocs, envoltorios y subshells.
D2. La detección es por lista blanca de formas que escriben, no por lista negra de formas que no. Un comando desconocido no se bloquea: el costo de un falso negativo es que una escritura se escapa, el de un falso positivo es que el dueño no puede trabajar.
D3. `rm` queda afuera a propósito: ya abre el diálogo destructivo, que pregunta antes de borrar. Dos guardias sobre lo mismo darían dos mensajes distintos para un solo hecho.
D4. Un token sólo cuenta como redirección si su forma **sin comillas** lo es, y el destino no puede empezar con `&`, para que `2>&1` no sea una escritura.
D5. T5 lleva `— quién: Jarvis`: la prueba levanta un proceso real de violeta contra un proyecto temporal y lee su salida. Ningún subagente puede hacerlo, y es el caso que §3 de la filosofía describe.

## Log
L1. "Bien continua con tu recomendacion en orden. Procura luego de hacer cambios hacer los test, no solo test de desarrollo, si no levantar una instancia de violeta y ejecutar una prueba por promot.\n\nSeguramente los modelos se repitan asi que esa parte de la filosofia la dejamos pasar por ahira."
L2. El agujero quedó registrado en `~/dev/pi-violeta-estatuto.md` §8 al cerrar `tasks/authority.md`: el candado cubría `edit` y `write`, y un `sed -i` o un `>` pasaban igual. Jarvis usó `bash` en el 68,9% de sus turnos medidos, así que es la herramienta que más tiene a mano.
