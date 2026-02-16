#!/usr/bin/env bash
#
# Project Triage Script (standalone bash version)
# Tests projects end-to-end: Docker → DB → Backend → Frontend → Health checks
#
# Usage:
#   ./scripts/triage.sh instagram                  # Single project
#   ./scripts/triage.sh instagram twitter bitly     # Multiple projects
#   ./scripts/triage.sh --wave 1                    # Wave 1 (10 projects)
#   ./scripts/triage.sh --wave 2                    # Wave 2
#   ./scripts/triage.sh --all                       # All projects with configs
#   ./scripts/triage.sh --list                      # List available projects
#   ./scripts/triage.sh --report                    # Show last report
#
# Requirements:
#   - Docker Desktop running
#   - Node.js >= 20
#   - curl
#
# Output:
#   - triage-report.json at repo root (JSON, one entry per project)
#   - Console: color-coded GREEN/YELLOW/ORANGE/RED summary
#

set -euo pipefail

# ─────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_DIR="$SCRIPT_DIR/screenshot-configs"
REPORT_FILE="$REPO_ROOT/triage-report.json"

BACKEND_PORT=3000
FRONTEND_PORT=5173
BACKEND_TIMEOUT=45       # seconds to wait for backend
FRONTEND_TIMEOUT=90      # seconds to wait for frontend
DB_TIMEOUT=30            # seconds to wait for postgres
REDIS_TIMEOUT=15         # seconds to wait for redis

# Waves
WAVE1=(instagram twitter airbnb bitly slack discord reddit shopify uber doordash)
WAVE2=(spotify netflix notion calendly stripe tiktok yelp youtube whatsapp venmo)
WAVE3=(hotel-booking jira linkedin etsy imessage google-calendar google-docs strava job-scheduler tinder)
WAVE4=(amazon dropbox github google-search robinhood apple-music apple-pay apple-tv app-store icloud)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
BG_GREEN='\033[42;30m'
BG_YELLOW='\033[43;30m'
BG_RED='\033[41;37m'
BG_MAGENTA='\033[45;37m'
RESET='\033[0m'

# Track background PIDs for cleanup
BACKEND_PID=""
FRONTEND_PID=""
DOCKER_STARTED=false

# ─────────────────────────────────────────────────────────────────────
# Logging helpers
# ─────────────────────────────────────────────────────────────────────

log_step()  { echo -e "${CYAN}[$1]${RESET} $2"; }
log_ok()    { echo -e "${GREEN}  ✓${RESET} $1"; }
log_warn()  { echo -e "${YELLOW}  ⚠${RESET} $1"; }
log_err()   { echo -e "${RED}  ✗${RESET} $1"; }
log_info()  { echo -e "${DIM}  $1${RESET}"; }

# ─────────────────────────────────────────────────────────────────────
# Cleanup (runs on exit/signal)
# ─────────────────────────────────────────────────────────────────────

cleanup() {
  log_step "CLEANUP" "Stopping all services..."

  # Kill backend
  if [[ -n "$BACKEND_PID" ]]; then
    kill "$BACKEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
    BACKEND_PID=""
  fi

  # Kill frontend
  if [[ -n "$FRONTEND_PID" ]]; then
    kill "$FRONTEND_PID" 2>/dev/null || true
    wait "$FRONTEND_PID" 2>/dev/null || true
    FRONTEND_PID=""
  fi

  # Kill anything on our ports
  kill_port $BACKEND_PORT
  kill_port $FRONTEND_PORT

  # Stop Docker if we started it
  if [[ "$DOCKER_STARTED" == true ]] && [[ -n "${CURRENT_PROJECT_DIR:-}" ]]; then
    docker-compose -f "$CURRENT_PROJECT_DIR/docker-compose.yml" down -v --remove-orphans 2>/dev/null || true
  fi

  DOCKER_STARTED=false
}

trap cleanup EXIT INT TERM

kill_port() {
  local port=$1
  local pids
  pids=$(lsof -ti:"$port" 2>/dev/null || true)
  if [[ -n "$pids" ]]; then
    echo "$pids" | xargs kill -9 2>/dev/null || true
  fi
}

# ─────────────────────────────────────────────────────────────────────
# Prerequisite checks
# ─────────────────────────────────────────────────────────────────────

