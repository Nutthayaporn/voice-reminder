#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_NAME="$(basename "$PROJECT_ROOT")"
BUILD_MODE="${1:-release}"

case "$BUILD_MODE" in
  release)
    GRADLE_TASK="assembleRelease"
    APK_SOURCE="$PROJECT_ROOT/android/app/build/outputs/apk/release/app-release.apk"
    APK_NAME="$PROJECT_NAME-release.apk"
    ;;
  debug)
    GRADLE_TASK="assembleDebug"
    APK_SOURCE="$PROJECT_ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
    APK_NAME="$PROJECT_NAME-debug.apk"
    ;;
  *)
    echo "Usage: $0 [release|debug]" >&2
    exit 2
    ;;
esac

if ! command -v java >/dev/null 2>&1; then
  echo "Android build requires Java 17. Install a JDK and try again." >&2
  exit 1
fi

if [ ! -d "$PROJECT_ROOT/node_modules" ]; then
  echo "Dependencies are missing. Run 'npm install' first." >&2
  exit 1
fi

if [ ! -x "$PROJECT_ROOT/android/gradlew" ]; then
  echo "android/gradlew is missing. Run 'npx expo prebuild --platform android' first." >&2
  exit 1
fi

SDK_PATH=""
if [ -n "${ANDROID_HOME:-}" ] && [ -d "$ANDROID_HOME" ]; then
  SDK_PATH="$ANDROID_HOME"
elif [ -n "${ANDROID_SDK_ROOT:-}" ] && [ -d "$ANDROID_SDK_ROOT" ]; then
  SDK_PATH="$ANDROID_SDK_ROOT"
elif [ -d "${HOME}/Library/Android/sdk" ]; then
  SDK_PATH="${HOME}/Library/Android/sdk"
elif [ -d "${HOME}/Android/Sdk" ]; then
  SDK_PATH="${HOME}/Android/Sdk"
fi

if [ -z "$SDK_PATH" ]; then
  cat >&2 <<'EOF'
Android SDK was not found.

Install Android Studio, then install Android SDK and Android SDK Platform-Tools.
On macOS the default SDK location is:
  /Users/<your-name>/Library/Android/sdk

Then set ANDROID_HOME and add platform-tools to PATH before running this script.
EOF
  exit 1
fi

export ANDROID_HOME="$SDK_PATH"
export ANDROID_SDK_ROOT="$SDK_PATH"
export PATH="$SDK_PATH/platform-tools:$PATH"

echo "Building $PROJECT_NAME Android APK ($BUILD_MODE)..."
echo "Android SDK: $SDK_PATH"

(
  cd "$PROJECT_ROOT/android"
  ./gradlew "$GRADLE_TASK" --console=plain
)

if [ ! -f "$APK_SOURCE" ]; then
  echo "Gradle completed, but the APK was not found at: $APK_SOURCE" >&2
  exit 1
fi

OUTPUT_DIR="$PROJECT_ROOT/artifacts"
OUTPUT_PATH="$OUTPUT_DIR/$APK_NAME"
mkdir -p "$OUTPUT_DIR"
cp "$APK_SOURCE" "$OUTPUT_PATH"

echo
echo "APK ready: $OUTPUT_PATH"

if [ "$BUILD_MODE" = "debug" ]; then
  echo "Note: the debug APK requires a Metro development server."
else
  echo "Note: this release APK currently uses the project's debug signing key; use it for personal/internal testing only."
fi
