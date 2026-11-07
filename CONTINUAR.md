# CONTINUAR — traspaso a una sesión nueva de IA

Este archivo existe para que otra IA (o vos mismo dentro de tres meses) retome el
proyecto **sin hacer preguntas**. Leelo entero antes de tocar nada. Al final está el
texto exacto que hay que pegarle a la IA nueva.

---

## 1. Qué es esto y para quién

**violeta** es un arnés de IA propio, construido sobre Pi, que corre como comando
independiente con su propio directorio de agente (`~/.violeta/agent`). No es un fork de
gentle-shell y no comparte nada con él.

Un solo dueño, sin usuarios, sin backend, sin releases. La API key de NaN se guarda en
`~/.violeta/agent/auth.json` y **nunca se commitea**.

Contexto del dueño: **poca base técnica sobre el código**; juzga resultados, tiempo,
costo y riesgo. Pide explicaciones en lenguaje natural, prefiere una recomendación antes
que un menú de opciones, y detesta la ceremonia: si un pedido de una línea tarda más en
planearse que en hacerse, el proceso está mal.

## 2. Estado real (al 5 de noviembre de 2026)

- Rama de trabajo: **`feat/jarvis`**, mergeada a `main` para el traspaso.
- **609 tests, todos en verde** (`npm test`).
- 113 archivos TypeScript, ~9.700 líneas, 39 commits.
- Node 24 requerido (corre TypeScript sin compilar). `jq` es obligatorio.

## 3. Cómo está armado

**La regla arquitectónica, la única que importa:** el motor es neutro y la filosofía
entra como **dato**. Un modo es un markdown en `modes/`: su frontmatter elige modelo,
nivel de razonamiento y qué agentes existen; su cuerpo se agrega al system prompt. Nada
de una filosofía va a TypeScript. Lo que deba cumplirse siempre lo impone el arnés
(techos, guard, interruptor de despachos), no la prosa.

| Dónde | Qué |
|---|---|
| `bin/violeta` | Lanzador: aísla `PI_CODING_AGENT_DIR`, siembra ajustes, sincroniza `config/models.json` y `agents/`+`modes/` en cada arranque |
| `extensions/` | 14 extensiones: UI, agentes, guard, contrato, modos, jobs, todo, notify, paleta, cambios, modelos, voz, chat al margen, herramientas |
| `src/` | Toda la lógica pura y testeable, sin terminal ni modelo |
| `agents/` | 5 definiciones (el equipo de `jarvis`): modelo, razonamiento, techo de turnos y tokens, lista de herramientas |
| `modes/` | `jarvis`, el modo por defecto y el único que queda; `raw` está integrado y siempre existe |
| `tasks/` | Contratos y planes. **Ahora sí versionado** (estaba en `.gitignore` y se habría perdido) |
| `config/models.json` | Catálogo NaN: contextos, salidas máximas, resolución de la key con `jq` |

## 4. Qué está terminado y probado

- Lanzador, directorio aislado, sincronización de agentes, modos y catálogo.
- Interfaz: encabezado, pie, barra lateral, línea de actividad, tema, paleta, visor de
  diffs, renderizadores compactos de herramientas, notificaciones, selector de modelos,
  tareas, jobs en background, voz.
- Agentes: herramientas, tarjeta, runner con techos duros y presupuestos de silencio,
  historial y telemetría por tarea.
- Guard: comandos destructivos, permisos fuera del proyecto, y el default de denegar en
  lugar de preguntar cuando no hay nadie.
- Modos: `/mode` cambia prompt, modelo y roster de agentes.
- Modo `jarvis`: `contract_check` (lint de contrato sin gastar tokens), interruptor de
  despachos, y tres agentes nuevos (`critico`, `judge`, `probador`).

## 5. Qué está a medias

**El modo desatendido está construido y en verde; no como lo pedía el plan viejo.**
El comando `/unattended` vive en `extensions/violeta-guard.ts` (junto al
`session_start` que lee `VIOLETA_UNATTENDED`), el estado va en el hub compartido,
el guard niega en lugar de preguntar, permite leer fuera del proyecto con
`read`/`grep`/`find`/`ls` y lo prueba `tests/guard-unattended.test.ts`. Lo único
pendiente: propagar el flag al proceso hijo para que un subagente también niegue
(el plan viejo lo llamaba S10/S11). **`tasks/unattended-mode.md` es historia, no
plan ejecutable**: escrito antes de la limpieza del 3/11, nombra agentes
(`architect`, `fixer`, `planner`, `verifier`, `judge-a/b`) y el modo `odd` que ya
no existen. Sus decisiones siguen valiendo; sus nombres de archivo, no.

**Regla para planes y contratos viejos de `tasks/`:** no se ejecutan ni se
"convierten al formato nuevo" sin relevar antes. Primero mirá el código: si la
feature ya existe y la suite está en verde, el plan se archiva y solo lo que falte
de verdad entra en un contrato nuevo. Recontratar lo ya construido es volver a
cometer el error de rehacer trabajo commiteado.

**La filosofía está en discusión.** `odd`, `scout` y `vault` se borraron: estaban a
medio hacer y el modo decide cómo se ejecuta cada tarea, así que uno incompleto es un
riesgo, no una opción. Queda `jarvis`. Si el dueño trae principios propios, el motor no
se toca: eso se escribe como un archivo más en `modes/`.

## 6. Trampas que ya costaron horas — no las reintroduzcas

- **`VIOLETA_AGENTS_CHILD=1`** lo exporta todo subagente. Los tests del guard heredan esa
  variable y siete fallan por una razón que no tiene que ver con el código.
  `tests/guard-dialog.test.ts` la borra explícitamente. No la saques.