check_prerequisites() {
  local missing=()

  if ! command -v docker &>/dev/null; then
    missing+=("docker")
  elif ! docker info &>/dev/null 2>&1; then
    echo -e "${RED}ERROR: Docker is installed but not running. Start Docker Desktop first.${RESET}"
    exit 1
  fi

  if ! command -v node &>/dev/null; then
    missing+=("node")
  fi

  if ! command -v curl &>/dev/null; then
    missing+=("curl")
  fi

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo -e "${RED}ERROR: Missing required tools: ${missing[*]}${RESET}"
    echo "Install with: brew install ${missing[*]}"
    exit 1
  fi
}

# ─────────────────────────────────────────────────────────────────────
# Config loading (reads screenshot-configs/*.json)
# ─────────────────────────────────────────────────────────────────────

# Parse a value from a JSON file using node (avoids jq dependency)
json_val() {
  local file="$1" key="$2"
  node -e "const c=JSON.parse(require('fs').readFileSync('$file','utf-8')); const v=$key; process.stdout.write(String(v ?? ''));"
}

get_config_val() {
  local project="$1" key="$2"
  local config_file="$CONFIG_DIR/${project}.json"
  if [[ -f "$config_file" ]]; then
    json_val "$config_file" "$key"
  fi
}

has_config() {
  [[ -f "$CONFIG_DIR/$1.json" ]]
}

# ─────────────────────────────────────────────────────────────────────
# Docker management
# ─────────────────────────────────────────────────────────────────────

start_docker() {
  local project_dir="$1" project_name="$2"

  if [[ ! -f "$project_dir/docker-compose.yml" ]] && [[ ! -f "$project_dir/docker-compose.yaml" ]]; then
    log_warn "No docker-compose.yml found"
    return 1
  fi

  log_step "DOCKER" "Stopping old containers for $project_name..."
  docker-compose -f "$project_dir/docker-compose.yml" down -v --remove-orphans 2>/dev/null || true
  sleep 2

  log_step "DOCKER" "Starting infrastructure for $project_name..."
  if docker-compose -f "$project_dir/docker-compose.yml" up -d 2>/dev/null; then
    log_ok "Docker services started"
    sleep 5
    DOCKER_STARTED=true
    return 0
  else
    log_err "Docker-compose up failed"
    return 1
  fi
}

# ─────────────────────────────────────────────────────────────────────
# Wait for services
# ─────────────────────────────────────────────────────────────────────

wait_for_postgres() {
  local project_dir="$1" db_user="$2"

  log_step "DB" "Waiting for PostgreSQL (user: $db_user)..."
  for i in $(seq 1 $DB_TIMEOUT); do
    if docker-compose -f "$project_dir/docker-compose.yml" exec -T postgres pg_isready -U "$db_user" &>/dev/null; then
      log_ok "PostgreSQL ready (${i}s)"
      return 0
    fi
    sleep 1
  done
  log_err "PostgreSQL not ready after ${DB_TIMEOUT}s"
  return 1
}

wait_for_redis() {
  local project_dir="$1"

  # Check if redis service exists
  local services
  services=$(docker-compose -f "$project_dir/docker-compose.yml" config --services 2>/dev/null || echo "")
  if ! echo "$services" | grep -q "redis"; then
    log_info "No Redis service, skipping"
    return 0
  fi

  log_step "REDIS" "Waiting for Redis..."
  for i in $(seq 1 $REDIS_TIMEOUT); do
    if docker-compose -f "$project_dir/docker-compose.yml" exec -T redis redis-cli ping &>/dev/null; then
      log_ok "Redis ready (${i}s)"
      return 0
    fi
    sleep 1
  done
  log_warn "Redis not ready after ${REDIS_TIMEOUT}s"
  return 1
}

wait_for_url() {
  local url="$1" timeout="$2" label="$3"

  log_step "WAIT" "Waiting for $label at $url..."
  for i in $(seq 1 "$timeout"); do
    local status
    status=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
    if [[ "$status" =~ ^[23] ]]; then
      log_ok "$label ready (HTTP $status, ${i}s)"
      return 0
    fi
    sleep 1
  done
  log_err "$label not ready after ${timeout}s"
  return 1
}

# ─────────────────────────────────────────────────────────────────────
# Migration and seeding
# ─────────────────────────────────────────────────────────────────────

