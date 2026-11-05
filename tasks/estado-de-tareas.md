# estado-de-tareas
El harness lleva el estado de las tareas del contrato; el modelo solo decide.
Runner: npm test
Externo: no

## No-objetivos
- No se toca la rama `main` ni la copia de violeta que el dueño usa todos los días: **todo este contrato se desarrolla en una copia aparte, instalada como `violeta-test`, en su propia rama**.
- No se recorta la §4 de `modes/jarvis.md` en esta entrega. La prosa se saca recién cuando el código la sostenga y el dueño lo haya visto andar.
- No se decide por el dueño ni por el modelo: si un `Check` falla, el harness escribe el resultado y para. No reintenta, no arregla, no elige otro camino.
- No se reemplaza la herramienta `todo` donde no hay contrato activo: ahí sigue funcionando igual que hoy.
- No se toca el modo desatendido más allá de apagar en él la verificación automática.
- No se agrega ninguna dependencia nueva.

## Specs
S1. El trabajo pasa en una copia aislada de violeta, invocable como `violeta-test`, en una rama propia, y el repo de todos los días no cambia.
    Accept: `violeta-test` arranca y corre su suite entera en verde; la copia está parada en una rama que no es `main`; en el repo original `git status --short` no imprime nada.
    Check: test -x ~/.local/bin/violeta-test && git -C ~/dev/pi-violeta-test branch --show-current | grep -qv '^main$' && git -C ~/dev/pi-violeta status --short | wc -l | grep -q '^0$'

S2. Un módulo puro convierte la sección `## Tasks` de un contrato en estado legible: id, título, y si está hecha.
    Accept: por cada `T#.` devuelve una tarea; está hecha solo cuando su campo `commit:` tiene algo que no es `-`; un contrato sin `## Tasks` devuelve lista vacía en vez de romper.
    Check: node --test tests/contract-tasks.test.ts

S3. El panel Todo es una vista del contrato activo, no una lista aparte que el modelo mantiene.
    Accept: al cambiar `commit:` de una tarea en el archivo, el panel la muestra hecha sin que el modelo llame a ninguna herramienta; sin contrato activo el panel se comporta como hoy.
    Check: node --test tests/todo-from-contract.test.ts

S4. El harness registra solo: marca la tarea en curso cuando se despacha un trabajador para ella, y escribe el resultado cuando termina.
    Accept: el despacho lleva el id de la tarea como dato propio, no deducido del texto del pedido; al terminar el trabajador, el archivo queda con el resultado escrito por el harness y no por el modelo.
    Check: node --test tests/task-events.test.ts

S5. Ninguna entrega se acepta de palabra: el harness corre el `Check` de la tarea y solo la marca hecha si pasa.
    Accept: con un trabajador que dice haber terminado y un `Check` que falla, la tarea queda fallada con la salida real recortada; con el `Check` en verde, queda hecha; sin `Check` ejecutable, queda pendiente de verificación manual.
    Check: node --test tests/task-verify.test.ts

S6. La verificación automática pasa por el guard y nunca corre sola en modo desatendido.
    Accept: un `Check` que el guard considera destructivo abre su diálogo antes de ejecutarse; con el modo desatendido prendido no se ejecuta ninguno y la tarea queda pendiente con el motivo escrito.
    Check: node --test tests/task-verify-guard.test.ts

S7. Un solo escritor por campo: el estado lo escribe solo el harness, el resto del contrato solo el modelo, y ninguno pisa al otro.
    Accept: una escritura del harness conserva el texto que el modelo agregó en esa misma tarea; una edición del modelo no borra el estado ya escrito.
    Check: node --test tests/contract-write.test.ts

S8. La sesión sabe cuál es el contrato activo, y lo sigue sabiendo después de `/compact` y al retomar la sesión.
    Accept: después de compactar, el panel sigue mostrando el mismo contrato sin que el modelo lo vuelva a nombrar.
    Check: node --test tests/active-contract.test.ts

