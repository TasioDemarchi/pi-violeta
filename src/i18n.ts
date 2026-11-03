/**
 * i18n — every user-facing string violeta itself shows, centralized (S10),
 * in two complete dictionaries: Spanish (default) and English (S3).
 *
 * Each dictionary is grouped by area, with plain functions for plurals and
 * interpolation. `setLanguage(lang)` switches the ACTIVE dictionary; the
 * exported namespaces (`guard`, `agents`, `todo`, `jobs`, `sidebar`, `ui`,
 * `activity`, `guardReasons`) are proxies that resolve every property from
 * the active dictionary at ACCESS time, so switching applies immediately to
 * everything rendered dynamically — cards, sidebar, footer, overlays, the
 * activity line, dialogs, notices and tool-result texts. Text registered
 * once at load (command descriptions) keeps the language it was registered
 * with until the next start.
 *
 * The English dictionary reproduces the ORIGINAL English strings that existed
 * before the Spanish change (commit 08910f9); strings added after it (the
 * sidebar TASKS section, the `…` fold ellipsis, the /language command texts)
 * are natural English.
 *
 * Deliberately NOT here (they stay English):
 * - tool names, parameter names, tool/parameter descriptions and TypeBox
 *   schema text (they are for the model),
 * - code identifiers, comments and README,
 * - status/enum VALUES used as identifiers (`blocked`, `in_progress`,
 *   `job`, `monitor`, thinking levels) and user-provided content,
 * - Pi core's own strings (`Operation aborted`, dialog key hints, `Working`).
 */

export type Language = "es" | "en";

/**
 * The active language lives on `globalThis` under `Symbol.for`: pi loads each
 * extension entry with jiti `moduleCache: false`, so violeta-ui, violeta-todo,
 * violeta-agents, violeta-jobs and violeta-guard each get their OWN copy of
 * this module (same lesson as src/shared-hub.ts). A plain module variable
 * would switch one copy only; the symbol-keyed global is shared by all of them.
 */
const LANGUAGE_KEY = Symbol.for("violeta.language");

function slot(): { [LANGUAGE_KEY]?: Language } {
	return globalThis as { [LANGUAGE_KEY]?: Language };
}

/** The language every dynamic string resolves from right now. */
export function getLanguage(): Language {
	return slot()[LANGUAGE_KEY] ?? "es";
}

/** Switch the active dictionary; applies immediately to every dynamic read. */
export function setLanguage(language: Language): void {
	slot()[LANGUAGE_KEY] = language;
}

// --- Spanish (default) ----------------------------------------------------------

