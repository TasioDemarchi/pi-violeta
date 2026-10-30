/**
 * i18n — every user-facing string violeta itself shows, centralized (S10).
 *
 * Spanish (rioplatense-neutral), grouped by area, with plain functions for
 * plurals and interpolation (`n === 1 ? "activo" : "activos"`) so another
 * language can be added later by swapping this module.
 *
 * Deliberately NOT here (they stay English):
 * - tool names, parameter names, tool/parameter descriptions and TypeBox
 *   schema text (they are for the model),
 * - code identifiers, comments and README,
 * - status/enum VALUES used as identifiers (`blocked`, `in_progress`,
 *   `job`, `monitor`, thinking levels) and user-provided content,
 * - Pi core's own strings (`Operation aborted`, dialog key hints, `Working`).
 */

// --- Guard -------------------------------------------------------------------

/** Human-readable reasons a command was flagged, shown in the dialog. */
export const guardReasons = {
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
} as const;

export const guard = {
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
};

// --- Agents (card, overlay, tool results) --------------------------------------

const plural = (n: number, singular: string, pluralForm: string) => `${n} ${n === 1 ? singular : pluralForm}`;

export const agents = {
	/** Display words for task statuses (the values themselves stay identifiers). */
	statuses: { queued: "en cola", running: "en curso", completed: "completado", failed: "fallido", aborted: "abortado" } as Record<string, string>,
	/** Display words for thread tool-call states. */
	toolStatuses: { running: "en curso", done: "listo", error: "error" } as Record<string, string>,
	queued: "en cola",
	cardTitle: (active: number, done: number, failed: number) => {
		const parts = [plural(active, "activo", "activos"), plural(done, "terminado", "terminados")];
		if (failed > 0) parts.push(plural(failed, "fallido", "fallidos"));
		return `Agentes · ${parts.join(" · ")}`;
	},
	fold: (n: number, viewKey: string) => `… ${n} más · ${viewKey} para ver`,
	listHeader: (active: number, finished: number) =>
		`${plural(active, "activo", "activos")} · ${plural(finished, "terminado", "terminados")}`,
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
	unknownAgent: (name: string, available: string) => `Agente desconocido "${name}". Disponibles: ${available}. Usá subagent_list_agents primero.`,
	noDefinitions: "No se encontraron definiciones de subagentes. Creá archivos markdown con frontmatter YAML (name, description, model, thinking, tools) y un cuerpo de system prompt en el directorio de agents.",
	noTasksYet: "Todavía no hay tareas de subagentes.",
	unknownTaskId: (id: string) => `Id de tarea desconocido ${id}.`,
	noResultYet: "— todavía sin resultado.",
	taskStatusWord: (status: string) => `tarea ${agents.statuses[status] ?? status}`,
	cancelled: (id: string) => `Tarea ${id} cancelada.`,
	notCancellable: (id: string) => `La tarea ${id} no se puede cancelar (id desconocido o ya terminada).`,
};

// --- Todo ----------------------------------------------------------------------

export const todo = {
	cardTitle: (open: number, done: number) => `Tareas · ${plural(open, "abierta", "abiertas")} · ${plural(done, "hecha", "hechas")}`,
	fold: (n: number) => `… ${n} más`,
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
};

// --- Jobs ------------------------------------------------------------------------

export const jobs = {
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
};

// --- Sidebar, footer and activity -------------------------------------------------

export const sidebar = {
	project: "PROYECTO",
	changes: "CAMBIOS",
	model: "MODELO",
	usage: "USO",
	noRepo: "sin repo",
	clean: "limpio",
	noModel: "sin modelo",
	created: (n: number) => `+${n} ${n === 1 ? "creado" : "creados"}`,
	updated: (n: number) => `~${n} ${n === 1 ? "modificado" : "modificados"}`,
	deleted: (n: number) => `−${n} ${n === 1 ? "eliminado" : "eliminados"}`,
	more: (n: number) => `+${n} más`,
};

export const ui = {
	sidebarDescription: "Muestra u oculta la barra lateral (el pie se oculta mientras está activa)",
	sidebarUsage: "uso: /sidebar [on|off]",
	sidebarNeedsFullscreen: "La barra lateral necesita modo fullscreen; se muestra el pie en su lugar.",
};

export const activity = {
	phases: {
		thinking: "pensando",
		exploring: "explorando",
		implementing: "implementando",
		checking: "verificando",
		running: "ejecutando",
	} as Record<string, string>,
};
