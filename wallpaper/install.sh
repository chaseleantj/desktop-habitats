#!/bin/sh
# Build the wallpaper agent, install it in ~/Applications with its own copy of the
# aquarium, and start it now and at every login.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
project=$(dirname "$here")
label=com.chaselean.aquatica
app="$HOME/Applications/Aquatica.app"
agent="$HOME/Library/LaunchAgents/$label.plist"
domain="gui/$(id -u)"

if ! command -v swiftc >/dev/null; then
	echo "swiftc is missing. Install the Xcode command line tools: xcode-select --install" >&2
	exit 1
fi

build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT
# Built for this machine's own architecture; the binary never leaves it.
swiftc -O -target "$(uname -m)-apple-macos13.0" -o "$build/Aquatica" \
	"$here/Wallpaper.swift" -framework Cocoa -framework WebKit -framework IOKit

launchctl bootout "$domain/$label" 2>/dev/null || true

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources/scene"
cp "$build/Aquatica" "$app/Contents/MacOS/Aquatica"
cp "$here/Info.plist" "$app/Contents/Info.plist"
cp "$project/wallpaper.html" "$project/style.css" "$app/Contents/Resources/scene/"
cp -R "$project/src" "$project/vendor" "$project/assets" "$app/Contents/Resources/scene/"
codesign --force --sign - "$app" >/dev/null 2>&1 || true

mkdir -p "$(dirname "$agent")"
cat >"$agent" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>$label</string>
	<key>ProgramArguments</key>
	<array>
		<string>$app/Contents/MacOS/Aquatica</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<dict>
		<key>SuccessfulExit</key>
		<false/>
	</dict>
	<key>ProcessType</key>
	<string>Interactive</string>
	<key>StandardErrorPath</key>
	<string>/tmp/aquatica.log</string>
</dict>
</plist>
PLIST

launchctl bootstrap "$domain" "$agent"
launchctl kickstart -k "$domain/$label"

# The desktop picture behind the live layer: what login, Mission Control and Stage Manager
# show before the scene is drawing. It is a frame of the scene itself.
still="$HOME/Pictures/Aquatica.png"
mkdir -p "$HOME/Pictures"
echo "Waiting for the first frame, then setting the still picture."
sleep 8
if pid=$(pgrep -n -f "Aquatica.app/Contents/MacOS/Aquatica"); then
	kill -USR1 "$pid" && sleep 7
	if [ -s /tmp/aquatica.png ]; then
		cp /tmp/aquatica.png "$still"
		osascript -e "tell application \"System Events\" to tell every desktop to set picture to \"$still\"" >/dev/null 2>&1 ||
			echo "Could not set the still picture; the live layer covers it anyway."
	fi
fi

echo "Aquatica installed: $app"