## Tasks
T1. Crear la copia en `~/dev/pi-violeta-test`, dejarla en una rama nueva para esta feature, instalarla como `violeta-test` sin tocar el `violeta` de todos los días, y correr su suite para probar que arranca sana. Todo lo que sigue pasa ahí. — specs: S1 — test: n/a — riesgo: sí — commit: 6863b38 (Check S1 PASS, 588 tests en verde; sin commit propio: es un clon)
T2. Spike: el lazo más fino de punta a punta. Un despacho de prueba para una tarea escribe un campo de estado en el archivo del contrato, y el panel lo refleja. Sin verificación, sin guard, sin persistencia: solo probar que el lazo evento→archivo→panel existe. — specs: S4 — test: recommended — riesgo: sí — commit: - — quién: Jarvis
T3. Lector puro de `## Tasks` en `src/contract/`, reusando lo que ya hace el lint. — specs: S2 — test: required — riesgo: no — commit: - — quién: Jarvis
T4. Escritor de estado con un solo escritor por campo, que preserva lo que no le toca. — specs: S7 — test: required — riesgo: sí — commit: - — quién: Jarvis
T5. El panel Todo pasa a derivarse del contrato activo, con el comportamiento de hoy intacto cuando no hay contrato. — specs: S3 — test: required — riesgo: no — commit: - — quién: Jarvis
T6. Enganchar los eventos reales de asignación y fin de trabajador, con el id de tarea viajando como dato. — specs: S4 — test: required — riesgo: sí — commit: - — quién: Jarvis
T7. Verificación automática: correr el `Check` de la tarea y marcarla según el resultado real. — specs: S5 — test: required — riesgo: sí — commit: - — quién: Jarvis
T8. Pasar esa ejecución por el guard y apagarla en modo desatendido. — specs: S6 — test: required — riesgo: sí — commit: - — quién: Jarvis
T9. Persistir cuál es el contrato activo para que sobreviva a `/compact`. — specs: S8 — test: required — riesgo: no — commit: - — quién: Jarvis

## Decisiones
D1. La copia vive en `~/dev/pi-violeta-test` y se invoca con `violeta-test`, en rama propia. Es pedido del dueño: esta feature no puede pisar la herramienta con la que trabaja todos los días.
D2. El archivo del contrato es la única fuente de verdad del estado. El panel y las tarjetas son vistas. Decidido así porque el panel se desfasó justamente por ser una segunda copia del estado que alguien tenía que acordarse de actualizar.
D3. Una tarea se da por hecha solo con su `Check` en verde, corrido por el harness. Es lo que hoy sostiene únicamente la frase "Never take a handoff on trust" de la §4.
D4. El id de la tarea viaja como dato en el despacho, no se deduce del texto. Deducirlo de prosa es la clase de acople que vuelve a romperse cuando cambia una palabra.
D5. La §4 de `modes/jarvis.md` no se recorta en esta entrega, aunque quede prosa repetida. Sacarla antes de ver el código andando dejaría la garantía sin nadie que la sostenga.
D6. T2–T9 las ejecuta Jarvis en la sesión principal, no subagentes. Motivo comprobado: los subagentes corren con el guard fijado a `/home/tachii/dev/pi-violeta` y sin UI para pedir permiso sobre `pi-violeta-test` (el builder quedó bloqueado en el primer paso y no tocó nada).

## Log
L1. "Y que te parece si en vez de dejar todo al agente, hacemos que el agente tenga menos trabajo y hacemos todo por codigo. Haciendo que el harness dispare eventos cuando ciertas cosas (tareas, asignacion de tareas, cambios) se disparan o se completan y que el propio harness modifique el estado segun el resultado ?"
L2. "Dentro del archivo pone un pedido obligatorio, que es que haga una copia de violeta y le asigne el comando `violeta-test` y que todo los cambios lo haga sobre esta copia. Esto debe tratarse como una nueva feature por lo que debe existir una rama de esto y no debe pisar la rama principal y actual."
L3. Lo que lo disparó: el panel Todo mostraba T0-T2 hechas mientras los subagentes ya habían cerrado hasta T4. El estado vive hoy en tres lugares y solo uno se escribe solo.
