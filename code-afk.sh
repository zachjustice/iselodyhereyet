#!/bin/bash
set -e

usage() {
  echo "Usage: $0 <iterations> <github-issue-url> [--tool claude|codex|gemini]"
  echo ""
  echo "Options:"
  echo "  --tool    CLI tool to use (default: claude)"
  exit 1
}

# --- Parse arguments ---
TOOL="claude"
POSITIONAL=()

while [[ $# -gt 0 ]]; do
  case $1 in
    --tool)
      TOOL="$2"
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    *)
      POSITIONAL+=("$1")
      shift
      ;;
  esac
done

ITERATIONS="${POSITIONAL[0]}"
ISSUE_URL="${POSITIONAL[1]}"

if [ -z "$ITERATIONS" ] || [ -z "$ISSUE_URL" ]; then
  usage
fi

if [[ "$TOOL" != "claude" && "$TOOL" != "codex" && "$TOOL" != "gemini" ]]; then
  echo "Error: --tool must be one of: claude, codex, gemini"
  exit 1
fi

# --- Shared prompt (tool-neutral) ---
TASK_PROMPT="1. Find the highest-priority task for the given github issue and implement it. \
2. Run your tests and type checks. \
3. Update the PRD with what was done. \
4. Append your progress to progress.txt. \
5. Commit your changes. \
ONLY WORK ON A SINGLE TASK. \
If the github issue is complete, output <promise>STOP</promise>. \
If you are blocked and cannot unblock yourself, print the issue, update progress.txt and then finally output <promise>STOP</promise>."

# --- Tool-specific runner ---
run_claude() {
  claude --permission-mode acceptEdits -p \
    "@PRD.md @ARCHITECTURE.md @README.md \
     The github issue is: $ISSUE_URL \
     $TASK_PROMPT"
}

run_codex() {
  # codex exec is non-interactive (-p equivalent).
  # --auto-edit auto-approves file edits, prompts for shell commands.
  # Codex reads the working directory automatically; reference files by name.
  codex exec --auto-edit \
    "Read PRD.md, ARCHITECTURE.md, and README.md for project context. \
     The github issue is: $ISSUE_URL \
     $TASK_PROMPT"
}

run_gemini() {
  # Positional prompt (--prompt / -p is deprecated).
  # --approval-mode auto_edit auto-approves file writes, prompts for shell.
  # @file syntax injects file content, same as Claude.
  gemini --approval-mode auto_edit \
    "@PRD.md @ARCHITECTURE.md @README.md \
     The github issue is: $ISSUE_URL \
     $TASK_PROMPT"
}

# --- Main loop ---
echo "Running $ITERATIONS iteration(s) with $TOOL..."

for ((i = 1; i <= ITERATIONS; i++)); do
  echo ""
  echo "=== Iteration $i / $ITERATIONS ($TOOL) ==="

  result=$("run_$TOOL")

  echo "$result"

  if [[ "$result" == *"<promise>STOP</promise>"* ]]; then
    echo "Stopping after $i iteration(s)."
    exit 0
  fi
done

echo "Completed all $ITERATIONS iteration(s)."