run_migration() {
  local project_dir="$1"
  local backend_dir="$project_dir/backend"

  if [[ ! -f "$backend_dir/package.json" ]]; then
    log_info "No backend/package.json"
    return 0
  fi

  # Check if db:migrate script exists
  if ! node -e "const p=JSON.parse(require('fs').readFileSync('$backend_dir/package.json','utf-8')); process.exit(p.scripts?.['db:migrate'] ? 0 : 1)" 2>/dev/null; then
    log_info "No db:migrate script"
    return 0
  fi

  log_step "MIGRATE" "Running database migrations..."
  if (cd "$backend_dir" && npm run db:migrate 2>&1 | tail -5); then
    log_ok "Migrations complete"
    return 0
  else
    log_err "Migrations failed"
    return 1
  fi
}

run_seed() {
  local project_dir="$1" db_name="$2" db_user="$3"

  # Find seed.sql
  local seed_file=""
  for f in \
    "$project_dir/backend/db-seed/seed.sql" \
    "$project_dir/backend/seed.sql" \
    "$project_dir/backend/db/seed.sql" \
    "$project_dir/db/seed.sql"; do
    if [[ -f "$f" ]]; then
      seed_file="$f"
      break
    fi
  done

  if [[ -z "$seed_file" ]]; then
    log_info "No seed.sql found"
    return 0
  fi

  log_step "SEED" "Seeding from $(basename "$seed_file")..."
  if cat "$seed_file" | docker-compose -f "$project_dir/docker-compose.yml" exec -T postgres psql -U "$db_user" -d "$db_name" &>/dev/null; then
    log_ok "Database seeded"
    return 0
  else
    log_warn "Seed failed (may be OK if tables don't exist yet)"
    return 1
  fi
}

# ─────────────────────────────────────────────────────────────────────
# Start services
# ─────────────────────────────────────────────────────────────────────

install_deps() {
  local dir="$1" label="$2"
  if [[ ! -d "$dir/node_modules" ]]; then
    log_step "NPM" "Installing $label dependencies..."
    if (cd "$dir" && npm install --silent 2>&1 | tail -3); then
      log_ok "$label deps installed"
    else
      log_err "$label npm install failed"
      return 1
    fi
  fi
  return 0
}

start_backend() {
  local project_dir="$1"
  local backend_dir="$project_dir/backend"

  if [[ ! -d "$backend_dir" ]]; then
    log_warn "No backend directory"
    return 1
  fi

  install_deps "$backend_dir" "backend" || return 1

  kill_port $BACKEND_PORT

  log_step "BACKEND" "Starting backend on port $BACKEND_PORT..."
  (cd "$backend_dir" && PORT=$BACKEND_PORT npm run dev &>/dev/null) &
  BACKEND_PID=$!

  wait_for_url "http://localhost:$BACKEND_PORT" "$BACKEND_TIMEOUT" "Backend" || return 1
  return 0
}

start_frontend() {
  local project_dir="$1"
  local frontend_dir="$project_dir/frontend"

  if [[ ! -d "$frontend_dir" ]]; then
    log_err "No frontend directory"
    return 1
  fi

  install_deps "$frontend_dir" "frontend" || return 1

  kill_port $FRONTEND_PORT

  log_step "FRONTEND" "Starting frontend on port $FRONTEND_PORT..."
  (cd "$frontend_dir" && npm run dev &>/dev/null) &
  FRONTEND_PID=$!

  wait_for_url "http://localhost:$FRONTEND_PORT" "$FRONTEND_TIMEOUT" "Frontend" || return 1
  return 0
}

# ─────────────────────────────────────────────────────────────────────
# Health checks
# ─────────────────────────────────────────────────────────────────────

check_frontend_loads() {
  log_step "CHECK" "Frontend HTTP status..."
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$FRONTEND_PORT" 2>/dev/null || echo "000")
  if [[ "$status" == "200" ]]; then
    log_ok "Frontend HTTP 200"
    return 0
  else
    log_err "Frontend HTTP $status"
    return 1
  fi
}

check_backend_health() {
  log_step "CHECK" "Backend health endpoint..."
  for endpoint in /api/v1/health /api/health /health /api/v1/status; do
    local status
    status=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$BACKEND_PORT$endpoint" 2>/dev/null || echo "000")
    if [[ "$status" =~ ^2 ]]; then
      log_ok "Health OK via $endpoint (HTTP $status)"
      return 0
    fi
  done

  # Fallback: check if root responds at all
  local root_status
  root_status=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$BACKEND_PORT/" 2>/dev/null || echo "000")
  if [[ "$root_status" != "000" ]]; then
    log_ok "Backend responds on / (HTTP $root_status)"
    return 0
  fi

  log_err "No health endpoint found"
  return 1
}