- **`jq` es obligatorio**: `config/models.json` resuelve la key con `jq` en cada request.
- **La key suele vivir en `~/.gentle-shell/agent/auth.json`**, no en violeta. El
  instalador la importa o la pide.
- **`bashPathTargets` confunde patrones con rutas**: `sed -n '/foo/,+2p'` se lee como
  `/foo`. Usá `grep -A` en scripts.
- **Los techos miden turnos, no tiempo.** Un hijo que los alcanza devuelve su última
  frase como entrega: por eso todos los agentes tienen la regla de reportar avances en
  vez de anunciar el paso siguiente.
- **Los límites de salida del catálogo están cortos**: DeepSeek soporta 393.216 tokens
  de salida y el catálogo le permite 65.536; GLM y MiMo soportan 131.072. Eso explica
  respuestas cortadas a mitad de frase. Corregirlo es un cambio de una línea por modelo.

## 7. Decisiones ya tomadas — no las re-litigues

- **Ningún agente usa Claude.** Claude se usa solo manual, cambiando el modelo de sesión.
- **Techos por turnos (control) y por tokens (fusible)**, no por tiempo.
- **Jueces ciegos en modelos distintos**, para que el acuerdo signifique algo.
- **Respuestas en español; archivos del repo en inglés.**
- **Simplicidad ante todo**: pocos agentes, pocos modos, cero acoplamiento con
  gentle-shell.
- **El dueño decide qué y cuánto; la IA decide el cómo** y lo deja escrito.

## 8. Datos de modelos, medidos el 1/11/2026

Sondeo real contra la API de NaN (una llamada por modelo, misma consigna):

| Modelo | Cuota | Velocidad | Salida real | Contexto |
|---|---|---|---|---|
| DeepSeek V4.1-Flash | 3,0 B | **109 tok/s** | 393 k | 1 M |
| GLM-5.3-Flash | 2,0 B | 34 tok/s | 131 k | 1 M |
| MiMo V2.6-Flash | 1,0 B | s/d | 131 k | 1 M |
| Qwen 3.8 Flash | 500 M | 60 tok/s | 131 k | 1 M |
| Qwen 3.6 (35B/3B) | sin límite | s/d | 65 k | 262 k |
| Gemma 4 31B | sin límite | s/d | **16 k** | 262 k |

Benchmarks públicos que más pesan (fichas técnicas en HuggingFace):

| | DeepSeek | Qwen 3.8 | MiMo | GLM-5.3 |
|---|---|---|---|---|
| DeepSWE (código agéntico) | **77,0** | 58,7 | 67,9 | 66,9* |
| Terminal-Bench 4.0 | **42,3** | — | 28,8 | 37,9* |
| CoWorkBench (trabajo largo) | 45,1 | **73,9** | — | — |
| GPQA (razonamiento) | — | **91,7** | — | — |
| IFBench (obediencia) | — | **81,3** | — | — |
| CyberGym (seguridad) | — | — | **95,1** | SOTA* |

\* GLM-5.3 completo; la versión Flash no publica números en texto.

**Reparto recomendado:** Qwen 3.8 Flash como líder conversacional (obedece mejor y no se
pierde en trabajos largos), DeepSeek para construir (mide por encima de Opus 5 en
DeepSWE), MiMo para auditar seguridad, GLM para volumen barato, Qwen 3.6 y Gemma 4 para
lo que no deba gastar cuota.

**El detalle importa:** DeepSeek es el mejor del grupo escribiendo código, y también el
que más se pierde en tareas largas (45,1 contra 73,9 en CoWorkBench). No lo pongas de
líder.

## 9. Lo que falta ahora

1. Propagar `VIOLETA_UNATTENDED` al proceso hijo (lo único que queda del modo desatendido; ver §5).
2. Corregir los límites de salida del catálogo (una línea por modelo).
3. Definir la filosofía nueva junto al dueño y escribirla como `modes/<nombre>.md`.
4. Proyecto hermano: `github.com/TasioDemarchi/violet-android` (app Android), con su
   propio `CONTINUAR.md`.

---

## 10. Prompt para pegarle a la IA nueva

Copiá y pegá esto tal cual, en una sesión nueva, con el repo clonado y abierto:

```
Estás retomando un proyecto mío que ya está empezado y anda. Leé, en este orden y
completo, antes de escribir nada:

1. CONTINUAR.md
2. AGENTS.md
3. README.md
4. tasks/unattended-mode.md   (el plan de lo único que está a medias)

Reglas para vos:
- Hablás conmigo en español y me explicás en lenguaje natural, sin dar nada por
  sobreentendido. Si usás un término técnico, lo explicás en una línea.
- Preferí siempre la opción más simple que resuelva el problema. Si un pedido de una
  línea te lleva más de diez minutos de planificación, está mal: hacé la versión
  mínima y mostrame el resultado.
- Nunca agregues una funcionalidad que no te pedí. Si te parece que falta algo, me lo
  proponés con su costo y esperás mi sí.
- Antes de un cambio grande: dos o tres líneas de qué vas a hacer y por qué. Yo apruebo.
  Los cambios chicos y reversibles los hacés directo.
- Después de cambiar algo: corrés lo que haya que correr y me mostrás la salida real.
  Nunca me digas que algo pasó si no lo viste.
- No me preguntes por lo que ya está decidido en CONTINUAR.md. Si algo no está,
  preguntame una cosa por vez, en lenguaje de resultado, no de código.
- Los planes y contratos viejos de `tasks/` pueden nombrar archivos que ya no
  existen. Antes de ejecutarlos o convertirlos, verificá contra el código: si la
  feature ya anda y los tests están en verde, informá y archivá el plan; no lo
  reconstruyas.

Arrancá contándome en cinco líneas dónde está parado el proyecto y qué ves como
próximo paso, y esperá mi confirmación antes de tocar archivos.
```
