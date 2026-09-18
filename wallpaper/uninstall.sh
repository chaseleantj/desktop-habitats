#!/bin/sh
# Stop the wallpaper agent and remove it. The desktop falls back to its still picture.
set -eu

label=com.chaselean.aquatica
agent="$HOME/Library/LaunchAgents/$label.plist"

launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
rm -f "$agent"
rm -rf "$HOME/Applications/Aquatica.app"
echo "Aquatica removed."