check_login() {
  local project="$1"

  # Get auth config
  local auth_enabled
  auth_enabled=$(get_config_val "$project" "c.auth?.enabled")
  if [[ "$auth_enabled" != "true" ]]; then
    log_info "Auth not enabled, skipping login check"
    return 0
  fi

  # Get credentials from config
  local email username password
  email=$(get_config_val "$project" "c.auth?.credentials?.email")
  username=$(get_config_val "$project" "c.auth?.credentials?.username")
  password=$(get_config_val "$project" "c.auth?.credentials?.password || 'password123'")

  # Build JSON payload
  local payload="{"
  if [[ -n "$email" ]]; then
    payload+="\"email\":\"$email\","
  fi
  if [[ -n "$username" ]]; then
    payload+="\"username\":\"$username\","
  fi
  payload+="\"password\":\"$password\"}"

  log_step "CHECK" "Testing login with: $payload"

  for endpoint in /api/v1/auth/login /api/auth/login /api/v1/login /api/login; do
    local response status body
    body=$(curl -s -w "\n%{http_code}" -X POST \
      -H "Content-Type: application/json" \
      -d "$payload" \
      "http://localhost:$BACKEND_PORT$endpoint" 2>/dev/null || echo -e "\n000")

    status=$(echo "$body" | tail -1)
    response=$(echo "$body" | sed '$d')

    if [[ "$status" =~ ^2 ]]; then
      log_ok "Login OK via $endpoint (HTTP $status)"
      return 0
    fi

    if [[ "$status" == "401" ]] || [[ "$status" == "400" ]]; then
      log_err "Login failed via $endpoint (HTTP $status): $(echo "$response" | head -c 150)"
      return 1
    fi
    # 404 = wrong endpoint, try next
  done

  log_err "No working login endpoint found"
  return 1
}

check_main_page_content() {
  log_step "CHECK" "Main page content..."
  local body
  body=$(curl -s "http://localhost:$FRONTEND_PORT" 2>/dev/null || echo "")
  local length=${#body}

  if echo "$body" | grep -qi "error.boundary\|something went wrong\|application error"; then
    log_err "Error boundary or crash page detected"
    return 1
  fi

  if echo "$body" | grep -qi 'id="root"\|id="app"'; then
    log_ok "React root found ($length bytes)"
    return 0
  fi

  if [[ $length -gt 200 ]]; then
    log_ok "Page loaded ($length bytes)"
    return 0
  fi

  log_warn "Page seems empty ($length bytes)"
  return 1
}

# ─────────────────────────────────────────────────────────────────────
# Grade calculation
# ─────────────────────────────────────────────────────────────────────

calculate_grade() {
  local docker_ok="$1" backend_ok="$2" frontend_ok="$3"
  local frontend_loads="$4" login_ok="$5" page_ok="$6"

  if [[ "$docker_ok" == "1" && "$backend_ok" == "1" && "$frontend_ok" == "1" \
     && "$frontend_loads" == "1" && "$login_ok" == "1" && "$page_ok" == "1" ]]; then
    echo "GREEN"
  elif [[ "$backend_ok" == "1" && "$frontend_ok" == "1" && "$frontend_loads" == "1" ]]; then
    echo "YELLOW"
  elif [[ "$docker_ok" == "1" && ("$backend_ok" == "1" || "$frontend_ok" == "1") ]]; then
    echo "ORANGE"
  else
    echo "RED"
  fi
}

grade_color() {
  case "$1" in
    GREEN)  echo "$BG_GREEN" ;;
    YELLOW) echo "$BG_YELLOW" ;;
    ORANGE) echo "$BG_MAGENTA" ;;
    RED)    echo "$BG_RED" ;;
    *)      echo "$RESET" ;;
  esac
}

# ─────────────────────────────────────────────────────────────────────
# Triage one project
# ─────────────────────────────────────────────────────────────────────

