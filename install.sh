#!/usr/bin/env bash
# Instalador de violeta para un sistema operativo recién instalado.
#
#   curl -fsSL https://raw.githubusercontent.com/TasioDemarchi/pi-violeta/main/install.sh | bash
#   o, con el repo ya clonado:  ./install.sh
#
# Hace todo lo que hace falta y verifica que funcionó:
#   1. comprueba las dependencias (git, node >= 22, npm, jq)
#   2. clona el repo en $VIOLETA_DIR (por defecto ~/violeta) o lo actualiza
#   3. instala las dependencias de Node
#   4. crea el enlace en ~/.local/bin/violeta
#   5. prepara ~/.violeta/agent y guarda la API key de NaN en auth.json
#   6. corre los tests: si pasan, la instalación está sana
#
# Opciones:
#   VIOLETA_DIR=~/violeta     dónde vive el repo
#   NAN_KEY=...               la API key, para que no la pregunte
#   VIOLETA_SKIP_TESTS=1      no correr los tests al final

set -uo pipefail

REPO_URL="https://github.com/TasioDemarchi/pi-violeta.git"
TARGET="${VIOLETA_DIR:-$HOME/violeta}"
AGENT_DIR="${VIOLETA_HOME:-$HOME/.violeta}/agent"
BIN_DIR="$HOME/.local/bin"
BRANCH="main"

say() { printf '\n\033[1;35m▸ %s\033[0m\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$*"; }
die() { bad "$*"; exit 1; }

# ---------------------------------------------------------------- 1. dependencias
say "Comprobando dependencias"

command -v git >/dev/null || die "falta git. Debian/Ubuntu: sudo apt install git"
ok "git $(git --version | awk '{print $3}')"

if ! command -v node >/dev/null; then
	cat <<'EOF'
  ✗ falta node. Instalá Node 22 o superior y volvé a correr este script:

    Debian/Ubuntu (sin sudo, con nvm):
      curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
      . "$HOME/.nvm/nvm.sh" && nvm install 24
    Debian/Ubuntu (con sudo, versión del sistema):
      curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt install -y nodejs
    Fedora:  sudo dnf install nodejs npm
    Arch:    sudo pacman -S nodejs npm
    macOS:   brew install node

  violeta necesita Node 22 o más nuevo: corre TypeScript sin compilar.
EOF
	exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || die "node $NODE_MAJOR es muy viejo; hace falta 22 o más"
ok "node $(node --version)"

command -v npm >/dev/null || die "falta npm (viene con node: instalá el paquete completo)"
ok "npm $(npm --version)"

# jq NO es opcional: config/models.json resuelve la API key con jq en cada request.
if ! command -v jq >/dev/null; then
	bad "falta jq — sin jq violeta no puede leer la API key y ninguna llamada va a funcionar"
	printf '    Debian/Ubuntu: sudo apt install jq\n    Fedora: sudo dnf install jq\n    Arch: sudo pacman -S jq\n    macOS: brew install jq\n'
	exit 1
fi
ok "jq $(jq --version)"

# ------------------------------------------------------------------- 2. el repo
say "Obteniendo violeta en $TARGET"
if [ -d "$TARGET/.git" ]; then
	git -C "$TARGET" fetch --quiet origin "$BRANCH" || die "no pude contactar GitHub"
	git -C "$TARGET" checkout --quiet "$BRANCH"
	git -C "$TARGET" pull --quiet --ff-only origin "$BRANCH" || die "no pude actualizar (¿cambios locales?)"
	ok "actualizado a $(git -C "$TARGET" log --oneline -1)"
else
	mkdir -p "$(dirname "$TARGET")"
	git clone --quiet --branch "$BRANCH" "$REPO_URL" "$TARGET" || die "no pude clonar $REPO_URL"
	ok "clonado en $TARGET"
fi

# ------------------------------------------------------------- 3. dependencias JS
say "Instalando dependencias de Node (puede tardar)"
cd "$TARGET" || die "no puedo entrar a $TARGET"
npm install --silent --no-fund --no-audit || die "npm install falló"
[ -f "$TARGET/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js" ] \
	|| die "quedó incompleto: falta el motor de Pi en node_modules"
ok "dependencias listas"

# ------------------------------------------------------------------- 4. el enlace
say "Creando el comando violeta"
mkdir -p "$BIN_DIR"
ln -sf "$TARGET/bin/violeta" "$BIN_DIR/violeta"
chmod +x "$TARGET/bin/violeta" "$TARGET/install.sh" 2>/dev/null
ok "$BIN_DIR/violeta -> $TARGET/bin/violeta"
case ":$PATH:" in
	*":$BIN_DIR:"*) : ;;
	*) bad "$BIN_DIR no está en tu PATH. Agregá esto a ~/.bashrc o ~/.zshrc:"
	   printf '      export PATH="$HOME/.local/bin:$PATH"\n' ;;
esac

# ------------------------------------------------------------------ 5. la API key
say "Configurando la API key de NaN"
mkdir -p "$AGENT_DIR"
AUTH="$AGENT_DIR/auth.json"
KEY="${NAN_KEY:-}"

if [ -z "$KEY" ] && [ -f "$AUTH" ] && [ -n "$(jq -r '.nan.key // empty' "$AUTH" 2>/dev/null)" ]; then
	ok "ya había una key guardada en $AUTH; la dejo como está"
elif [ -z "$KEY" ] && [ -f "$HOME/.gentle-shell/agent/auth.json" ] \
	&& [ -n "$(jq -r '.nan.key // empty' "$HOME/.gentle-shell/agent/auth.json" 2>/dev/null)" ]; then
	jq '{nan: .nan}' "$HOME/.gentle-shell/agent/auth.json" > "$AUTH"
	chmod 600 "$AUTH"
	ok "importada desde gentle-shell"
elif [ -z "$KEY" ]; then
	printf '  Pegá tu API key de NaN y Enter (no se muestra): '
	stty -echo 2>/dev/null; read -r KEY; stty echo 2>/dev/null; printf '\n'
fi

if [ -n "$KEY" ]; then
	jq -n --arg k "$KEY" '{nan: {type: "api_key", key: $k}}' > "$AUTH"
	chmod 600 "$AUTH"
	ok "guardada en $AUTH (permisos 600)"
else
	bad "sin key. Cuando la tengas:"
	printf '      printf %%s "TU_KEY" | jq -R "{nan:{type:\\"api_key\\",key:.}}" > %s\n' "$AUTH"
fi

# ------------------------------------------------------------------ 6. verificar
if [ "${VIOLETA_SKIP_TESTS:-}" = "1" ]; then
	say "Tests salteados (VIOLETA_SKIP_TESTS=1)"
else
	say "Verificando la instalación con los tests"
	if npm test --silent 2>&1 | tail -8 | grep -qE '^# fail 0|ℹ fail 0'; then
		ok "los 500 y pico de tests pasan"
	else
		bad "algún test falló. Corré 'cd $TARGET && npm test' para ver el detalle"
		exit 1
	fi
fi

say "Listo"
printf '  Abrí una terminal nueva y escribí:  \033[1mvioleta\033[0m\n'
printf '  Dentro, el modo se elige con:      /mode jarvis\n\n'
