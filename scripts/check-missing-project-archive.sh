#!/usr/bin/env bash
# PURPOSE: Validate missing-project archival results after refreshing the WebUI project list.

set -euo pipefail

PROJECT_PATH=""
ARCHIVE_FILE="${HOME}/.claude/project-archive.json"
HISTORY_FILES=()

# Show command usage and exit.
usage() {
  cat <<'USAGE'
Usage:
  scripts/check-missing-project-archive.sh --project-path <path> [--history-file <path>]... [--archive-file <path>]

Options:
  --project-path  Required. Project path that has been deleted/moved.
  --history-file  Optional, repeatable. History files that must still exist.
  --archive-file  Optional. Override archive index file path (default: ~/.claude/project-archive.json).
  -h, --help      Show this help message.
USAGE
}

# Parse CLI arguments for verification inputs.
parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --project-path)
        PROJECT_PATH="${2:-}"
        shift 2
        ;;
      --history-file)
        HISTORY_FILES+=("${2:-}")
        shift 2
        ;;
      --archive-file)
        ARCHIVE_FILE="${2:-}"
        shift 2
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        echo "Unknown argument: $1" >&2
        usage
        exit 1
        ;;
    esac
  done

  if [[ -z "$PROJECT_PATH" ]]; then
    echo "--project-path is required" >&2
    usage
    exit 1
  fi
}

# Ensure the project path is currently missing on disk.
assert_project_path_missing() {
  if [[ -e "$PROJECT_PATH" ]]; then
    echo "[FAIL] Project path still exists: $PROJECT_PATH" >&2
    echo "Delete or move this path first, then refresh WebUI and retry." >&2
    exit 1
  fi
  echo "[OK] Project path is missing: $PROJECT_PATH"
}

# Ensure archive index file exists before reading it.
assert_archive_file_exists() {
  if [[ ! -f "$ARCHIVE_FILE" ]]; then
    echo "[FAIL] Archive file not found: $ARCHIVE_FILE" >&2
    echo "Refresh WebUI first to trigger /api/projects archival pass." >&2
    exit 1
  fi
  echo "[OK] Archive file exists: $ARCHIVE_FILE"
}

# Validate archive entry for the missing project path.
assert_archive_entry_present() {
  local node_output
  node_output="$(node --input-type=module - "$PROJECT_PATH" "$ARCHIVE_FILE" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';

const [projectPath, archiveFile] = process.argv.slice(2);

const normalizeComparablePath = (inputPath) => {
  if (!inputPath || typeof inputPath !== 'string') {
    return '';
  }

  const withoutLongPathPrefix = inputPath.startsWith('\\\\?\\')
    ? inputPath.slice(4)
    : inputPath;
  const normalized = path.normalize(withoutLongPathPrefix.trim());
  if (!normalized) {
    return '';
  }

  const resolved = path.resolve(normalized);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

const normalizedPath = normalizeComparablePath(projectPath);
const archiveIndex = JSON.parse(fs.readFileSync(archiveFile, 'utf8'));
const archivedProjects = archiveIndex.archivedProjects || {};
const record = archivedProjects[normalizedPath];

if (!record) {
  console.error(`missing-entry:${normalizedPath}`);
  process.exit(1);
}

if (record.reason !== 'path-missing') {
  console.error(`invalid-reason:${record.reason}`);
  process.exit(1);
}

console.log(`entry-ok:${normalizedPath}`);
NODE
)" || {
    echo "[FAIL] Missing or invalid archive entry for project path." >&2
    exit 1
  }

  echo "[OK] Archive entry validated: ${node_output#entry-ok:}"
}

# Ensure history files still exist after archival.
assert_history_files_preserved() {
  if [[ ${#HISTORY_FILES[@]} -eq 0 ]]; then
    echo "[SKIP] No --history-file provided."
    return
  fi

  local missing_count=0
  for history_file in "${HISTORY_FILES[@]}"; do
    if [[ -f "$history_file" ]]; then
      echo "[OK] History file exists: $history_file"
    else
      echo "[FAIL] History file missing: $history_file" >&2
      missing_count=$((missing_count + 1))
    fi
  done

  if [[ $missing_count -gt 0 ]]; then
    exit 1
  fi
}

main() {
  parse_args "$@"
  assert_project_path_missing
  assert_archive_file_exists
  assert_archive_entry_present
  assert_history_files_preserved

  echo "[PASS] Missing-path archival verification completed."
}

main "$@"