triage_project() {
  local project="$1"
  local project_dir="$REPO_ROOT/$project"
  local start_time=$SECONDS

  # Reset state
  BACKEND_PID=""
  FRONTEND_PID=""
  DOCKER_STARTED=false
  CURRENT_PROJECT_DIR="$project_dir"

  # Result tracking (1=ok, 0=fail)
  local docker_ok=0 pg_ok=0 redis_ok=0 migrate_ok=0 seed_ok=0
  local backend_ok=0 frontend_ok=0 frontend_loads=0
  local health_ok=0 login_ok=0 page_ok=0
  local errors=()

  # Detect config
  local db_name db_user
  if has_config "$project"; then
    db_name=$(get_config_val "$project" "c.dbName || ''")
    db_user=$(get_config_val "$project" "c.dbUser || ''")
  fi
  db_name="${db_name:-$(echo "$project" | tr '-' '_')}"
  db_user="${db_user:-$db_name}"

  echo ""
  echo "════════════════════════════════════════════════════════════"
  echo -e "${BOLD}  TRIAGE: $project${RESET}"
  echo "════════════════════════════════════════════════════════════"

  # Check files exist
  local has_seed=0 has_init=0
  for f in "$project_dir/backend/db-seed/seed.sql" "$project_dir/backend/seed.sql" "$project_dir/backend/db/seed.sql"; do
    [[ -f "$f" ]] && has_seed=1 && break
  done
  for f in "$project_dir/backend/src/db/init.sql" "$project_dir/backend/db/init.sql" "$project_dir/backend/init.sql" "$project_dir/backend/scripts/init.sql"; do
    [[ -f "$f" ]] && has_init=1 && break
  done
  log_info "Config: $(has_config "$project" && echo "yes" || echo "no")  init.sql: $([[ $has_init -eq 1 ]] && echo "yes" || echo "no")  seed.sql: $([[ $has_seed -eq 1 ]] && echo "yes" || echo "no")"

  # 1. Docker
  if start_docker "$project_dir" "$project"; then
    docker_ok=1
  else
    errors+=("Docker failed")
  fi

  # 2. Wait for PostgreSQL
  if [[ $docker_ok -eq 1 ]]; then
    if wait_for_postgres "$project_dir" "$db_user"; then
      pg_ok=1
    else
      errors+=("PostgreSQL not ready")
    fi
  fi

  # 3. Wait for Redis
  if [[ $docker_ok -eq 1 ]]; then
    if wait_for_redis "$project_dir"; then
      redis_ok=1
    else
      errors+=("Redis not ready")
    fi
  fi

  # 4. Migration
  if [[ $pg_ok -eq 1 ]]; then
    if run_migration "$project_dir"; then
      migrate_ok=1
    else
      errors+=("Migration failed")
    fi
  fi

  # 5. Seed
  if [[ $pg_ok -eq 1 ]]; then
    if run_seed "$project_dir" "$db_name" "$db_user"; then
      seed_ok=1
    else
      errors+=("Seed failed")
    fi
  fi

  # 6. Backend
  if start_backend "$project_dir"; then
    backend_ok=1
  else
    errors+=("Backend failed to start")
  fi

  # 7. Frontend
  if start_frontend "$project_dir"; then
    frontend_ok=1
  else
    errors+=("Frontend failed to start")
  fi

  # 8. Health checks
  if [[ $frontend_ok -eq 1 ]]; then
    check_frontend_loads && frontend_loads=1
    check_main_page_content && page_ok=1
  fi

  if [[ $backend_ok -eq 1 ]]; then
    check_backend_health && health_ok=1
    check_login "$project" && login_ok=1 || errors+=("Login failed")
  fi

  # Calculate grade
  local grade
  grade=$(calculate_grade $docker_ok $backend_ok $frontend_ok $frontend_loads $login_ok $page_ok)
  local duration=$(( SECONDS - start_time ))

  # Print summary
  echo ""
  echo -e "  $(grade_color "$grade") $grade ${RESET}  ${BOLD}$project${RESET}  (${duration}s)"
  echo "  Docker:$([[ $docker_ok -eq 1 ]] && echo "✓" || echo "✗")  PG:$([[ $pg_ok -eq 1 ]] && echo "✓" || echo "✗")  Redis:$([[ $redis_ok -eq 1 ]] && echo "✓" || echo "✗")  Migrate:$([[ $migrate_ok -eq 1 ]] && echo "✓" || echo "✗")  Seed:$([[ $seed_ok -eq 1 ]] && echo "✓" || echo "✗")"
  echo "  Backend:$([[ $backend_ok -eq 1 ]] && echo "✓" || echo "✗")  Frontend:$([[ $frontend_ok -eq 1 ]] && echo "✓" || echo "✗")  Login:$([[ $login_ok -eq 1 ]] && echo "✓" || echo "✗")  Health:$([[ $health_ok -eq 1 ]] && echo "✓" || echo "✗")  Page:$([[ $page_ok -eq 1 ]] && echo "✓" || echo "✗")"
  if [[ ${#errors[@]} -gt 0 ]]; then
    echo -e "  ${RED}Errors: ${errors[*]}${RESET}"
  fi

  # Cleanup this project
  cleanup

  # Append to report
  local errors_json="[]"
  if [[ ${#errors[@]} -gt 0 ]]; then
    errors_json=$(printf '%s\n' "${errors[@]}" | node -e "
      const lines=require('fs').readFileSync('/dev/stdin','utf-8').trim().split('\n');
      process.stdout.write(JSON.stringify(lines));
    ")
  fi

  local entry
  entry=$(cat <<ENTRY_EOF
{
  "project": "$project",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "grade": "$grade",
  "hasConfig": $(has_config "$project" && echo "true" || echo "false"),
  "hasSeedSql": $([[ $has_seed -eq 1 ]] && echo "true" || echo "false"),
  "hasInitSql": $([[ $has_init -eq 1 ]] && echo "true" || echo "false"),
  "dockerUp": $([[ $docker_ok -eq 1 ]] && echo "true" || echo "false"),
  "postgresReady": $([[ $pg_ok -eq 1 ]] && echo "true" || echo "false"),
  "redisReady": $([[ $redis_ok -eq 1 ]] && echo "true" || echo "false"),
  "migrationOk": $([[ $migrate_ok -eq 1 ]] && echo "true" || echo "false"),
  "seedOk": $([[ $seed_ok -eq 1 ]] && echo "true" || echo "false"),
  "backendStarted": $([[ $backend_ok -eq 1 ]] && echo "true" || echo "false"),
  "frontendStarted": $([[ $frontend_ok -eq 1 ]] && echo "true" || echo "false"),
  "frontendLoads": $([[ $frontend_loads -eq 1 ]] && echo "true" || echo "false"),
  "backendHealthOk": $([[ $health_ok -eq 1 ]] && echo "true" || echo "false"),
  "loginOk": $([[ $login_ok -eq 1 ]] && echo "true" || echo "false"),
  "mainPageOk": $([[ $page_ok -eq 1 ]] && echo "true" || echo "false"),
  "duration": $duration,
  "errors": $errors_json
}
ENTRY_EOF
  )

  # Merge into report file
  if [[ -f "$REPORT_FILE" ]]; then
    node -e "
      const fs = require('fs');
      const report = JSON.parse(fs.readFileSync('$REPORT_FILE', 'utf-8'));
      const entry = $entry;
      report.projects[entry.project] = entry;
      report.generated = new Date().toISOString();
      fs.writeFileSync('$REPORT_FILE', JSON.stringify(report, null, 2));
    "
  else
    node -e "
      const fs = require('fs');
      const entry = $entry;
      const report = { generated: new Date().toISOString(), projects: { [entry.project]: entry } };
      fs.writeFileSync('$REPORT_FILE', JSON.stringify(report, null, 2));
    "
  fi

  log_ok "Result saved to triage-report.json"
}

# ─────────────────────────────────────────────────────────────────────
# Report display
# ─────────────────────────────────────────────────────────────────────

show_report() {
  if [[ ! -f "$REPORT_FILE" ]]; then
    echo -e "${YELLOW}No triage report found. Run triage first.${RESET}"
    exit 1
  fi

  node -e "
    const fs = require('fs');
    const report = JSON.parse(fs.readFileSync('$REPORT_FILE', 'utf-8'));
    const projects = Object.values(report.projects);

    const green  = projects.filter(p => p.grade === 'GREEN');
    const yellow = projects.filter(p => p.grade === 'YELLOW');
    const orange = projects.filter(p => p.grade === 'ORANGE');
    const red    = projects.filter(p => p.grade === 'RED');

    console.log('');
    console.log('════════════════════════════════════════════════════════════');
    console.log('  TRIAGE REPORT SUMMARY');
    console.log('════════════════════════════════════════════════════════════');
    console.log('  Generated:', report.generated);
    console.log('');

    console.log('\x1b[32m  GREEN  (' + green.length + '): Everything works\x1b[0m');
    green.forEach(p => console.log('    ✓', p.project));
    console.log('');

    console.log('\x1b[33m  YELLOW (' + yellow.length + '): Minor issues (login/health)\x1b[0m');
    yellow.forEach(p => console.log('    ⚠', p.project, '—', (p.errors[0] || '')));
    console.log('');

    console.log('\x1b[35m  ORANGE (' + orange.length + '): Partially broken\x1b[0m');
    orange.forEach(p => console.log('    ⚠', p.project, '—', (p.errors[0] || '')));
    console.log('');

    console.log('\x1b[31m  RED    (' + red.length + '): Broken\x1b[0m');
    red.forEach(p => console.log('    ✗', p.project, '—', (p.errors[0] || '')));
    console.log('');

    console.log('  Total:', projects.length, 'projects triaged');
    console.log('════════════════════════════════════════════════════════════');
  "
}

# ─────────────────────────────────────────────────────────────────────
# List available projects
# ─────────────────────────────────────────────────────────────────────

list_projects() {
  echo -e "${CYAN}Projects with screenshot configs:${RESET}"
  echo ""
  for f in "$CONFIG_DIR"/*.json; do
    local name
    name=$(basename "$f" .json)
    local project_dir="$REPO_ROOT/$name"
    local tags=""
    [[ -d "$project_dir/frontend" ]] && tags+="frontend "
    [[ -d "$project_dir/backend" ]] && tags+="backend "
    [[ -f "$project_dir/docker-compose.yml" ]] && tags+="docker "
    printf "  %-28s ${DIM}[%s]${RESET}\n" "$name" "${tags% }"
  done
  echo ""
  echo "Waves:"
  echo "  Wave 1: ${WAVE1[*]}"
  echo "  Wave 2: ${WAVE2[*]}"
  echo "  Wave 3: ${WAVE3[*]}"
  echo "  Wave 4: ${WAVE4[*]}"
}

# ─────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────

main() {
  echo ""
  echo "🏥 Project Triage Script (bash)"
  echo ""

  # Parse args
  local projects=()

  if [[ $# -eq 0 ]]; then
    echo "Usage:"
    echo "  $0 <project> [project2 ...]   # Triage specific projects"
    echo "  $0 --wave 1                   # Triage Wave 1"
    echo "  $0 --all                      # Triage all configured projects"
    echo "  $0 --list                     # List available projects"
    echo "  $0 --report                   # Show last report"
    exit 0
  fi

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --list)
        list_projects
        exit 0
        ;;
      --report)
        show_report
        exit 0
        ;;
      --all)
        for f in "$CONFIG_DIR"/*.json; do
          projects+=("$(basename "$f" .json)")
        done
        shift
        ;;
      --wave)
        local wave_num="${2:-}"
        shift 2 || { echo "Missing wave number"; exit 1; }
        case "$wave_num" in
          1) projects=("${WAVE1[@]}") ;;
          2) projects=("${WAVE2[@]}") ;;
          3) projects=("${WAVE3[@]}") ;;
          4) projects=("${WAVE4[@]}") ;;
          *) echo "Unknown wave: $wave_num (available: 1-4)"; exit 1 ;;
        esac
        ;;
      --*)
        echo "Unknown option: $1"
        exit 1
        ;;
      *)
        projects+=("$1")
        shift
        ;;
    esac
  done

  # Prerequisites
  check_prerequisites

  # Validate projects
  local valid_projects=()
  for p in "${projects[@]}"; do
    if [[ -d "$REPO_ROOT/$p" ]]; then
      valid_projects+=("$p")
    else
      log_warn "Project not found: $p"
    fi
  done

  if [[ ${#valid_projects[@]} -eq 0 ]]; then
    log_err "No valid projects to triage"
    exit 1
  fi

  echo -e "${CYAN}Triaging ${#valid_projects[@]} project(s): ${valid_projects[*]}${RESET}"

  # Triage each project
  for project in "${valid_projects[@]}"; do
    triage_project "$project"
  done

  # Final summary
  show_report
}

main "$@"
