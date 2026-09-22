#!/bin/bash
# Rodin Pipeline launcher for macOS. Double-click this file in Finder.
# 맥에서 이 파일을 더블클릭하면 앱이 켜지고 브라우저가 자동으로 열립니다.

export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.nvm/versions/node/current/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1

# Find the project folder: next to this file, or the usual clone locations.
DIR="$(cd "$(dirname "$0")" && pwd)"
for candidate in "$DIR" "$HOME/logan_git_test2" "$HOME/Desktop/logan_git_test2" "$HOME/Documents/logan_git_test2"; do
  if [ -f "$candidate/package.json" ] && [ -d "$candidate/rodin-pipeline" ]; then
    DIR="$candidate"
    break
  fi
done
cd "$DIR" || exit 1

echo "== Rodin Pipeline =="
echo "폴더 / folder: $DIR"

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "Node.js가 설치되어 있지 않습니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요."
  echo "Node.js is not installed. Install the LTS version from https://nodejs.org and run this again."
  open "https://nodejs.org"
  read -n 1 -s -r -p "아무 키나 누르면 닫힙니다 / press any key to close"
  exit 1
fi

# Pull the latest version when this folder is a git checkout (harmless if offline).
if [ -d .git ] && command -v git >/dev/null 2>&1; then
  echo "최신 버전 확인 중… / checking for updates…"
  git pull --ff-only 2>/dev/null || echo "(업데이트를 건너뜁니다 / update skipped)"
fi

if [ ! -d node_modules ]; then
  echo
  echo "처음 실행입니다. 필요한 패키지를 설치합니다 (1~2분)… / First run: installing packages (1–2 min)…"
fi
npm install --no-audit --no-fund || {
  echo "설치에 실패했습니다 / install failed"
  read -n 1 -s -r -p "아무 키나 누르면 닫힙니다 / press any key to close"
  exit 1
}

echo
echo "앱을 켭니다. 브라우저가 자동으로 열립니다 (안 열리면 http://localhost:5173/ 로 접속)."
echo "Starting the app; the browser opens automatically (or go to http://localhost:5173/)."
echo "이 창을 닫으면 앱이 꺼집니다. / Closing this window stops the app."
echo
npm start