const es = {
	guardReasons: {
		recursiveRemoval: "borrado recursivo de archivos",
		forcedRemoval: "borrado forzado de archivos",
		findDelete: "find -delete",
		shred: "shred",
		ddDevice: "dd escribe en un dispositivo",
		mkfs: "mkfs",
		recursiveBroadPath: (name: string) => `${name} recursivo en una ruta amplia`,
		gitForcePush: "force push de git",
		gitResetHard: "git reset --hard",
		gitCleanForce: "git clean -f",
		gitBranchDelete: "git branch -D",
		gitStashDropClear: "git stash drop/clear",
		gitCheckoutWholeTree: "git checkout de todo el árbol",
		gitRestoreWholeTree: "git restore de todo el árbol",
		sqlDropTruncate: "sentencia SQL DROP/TRUNCATE",
		sqlDeleteWithoutWhere: "DELETE sin WHERE",
	},
	guard: {
		/** The only option that approves the destructive command. */
		yes: "Sí",
		no: "No",
		destructiveTitle: "Comando destructivo",
		destructiveBody: (command: string, reasons: readonly string[]) =>
			`${command}\n\nMotivo: ${reasons.join("; ")}. ¿Ejecutarlo igual?`,
		declined: (command: string) =>
			`El usuario rechazó este comando destructivo: ${command}. Buscá una alternativa más segura.`,
		blocked: (reasons: readonly string[]) =>
			`Bloqueado: ${reasons.join("; ")}. No hay un usuario interactivo que pueda aprobarlo.`,
		catastrophic: (reason: string) => `Objetivo catastrófico denegado sin preguntar: ${reason}.`,
		outsideTitle: "Acceso fuera del proyecto",
		outsideBody: (dir: string) =>
			`¿Permitir acceso fuera del proyecto: ${dir}? El permiso dura solo esta sesión.`,
		outsideNeedsGrant: (dir: string, cwd: string) =>
			`El acceso fuera del proyecto (${dir}) necesita un permiso y no hay UI para pedirlo. Concedelo en una sesión interactiva, o mantené el trabajo dentro de ${cwd}.`,
		outsideDeclined: (dir: string, cwd: string) =>
			`El acceso a ${dir} no fue aprobado. Quedate dentro de ${cwd} o pedile al usuario que lo conceda.`,
		grantsDescription: "Lista los permisos fuera del proyecto, o revócalos con /grants revoke",
		grantsRevoked: (n: number) => (n === 1 ? "Revocado 1 permiso fuera del proyecto." : `Revocados ${n} permisos fuera del proyecto.`),
		grantsNothingToRevoke: "No hay permisos fuera del proyecto para revocar.",
		grantsList: (dirs: readonly string[]) =>
			`Permisos fuera del proyecto en esta sesión:\n${dirs.map((dir) => `- ${dir}`).join("\n")}\n\n/grants revoke los borra.`,
		grantsEmpty: "No hay permisos fuera del proyecto en esta sesión.",
		unattendedDescription: "Modo sin supervisión: rechaza lo destructivo sin preguntar y permite leer fuera del proyecto (/unattended on|off)",
		unattendedUsage: "uso: /unattended [on|off]",
		unattendedOn:
			"Modo sin supervisión ACTIVADO: lo destructivo se rechaza sin preguntar, leer fuera del proyecto se aprueba siempre, escribir fuera del proyecto se rechaza.",
		unattendedOff: "Modo sin supervisión desactivado: vuelvo a preguntar.",
		unattendedBlocked: (reasons: readonly string[]) =>
			`Rechazado (modo sin supervisión): ${reasons.join("; ")}. No se ejecutó. Omití este paso, usá una alternativa más segura y seguí con el resto del trabajo.`,
		unattendedOutsideWrite: (dir: string, cwd: string) =>
			`Rechazado (modo sin supervisión): fuera del proyecto (${dir}) solo se puede leer, y para eso usá read, grep, find o ls. Para escribir o ejecutar quedate dentro de ${cwd}; seguí con el resto del trabajo.`,
	},
	agents: {
		/** Display words for task statuses (the values themselves stay identifiers). */
		statuses: { queued: "en cola", running: "en curso", completed: "completado", failed: "fallido", aborted: "abortado", budget: "detenido en su techo" } as Record<string, string>,
		/** Display words for thread tool-call states. */
		toolStatuses: { running: "en curso", done: "listo", error: "error" } as Record<string, string>,
		queued: "en cola",
		cardTitle: (active: number, done: number, failed: number) => {
			const plural = (n: number, singular: string, pluralForm: string) => `${n} ${n === 1 ? singular : pluralForm}`;
			const parts = [plural(active, "activo", "activos"), plural(done, "terminado", "terminados")];
			if (failed > 0) parts.push(plural(failed, "fallido", "fallidos"));
			return `Agentes · ${parts.join(" · ")}`;
		},
		fold: (n: number, viewKey: string) => `… ${n} más · ${viewKey} para ver`,
		listHeader: (active: number, finished: number) => {
			const plural = (n: number, singular: string, pluralForm: string) => `${n} ${n === 1 ? singular : pluralForm}`;
			return `${plural(active, "activo", "activos")} · ${plural(finished, "terminado", "terminados")}`;
		},
		sectionResult: "── Resultado ──",
		sectionThread: "── Hilo ──",
		inProgress: "en curso…",
		hint: (mode: "split" | "narrow") =>
			mode === "split"
				? "j/k tarea  ctrl+j/k desplazar  f seguir  esc volver  q cerrar"
				: "j/k seleccionar  enter hilo  esc volver  q cerrar",
		overlayNeedsTui: "La vista de agentes requiere modo interactivo.",
		agentsDescription: "Muestra la vista de subagentes (tareas activas y sus hilos)",
		shortcutOverlay: "Muestra la vista de subagentes",
		shortcutStop: "Detiene los subagentes activos (pide confirmación)",
		stopTitle: "Detener subagentes",
		stopBody: (n: number) => `¿Cancelar ${n} ${n === 1 ? "tarea" : "tareas"} de subagentes activas? Los procesos hijos se detienen.`,
		stopNone: "No hay tareas de subagentes activas.",
		stopCancelled: (n: number) => (n === 1 ? "Cancelada 1 tarea de subagente." : `Canceladas ${n} tareas de subagentes.`),
		finishedMessage: (title: string, name: string, id: string, status: string) =>
			`Subagente terminó: ${title} (${name}, ${id})\nEstado: ${status}`,
		noOutput: "(sin salida)",
		noAnswer: "(sin respuesta)",
		backgroundStarted: (name: string, id: string) =>
			`Subagente "${name}" iniciado en segundo plano con id de tarea ${id}. Su resultado se entregará cuando termine; mirá el progreso con subagent_status.`,
		cancelledByCaller: (name: string, id: string) => `Subagente "${name}" (${id}) fue cancelado porque quien lo llamó abortó.`,
		/** Heads the partial handoff of a ceiling stop: it says what happened and
		 * what continues it, because a stop that names no continuation is a dead end. */
		budgetStopped: (limit: string, turns: number, tokens: number) =>
			`El subagente se detuvo en su techo de ${limit === "maxTurns" ? "turnos" : "tokens"} (${turns} turnos · ${tokens} tokens). No es un fallo: abajo va su entrega parcial. Para continuar, relanzá un subagente nuevo con lo que falte.`,
		unknownAgent: (name: string, available: string) => `Agente desconocido "${name}". Disponibles: ${available}. Usá subagent_list_agents primero.`,
		noneAvailable: "(ninguno)",
		breakerSummary: (dispatches: number, minutes: number, tokens: number, by: string, rows: string) =>
			`${dispatches} subagentes en ${minutes} min · ${tokens} tokens · ${by || "-"}${rows ? `\n${rows}` : ""}`,
		breakerRow: (agent: string, label: string, status: string, turns: number) => `  ${agent} «${label}» · ${status} · ${turns} t`,
		breakerReport: (summary: string) => `▸ Sin que hables desde hace un rato, sigo trabajando: ${summary}`,
		breakerTitle: "¿Seguir lanzando subagentes?",
		breakerConfirmLoop: (agent: string, label: string, count: number, summary: string) =>
			`Es la vez ${count} que se lanza «${agent}» con «${label}». Puede ser un ciclo.\n\n${summary}\n\n¿Seguir?`,
		breakerConfirmCeiling: (dispatches: number, minutes: number, summary: string) =>
			`Van ${dispatches} subagentes y ${minutes} min sin que hables.\n\n${summary}\n\n¿Seguir?`,
		breakerDeclined: "El usuario no autorizó lanzar más subagentes. No lances otro: contale qué está hecho, qué falta y esperá su respuesta.",
		noDefinitions: "No se encontraron definiciones de subagentes. Creá archivos markdown con frontmatter YAML (name, description, model, thinking, tools, maxTurns, maxTokens) y un cuerpo de system prompt en el directorio de agents.",
		noTasksYet: "Todavía no hay tareas de subagentes.",
		unknownTaskId: (id: string) => `Id de tarea desconocido ${id}.`,
		noResultYet: "— todavía sin resultado.",
		taskStatusWord: (status: string) => `tarea ${agents.statuses[status] ?? status}`,
		cancelled: (id: string) => `Tarea ${id} cancelada.`,
		notCancellable: (id: string) => `La tarea ${id} no se puede cancelar (id desconocido o ya terminada).`,
	},
	changes: {
		/** `N` rows for the group headers of the /changes list (glyph added by the view). */
		created: (n: number) => `${n} ${n === 1 ? "creado" : "creados"}`,
		updated: (n: number) => `${n} ${n === 1 ? "modificado" : "modificados"}`,
		deleted: (n: number) => `${n} ${n === 1 ? "eliminado" : "eliminados"}`,
		empty: "Sin cambios.",
		loading: "cargando…",
		binary: "binario",
		moreLines: (n: number) => `… ${n} ${n === 1 ? "línea más" : "líneas más"}`,
		hint: (mode: "split" | "narrow") =>
			mode === "split"
				? "j/k archivo  ctrl+j/k desplazar  g/G inicio/fin  o abrir  esc cerrar"
				: "j/k archivo  enter diff  esc volver  q cerrar",
		overlayNeedsTui: "La vista de cambios requiere modo interactivo.",
		description: "Muestra el visor de cambios (archivos y su diff)",
		shortcut: "Muestra el visor de cambios",
	},
	todo: {
		cardTitle: (open: number, done: number) => {
			const plural = (n: number, singular: string, pluralForm: string) => `${n} ${n === 1 ? singular : pluralForm}`;
			return `Tareas · ${plural(open, "abierta", "abiertas")} · ${plural(done, "hecha", "hechas")}`;
		},
		fold: (n: number) => `… ${n} más`,
		ellipsis: "…",
		empty: "Sin tareas.",
		blockedNeedsNote: "una tarea bloqueada necesita una nota que diga qué espera",
		titleRequired: "falta el título",
		statusList: "pending, in_progress, blocked, done o dropped",
		unknownStatus: (value: string) => `estado desconocido "${value}" (usá ${todo.statusList})`,
		nothingToUpdate: "nada que actualizar: pasá status, title o note",
		noTask: (id: number | undefined) => `no existe la tarea #${id}`,
		actionList: "write, add, update, clear o list",
		unknownAction: (action: string) => `acción desconocida "${action}" (usá ${todo.actionList})`,
		description: "Muestra u oculta la tarjeta de tareas sobre el editor",
		shown: "Tarjeta de tareas visible.",
		hidden: "Tarjeta de tareas oculta.",
	},
	jobs: {
		/** Display words for job statuses (the values themselves stay identifiers). */
		jobRunning: "en ejecución",
		jobStopped: "detenido",
		jobFinished: "terminado",
		jobFailed: (error: string | undefined) => `falló: ${error ?? "error desconocido"}`,
		jobSignal: (signal: string | null | undefined) => `terminado por la señal ${signal ?? "desconocida"}`,
		jobExited: (code: number) => `salió con código ${code}`,
		couldNotRun: (error: string | undefined) => `no pudo ejecutarse: ${error ?? "error desconocido"}`,
		indicator: (n: number) => `jobs: ${n} en ejecución`,
		overlayHeader: (running: number, finished: number) => {
			const plural = (n: number, singular: string, pluralForm: string) => `${n} ${n === 1 ? singular : pluralForm}`;
			const parts = [`${running} en ejecución`];
			if (finished > 0) parts.push(plural(finished, "terminado", "terminados"));
			return `Jobs · ${parts.join(" · ")}`;
		},
		listEmpty: "Sin trabajos.",
		listEmptyHint: "Sin trabajos. Iniciá uno con bash_background o monitor.",
		confirmStop: (id: string, label: string) => `s otra vez para detener ${id} (${label})`,
		hint: "j/k seleccionar  s detener  q cerrar",
		overlayNeedsTui: "La vista de trabajos requiere modo interactivo.",
		description: "Muestra la vista de trabajos en segundo plano (en ejecución y terminados)",
		jobStart: (id: string, label: string, outputPath: string) => `Trabajo ${id} (${label}) iniciado. Salida: ${outputPath}`,
		monitorStart: (id: string, label: string, seconds: number, outputPath: string) =>
			`Monitor ${id} (${label}) iniciado por hasta ${seconds}s. Salida: ${outputPath}`,
		willNotify: "Se te avisará una vez cuando termine; seguí trabajando o terminá tu turno.",
		monitorWillNotify: "Cada línea nueva de salida te llega como un evento; seguí trabajando o terminá tu turno.",
		jobExitHeader: (id: string, label: string, outcome: string, duration: string) =>
			`El trabajo ${id} (${label}) ${outcome} después de ${duration}.`,
		jobExitCommand: (command: string) => `Comando: ${command}`,
		jobExitLastOutput: "Última salida:",
		jobExitNoOutput: "Sin salida.",
		jobExitFullOutput: (path: string) => `Salida completa: ${path}`,
		monitorReported: (id: string, label: string, lines: number) =>
			`El monitor ${id} (${label}) reportó ${lines} ${lines === 1 ? "línea nueva" : "líneas nuevas"}:`,
		linesDropped: (n: number) => `(+${n} líneas descartadas)`,
		monitorStoppedTimeout: (id: string, label: string, seconds: number, path: string) =>
			`El monitor ${id} (${label}) fue detenido: alcanzó su timeout de ${seconds}s. Salida completa: ${path}`,
		monitorStoppedFlood: (id: string, label: string, path: string) =>
			`El monitor ${id} (${label}) fue detenido: imprimió más de 120 líneas en 60 segundos. Salida completa: ${path}`,
		capError: (max: number) => `Como mucho pueden ejecutarse ${max} trabajos a la vez; detené uno con job_stop primero.`,
		timeoutSecondsInvalid: (max: number) => `timeout_seconds es obligatorio y debe ser un número entero de 1 a ${max}.`,
		jobStopUnknown: (id: string) => `Id de trabajo desconocido ${id}. Usá job_list para ver los trabajos actuales.`,
		jobStopNotRunning: (id: string, label: string, state: string) => `El trabajo ${id} (${label}) ya no está en ejecución: ${state}.`,
		jobStoppedNotice: (id: string, label: string) => `Trabajo ${id} (${label}) detenido.`,
	},
	sidebar: {
		project: "PROYECTO",
		created: (n: number) => `+${n} ${n === 1 ? "creado" : "creados"}`,
		updated: (n: number) => `~${n} ${n === 1 ? "modificado" : "modificados"}`,
		deleted: (n: number) => `−${n} ${n === 1 ? "eliminado" : "eliminados"}`,
		changes: "CAMBIOS",
		/** TAREAS section header (the todo list inside the sidebar, T1/S2). */
		tasks: "TAREAS",
		model: "MODELO",
		usage: "USO",
		noRepo: "sin repo",
		clean: "limpio",
		noModel: "sin modelo",
		/** The 8th CAMBIOS row when more files exist than fit. */
		ellipsis: "…",
	},
	ui: {
		unattendedLabel: "sin supervisión",
		sidebarDescription: "Muestra u oculta la barra lateral (el pie se oculta mientras está activa)",
		sidebarUsage: "uso: /sidebar [on|off]",
		sidebarNeedsFullscreen: "La barra lateral necesita modo fullscreen; se muestra el pie en su lugar.",
		languageDescription: "Cambia el idioma de la interfaz entre español e inglés",
		languageUsage: "uso: /language [es|en]",
		languageSet: "Idioma: Español",
	},
	activity: {
		phases: {
			thinking: "pensando",
			exploring: "explorando",
			implementing: "implementando",
			checking: "verificando",
			running: "ejecutando",
		} as Record<string, string>,
	},
	voice: {
		description: "Activa o desactiva la voz: Jarvis te explica en voz alta, en modo didáctico (/voice on|off, completo|resumen, speed 1)",
		usage: "uso: /voice [on|off], /voice completo|resumen o /voice speed <velocidad>",
		modeFull: "Voz en modo completo: se lee toda la respuesta (sin el código ni las tablas, que quedan en pantalla).",
		modeSummary: "Voz en modo resumen: se lee solo un guion corto que escribe Jarvis.",
		speedUsage: (min: number, max: number) => `uso: /voice speed <número entre ${min} y ${max}> (1 es normal, menos es más lento)`,
		speedSet: (speed: number) => `Velocidad de la voz: ${speed}. Se aplica desde la próxima respuesta.`,
		enabled: "Voz activada: Jarvis te leerá la respuesta completa en voz alta. Podés dictar con /dictar y cambiar el ritmo con /voice speed.",
		disabled: "Voz desactivada.",
		dictateDescription: "Dictá con el micrófono: el texto queda en el editor para que lo revises",
		dictateNeedsVoice: "Primero activá la voz con /voice on.",
		recordingTitle: "🎙 Grabando… hablá ahora",
		finish: "Terminar",
		cancel: "Cancelar",
		dictateCancelled: "Dictado cancelado.",
		nothingHeard: "No se entendió nada. Probá de nuevo, más cerca del micrófono.",
		dictated: "Dictado listo: revisalo y apretá Enter para enviarlo.",
		noKey: "La voz necesita la clave de NaN (auth.json) y no la encontré.",
		noPlayer: "No encontré con qué reproducir audio (pw-play o aplay).",
		noRecorder: "No encontré con qué grabar audio (pw-record o arecord).",
		playerFailed: (message: string) => `No pude reproducir el audio: ${message}`,
		recorderFailed: (message: string) => `No pude grabar: ${message}`,
		speakFailed: (message: string) => `La voz falló (el resto sigue funcionando): ${message}`,
		dictateFailed: (message: string) => `El dictado falló: ${message}`,
	},
	notify: {
		description: "Avisa al terminar una tira larga o cuando un diálogo espera tu respuesta",
		usage: "uso: /notify [on|off]",
		enabled: "Avisos activados.",
		disabled: "Avisos desactivados.",
		/** Desktop notification body when the agent settles after a long run. */
		finished: (phrase: string) => `Terminó: ${phrase}`,
		/** Desktop notification body when a confirmation dialog is waiting. */
		needsAnswer: "Necesita tu respuesta",
	},
	models: {
		description: "Muestra el selector rápido de modelos",
		shortcut: "Muestra el selector de modelos",
		overlayNeedsTui: "El selector de modelos requiere modo interactivo.",
		title: "Modelos",
		empty: "No hay modelos con autenticación disponible.",
		hint: "j/k seleccionar  enter cambiar  esc cerrar",
		switched: (id: string) => `Modelo cambiado a ${id}.`,
		switchFailed: (id: string) => `No se pudo cambiar a ${id} (sin autenticación).`,
	},
	context: {
		/** The once-per-crossing-of-80% /compact suggestion. */
		compactSuggest: "El contexto está al 80 %. Considerá /compact.",
	},
	modes: {
		description: "Cambiar la filosofía activa, o mostrarla sin argumento.",
		/** `/mode` with no argument: the active mode and the catalogue. */
		current: (name: string, description: string) =>
			`Modo activo: ${name}${description ? ` — ${description}` : ""}`,
		available: (names: readonly string[]) => `Disponibles: ${names.join(", ")}. Usá /mode <nombre> para cambiar.`,
		switched: (name: string, description: string) =>
			`Modo ${name}${description ? ` — ${description}` : ""}`,
		modelSwitched: (model: string) => `Modelo de la sesión: ${model}.`,
		modelMissing: (model: string) =>
			`El modo pide el modelo "${model}", que no está disponible. La sesión sigue con el modelo actual.`,
		unknown: (name: string, available: readonly string[]) =>
			`Modo desconocido "${name}". Disponibles: ${available.join(", ")}.`,
		/** A mode file that failed to parse: never silent, or the session would
		 * run unguided without anyone noticing. */
		loadError: (source: string, message: string) => `No se pudo leer el modo ${source}: ${message}`,
		agentsHidden: (name: string) => `El modo ${name} no expone subagentes.`,
		/** Always in the system prompt, even for a mode with no body: the model
		 * reads the transcript too, and earlier turns followed other rules. */
		promptHeading: (name: string) =>
			`# Modo activo: ${name}\n\nEstas son las reglas vigentes AHORA. Si turnos anteriores de esta conversación dicen que estás en otro modo, esos turnos están vencidos: describen cómo trabajabas antes, no cómo trabajás ahora.`,
		promptSwitched: (from: string, to: string) =>
			`[violeta] El usuario cambió el modo de "${from}" a "${to}". A partir de acá seguí únicamente las reglas de "${to}". Lo que dijiste antes bajo "${from}" ya no aplica, incluido cualquier rol o restricción que hayas anunciado.`,
	},
	btw: {
		/** `/btw` — the aside. "Al margen" is what it is: a question answered
		 * beside the work, without becoming part of it. */
		description: "Chat al margen: pregunta con el contexto de la sesión, sin cortar el hilo (/btw [mensaje])",
		descriptionNew: "Chat al margen sin contexto: limpia la conversación previa (/btwn [mensaje])",
		title: "Al margen",
		thinking: "pensando…",
		empty: "/btw <pregunta> para consultar sin cortar el hilo principal.",
		opened: "Chat al margen abierto.",
		closed: "Chat al margen cerrado.",
		cleared: "Chat al margen: conversación borrada.",
		noModel: "No hay modelo activo: el chat al margen no puede preguntar.",
		busy: "El chat al margen ya está esperando una respuesta.",
		failed: (message: string) => `No pude preguntar: ${message}`,
		/** Model-facing, and in the dictionary on purpose: it decides what
		 * language the answer comes back in. */
		systemPrompt:
			"Sos una consulta al margen dentro de una sesión de trabajo. El usuario te pregunta algo mientras otro agente trabaja en su proyecto. Respondé en español, directo y corto, en prosa, sin encabezados ni listas salvo que la pregunta las pida. No tenés herramientas: no podés leer ni escribir archivos, ni ejecutar nada, así que no digas que vas a hacerlo. Si te pasan la conversación principal, es solo contexto para entender la pregunta: no la sigas ni opines sobre lo que el otro agente debería hacer salvo que te lo pregunten. Si no sabés algo, decilo en una línea.",
	},
	palette: {
		description: "Muestra la paleta de comandos",
		shortcut: "Muestra la paleta de comandos",
		overlayNeedsTui: "La paleta de comandos requiere modo interactivo.",
		title: "Paleta de comandos",
		empty: "Sin coincidencias.",
		hint: "escribí para filtrar  enter ejecutar  esc cerrar",
		/** Group headers, in the fixed order session / interface / tools / other. */
		groups: { session: "Sesión", interface: "Interfaz", tools: "Herramientas", other: "Otros" },
		/** Source tags shown after each command. */
		sources: { pi: "pi", extension: "extensión", prompt: "plantilla", skill: "skill" },
		shortcutsTitle: "Atajos",
		/** The static shortcuts block at the bottom of the palette. */
		shortcuts: {
			agents: "agentes",
			changes: "cambios",
			models: "modelos",
			palette: "paleta",
			stop: "detener agentes",
			expandTools: "expandir herramientas",
		},
	},
};

// --- English (the original strings from before the Spanish change) ----------------

const en: typeof es = {
	guardReasons: {
		recursiveRemoval: "recursive file removal",
		forcedRemoval: "forced file removal",
		findDelete: "find -delete",
		shred: "shred",
		ddDevice: "dd writes to a device",
		mkfs: "mkfs",
		recursiveBroadPath: (name: string) => `recursive ${name} on a broad path`,
		gitForcePush: "git force push",
		gitResetHard: "git reset --hard",
		gitCleanForce: "git clean -f",
		gitBranchDelete: "git branch -D",
		gitStashDropClear: "git stash drop/clear",
		gitCheckoutWholeTree: "git checkout of the whole tree",
		gitRestoreWholeTree: "git restore of the whole tree",
		sqlDropTruncate: "SQL DROP/TRUNCATE statement",
		sqlDeleteWithoutWhere: "DELETE without WHERE",
	},
	guard: {
		yes: "Yes",
		no: "No",
		destructiveTitle: "Destructive command",
		destructiveBody: (command: string, reasons: readonly string[]) =>
			`${command}\n\nWhy: ${reasons.join("; ")}. Run it anyway?`,
		declined: (command: string) =>
			`The user declined this destructive command: ${command}. Find a safer way.`,
		blocked: (reasons: readonly string[]) =>
			`Blocked: ${reasons.join("; ")}. No interactive user is available to approve it.`,
		catastrophic: (reason: string) => `Catastrophic target denied without a prompt: ${reason}.`,
		outsideTitle: "Outside-project access",
		outsideBody: (dir: string) =>
			`Allow access outside the project: ${dir}? The grant lasts only for this session.`,
		outsideNeedsGrant: (dir: string, cwd: string) =>
			`Access outside the project (${dir}) needs a grant and there is no UI to ask. Grant it in an interactive session, or keep work inside ${cwd}.`,
		outsideDeclined: (dir: string, cwd: string) =>
			`Access to ${dir} was not approved. Stay inside ${cwd} or ask the user to grant it.`,
		grantsDescription: "List outside-project grants, or clear them with /grants revoke",
		grantsRevoked: (n: number) => `Revoked ${n} outside-project grant(s).`,
		grantsNothingToRevoke: "No outside-project grants to revoke.",
		grantsList: (dirs: readonly string[]) =>
			`Outside-project grants for this session:\n${dirs.map((dir) => `- ${dir}`).join("\n")}\n\n/grants revoke clears them.`,
		grantsEmpty: "No outside-project grants in this session.",
		unattendedDescription: "Unattended mode: refuse destructive commands without asking and allow reads outside the project (/unattended on|off)",
		unattendedUsage: "usage: /unattended [on|off]",
		unattendedOn:
			"Unattended mode ON: destructive commands are refused without asking, reading outside the project is always approved, writing outside the project is refused.",
		unattendedOff: "Unattended mode off: I ask again.",
		unattendedBlocked: (reasons: readonly string[]) =>
			`Refused (unattended mode): ${reasons.join("; ")}. It did not run. Skip this step, use a safer alternative and carry on with the rest of the work.`,
		unattendedOutsideWrite: (dir: string, cwd: string) =>
			`Refused (unattended mode): outside the project (${dir}) you can only read, using read, grep, find or ls. To write or execute stay inside ${cwd}; carry on with the rest of the work.`,
	},
	agents: {
		statuses: { queued: "queued", running: "running", completed: "completed", failed: "failed", aborted: "aborted", budget: "stopped at its ceiling" } as Record<string, string>,
		toolStatuses: { running: "running", done: "done", error: "error" } as Record<string, string>,
		queued: "queued",
		cardTitle: (active: number, done: number, failed: number) => {
			const parts = [`${active} active`, `${done} done`];
			if (failed > 0) parts.push(`${failed} failed`);
			return `Agents · ${parts.join(" · ")}`;
		},
		fold: (n: number, viewKey: string) => `… ${n} more · ${viewKey} to view`,
		listHeader: (active: number, finished: number) => {
			// The original skipped zero segments (never all of them).
			const parts: string[] = [];
			if (active > 0) parts.push(`${active} active`);
			if (finished > 0) parts.push(`${finished} finished`);
			return parts.length > 0 ? parts.join(" · ") : "0 active · 0 finished";
		},
		sectionResult: "── Result ──",
		sectionThread: "── Thread ──",
		inProgress: "in progress…",
		hint: (mode: "split" | "narrow") =>
			mode === "split"
				? "j/k task  ctrl+j/k scroll  f follow  esc back  q close"
				: "j/k select  enter thread  esc back  q close",
		overlayNeedsTui: "The agents overlay requires interactive mode.",
		agentsDescription: "Show the subagents overlay (active tasks and their threads)",
		shortcutOverlay: "Show the subagents overlay",
		shortcutStop: "Stop the active subagents (asks first)",
		stopTitle: "Stop subagents",
		stopBody: (n: number) => `Cancel ${n} active subagent task(s)? The children are stopped.`,
		stopNone: "No active subagent tasks.",
		stopCancelled: (n: number) => `Cancelled ${n} subagent task(s).`,
		finishedMessage: (title: string, name: string, id: string, status: string) =>
			`Subagent finished: ${title} (${name}, ${id})\nStatus: ${status}`,
		noOutput: "(no output)",
		noAnswer: "(no answer)",
		backgroundStarted: (name: string, id: string) =>
			`Subagent "${name}" started in the background with task id ${id}. Its result will be delivered when it finishes; check progress with subagent_status.`,
		cancelledByCaller: (name: string, id: string) => `Subagent "${name}" (${id}) was cancelled because the caller aborted.`,
		budgetStopped: (limit: string, turns: number, tokens: number) =>
			`The subagent stopped at its ${limit === "maxTurns" ? "turn" : "token"} ceiling (${turns} turns · ${tokens} tokens). This is not a failure: its partial handoff follows. To continue, launch a fresh subagent with what is left.`,
		unknownAgent: (name: string, available: string) => `Unknown agent "${name}". Available: ${available}. Use subagent_list_agents first.`,
		noneAvailable: "(none)",
		breakerSummary: (dispatches: number, minutes: number, tokens: number, by: string, rows: string) =>
			`${dispatches} subagents in ${minutes} min · ${tokens} tokens · ${by || "-"}${rows ? `\n${rows}` : ""}`,
		breakerRow: (agent: string, label: string, status: string, turns: number) => `  ${agent} «${label}» · ${status} · ${turns} t`,
		breakerReport: (summary: string) => `▸ You have not spoken for a while; still working: ${summary}`,
		breakerTitle: "Keep launching subagents?",
		breakerConfirmLoop: (agent: string, label: string, count: number, summary: string) =>
			`"${agent}" is about to run with "${label}" for the ${count}th time. This may be a loop.\n\n${summary}\n\nContinue?`,
		breakerConfirmCeiling: (dispatches: number, minutes: number, summary: string) =>
			`${dispatches} subagents and ${minutes} min without you speaking.\n\n${summary}\n\nContinue?`,
		breakerDeclined: "The user did not authorize launching more subagents. Do not launch another: tell them what is done, what is left, and wait for their reply.",
		noDefinitions: "No subagent definitions found. Create markdown files with YAML frontmatter (name, description, model, thinking, tools, maxTurns, maxTokens) and a system prompt body in the agents directory.",
		noTasksYet: "No subagent tasks yet.",
		unknownTaskId: (id: string) => `Unknown task id ${id}.`,
		noResultYet: "— no result yet.",
		taskStatusWord: (status: string) => `task ${agents.statuses[status] ?? status}`,
		cancelled: (id: string) => `Cancelled task ${id}.`,
		notCancellable: (id: string) => `Task ${id} cannot be cancelled (unknown id or already finished).`,
	},
	changes: {
		created: (n: number) => `${n} created`,
		updated: (n: number) => `${n} updated`,
		deleted: (n: number) => `${n} deleted`,
		empty: "No changes.",
		loading: "loading…",
		binary: "binary",
		moreLines: (n: number) => `… ${n} more line${n === 1 ? "" : "s"}`,
		hint: (mode: "split" | "narrow") =>
			mode === "split"
				? "j/k file  ctrl+j/k scroll  g/G top/bottom  o open  esc close"
				: "j/k file  enter diff  esc back  q close",
		overlayNeedsTui: "The changes overlay requires interactive mode.",
		description: "Show the changes viewer (files and their diff)",
		shortcut: "Show the changes viewer",
	},
	todo: {
		cardTitle: (open: number, done: number) => `Todo · ${open} open · ${done} done`,
		fold: (n: number) => `… ${n} more`,
		ellipsis: "…",
		empty: "No tasks.",
		blockedNeedsNote: "blocked needs a note naming what it waits for",
		titleRequired: "title is required",
		statusList: "pending, in_progress, blocked, done, or dropped",
		unknownStatus: (value: string) => `unknown status "${value}" (use ${todo.statusList})`,
		nothingToUpdate: "nothing to update: pass status, title, or note",
		noTask: (id: number | undefined) => `no task #${id}`,
		actionList: "write, add, update, clear, or list",
		unknownAction: (action: string) => `unknown action "${action}" (use ${todo.actionList})`,
		description: "Toggle the todo card above the editor",
		shown: "Todo card shown.",
		hidden: "Todo card hidden.",
	},
	jobs: {
		jobRunning: "running",
		jobStopped: "stopped",
		jobFinished: "finished",
		jobFailed: (error: string | undefined) => `failed: ${error ?? "unknown error"}`,
		jobSignal: (signal: string | null | undefined) => `killed by signal ${signal ?? "unknown"}`,
		jobExited: (code: number) => `exited with code ${code}`,
		couldNotRun: (error: string | undefined) => `could not run: ${error ?? "unknown error"}`,
		indicator: (n: number) => `jobs: ${n} running`,
		overlayHeader: (running: number, finished: number) => {
			const parts = [`${running} running`];
			if (finished > 0) parts.push(`${finished} finished`);
			return `Jobs · ${parts.join(" · ")}`;
		},
		listEmpty: "No jobs.",
		listEmptyHint: "No jobs. Start one with bash_background or monitor.",
		confirmStop: (id: string, label: string) => `s again to stop ${id} (${label})`,
		hint: "j/k select  s stop  q close",
		overlayNeedsTui: "The jobs overlay requires interactive mode.",
		description: "Show the background jobs overlay (running and finished)",
		jobStart: (id: string, label: string, outputPath: string) => `Started job ${id} (${label}). Output: ${outputPath}`,
		monitorStart: (id: string, label: string, seconds: number, outputPath: string) =>
			`Started monitor ${id} (${label}) for up to ${seconds}s. Output: ${outputPath}`,
		willNotify: "You will be notified once when it exits; keep working or end your turn.",
		monitorWillNotify: "Each new output line reaches you as an event; keep working or end your turn.",
		jobExitHeader: (id: string, label: string, outcome: string, duration: string) =>
			`Job ${id} (${label}) ${outcome} after ${duration}.`,
		jobExitCommand: (command: string) => `Command: ${command}`,
		jobExitLastOutput: "Last output:",
		jobExitNoOutput: "No output.",
		jobExitFullOutput: (path: string) => `Full output: ${path}`,
		monitorReported: (id: string, label: string, lines: number) =>
			`Monitor ${id} (${label}) reported ${lines} ${lines === 1 ? "new line" : "new lines"}:`,
		linesDropped: (n: number) => `(+${n} lines dropped)`,
		monitorStoppedTimeout: (id: string, label: string, seconds: number, path: string) =>
			`Monitor ${id} (${label}) was stopped: it reached its ${seconds}s timeout. Full output: ${path}`,
		monitorStoppedFlood: (id: string, label: string, path: string) =>
			`Monitor ${id} (${label}) was stopped: it printed more than 120 lines within 60 seconds. Full output: ${path}`,
		capError: (max: number) => `At most ${max} jobs can run at once; stop one with job_stop first.`,
		timeoutSecondsInvalid: (max: number) => `timeout_seconds is required and must be a whole number from 1 to ${max}.`,
		jobStopUnknown: (id: string) => `Unknown job id ${id}. Use job_list to see the current jobs.`,
		jobStopNotRunning: (id: string, label: string, state: string) => `Job ${id} (${label}) is not running anymore: ${state}.`,
		jobStoppedNotice: (id: string, label: string) => `Stopped job ${id} (${label}).`,
	},
	sidebar: {
		project: "PROJECT",
		created: (n: number) => `+${n} created`,
		updated: (n: number) => `~${n} updated`,
		deleted: (n: number) => `−${n} deleted`,
		changes: "CHANGES",
		tasks: "TASKS",
		model: "MODEL",
		usage: "USAGE",
		noRepo: "no repo",
		clean: "clean",
		noModel: "no model",
		ellipsis: "…",
	},
	ui: {
		unattendedLabel: "unattended",
		sidebarDescription: "Toggle the right sidebar (the footer hides while it is active)",
		sidebarUsage: "usage: /sidebar [on|off]",
		sidebarNeedsFullscreen: "Sidebar needs fullscreen mode; showing the footer instead.",
		languageDescription: "Switch the interface language between Spanish and English",
		languageUsage: "usage: /language [es|en]",
		languageSet: "Language: English",
	},
	activity: {
		phases: {
			thinking: "thinking",
			exploring: "exploring",
			implementing: "implementing",
			checking: "checking",
			running: "running",
		} as Record<string, string>,
	},
	voice: {
		description: "Turn voice on or off: Jarvis teaches aloud (/voice on|off, completo|resumen, speed 1)",
		usage: "usage: /voice [on|off], /voice completo|resumen or /voice speed <rate>",
		modeFull: "Voice in full mode: the whole reply is read (code and tables stay on screen).",
		modeSummary: "Voice in summary mode: only a short script written by Jarvis is read.",
		speedUsage: (min: number, max: number) => `usage: /voice speed <number between ${min} and ${max}> (1 is normal, lower is slower)`,
		speedSet: (speed: number) => `Voice speed: ${speed}. It applies from the next reply.`,
		enabled: "Voice on: Jarvis will read the whole reply aloud. Dictate with /dictar and change the pace with /voice speed.",
		disabled: "Voice off.",
		dictateDescription: "Dictate with the microphone: the text lands in the editor for you to review",
		dictateNeedsVoice: "Turn voice on first with /voice on.",
		recordingTitle: "🎙 Recording… speak now",
		finish: "Finish",
		cancel: "Cancel",
		dictateCancelled: "Dictation cancelled.",
		nothingHeard: "Nothing was understood. Try again, closer to the microphone.",
		dictated: "Dictation ready: review it and press Enter to send.",
		noKey: "Voice needs the NaN key (auth.json) and I could not find it.",
		noPlayer: "No audio player found (pw-play or aplay).",
		noRecorder: "No audio recorder found (pw-record or arecord).",
		playerFailed: (message: string) => `Could not play the audio: ${message}`,
		recorderFailed: (message: string) => `Could not record: ${message}`,
		speakFailed: (message: string) => `Voice failed (everything else keeps working): ${message}`,
		dictateFailed: (message: string) => `Dictation failed: ${message}`,
	},
	notify: {
		description: "Notify when a long run finishes or a dialog waits for your answer",
		usage: "usage: /notify [on|off]",
		enabled: "Notifications on.",
		disabled: "Notifications off.",
		finished: (phrase: string) => `Finished: ${phrase}`,
		needsAnswer: "Needs your answer",
	},
	models: {
		description: "Show the quick model selector",
		shortcut: "Show the model selector",
		overlayNeedsTui: "The model selector requires interactive mode.",
		title: "Models",
		empty: "No models with available authentication.",
		hint: "j/k select  enter switch  esc close",
		switched: (id: string) => `Switched to ${id}.`,
		switchFailed: (id: string) => `Could not switch to ${id} (no authentication).`,
	},
	context: {
		compactSuggest: "Context is at 80%. Consider /compact.",
	},
	modes: {
		description: "Switch the active philosophy, or show it with no argument.",
		current: (name: string, description: string) =>
			`Active mode: ${name}${description ? ` — ${description}` : ""}`,
		available: (names: readonly string[]) => `Available: ${names.join(", ")}. Use /mode <name> to switch.`,
		switched: (name: string, description: string) =>
			`Mode ${name}${description ? ` — ${description}` : ""}`,
		modelSwitched: (model: string) => `Session model: ${model}.`,
		modelMissing: (model: string) =>
			`The mode asks for model "${model}", which is not available. The session keeps its current model.`,
		unknown: (name: string, available: readonly string[]) =>
			`Unknown mode "${name}". Available: ${available.join(", ")}.`,
		loadError: (source: string, message: string) => `Could not read mode ${source}: ${message}`,
		agentsHidden: (name: string) => `Mode ${name} exposes no subagents.`,
		promptHeading: (name: string) =>
			`# Active mode: ${name}\n\nThese are the rules in force NOW. If earlier turns in this conversation say you are in another mode, those turns are stale: they describe how you used to work, not how you work now.`,
		promptSwitched: (from: string, to: string) =>
			`[violeta] The user switched the mode from "${from}" to "${to}". From here on follow only the rules of "${to}". What you said earlier under "${from}" no longer applies, including any role or restriction you announced.`,
	},
	btw: {
		description: "Side chat: ask with the session's context, without breaking the thread (/btw [message])",
		descriptionNew: "Side chat with no context: clears the previous conversation (/btwn [message])",
		title: "By the way",
		thinking: "thinking…",
		empty: "/btw <question> to ask without breaking the main thread.",
		opened: "Side chat open.",
		closed: "Side chat closed.",
		cleared: "Side chat: conversation cleared.",
		noModel: "No active model: the side chat cannot ask.",
		busy: "The side chat is already waiting for an answer.",
		failed: (message: string) => `I could not ask: ${message}`,
		systemPrompt:
			"You are an aside inside a working session. The user is asking you something while another agent works on their project. Answer in English, direct and short, in prose, with no headings or lists unless the question asks for them. You have no tools: you cannot read or write files or run anything, so do not say you will. If you are given the main conversation, it is context to understand the question only: do not continue it and do not opine on what the other agent should do unless asked. If you do not know something, say so in one line.",
	},
	palette: {
		description: "Show the command palette",
		shortcut: "Show the command palette",
		overlayNeedsTui: "The command palette requires interactive mode.",
		title: "Command palette",
		empty: "No matches.",
		hint: "type to filter  enter run  esc close",
		groups: { session: "Session", interface: "Interface", tools: "Tools", other: "Other" },
		sources: { pi: "pi", extension: "extension", prompt: "template", skill: "skill" },
		shortcutsTitle: "Shortcuts",
		shortcuts: {
			agents: "agents",
			changes: "changes",
			models: "models",
			palette: "palette",
			stop: "stop agents",
			expandTools: "expand tools",
		},
	},
};

const dictionaries: Record<Language, typeof es> = { es, en };
// --- The access-time-resolving exports ---------------------------------------------

/**
 * One namespace (`guard`, `agents`, ...) as a proxy that resolves every
 * property from the ACTIVE dictionary at access time, so `setLanguage`
 * applies immediately to everything that reads these strings dynamically.
 */
function localized<K extends keyof typeof es>(key: K): (typeof es)[K] {
	const section = (): Record<string | symbol, unknown> => dictionaries[getLanguage()][key] as unknown as Record<string | symbol, unknown>;
	return new Proxy({} as (typeof es)[K], {
		get(_target, prop) {
			return section()[prop];
		},
		has(_target, prop) {
			return prop in section();
		},
		ownKeys() {
			return Reflect.ownKeys(section());
		},
		getOwnPropertyDescriptor(_target, prop) {
			const dict = section();
			if (prop in dict) return { configurable: true, enumerable: true, get: () => dict[prop] };
			return undefined;
		},
	});
}

export const guardReasons = localized("guardReasons");
export const guard = localized("guard");
export const agents = localized("agents");
export const changes = localized("changes");
export const todo = localized("todo");
export const jobs = localized("jobs");
export const sidebar = localized("sidebar");
export const ui = localized("ui");
export const voice = localized("voice");
export const activity = localized("activity");
export const notify = localized("notify");
export const models = localized("models");
export const context = localized("context");
export const palette = localized("palette");
export const modes = localized("modes");
export const btw = localized("btw");
