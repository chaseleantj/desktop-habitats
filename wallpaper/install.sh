#!/bin/sh
# Build the wallpaper agent, install it in ~/Applications with its own copy of the
# aquarium, and start it now and at every login.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
project=$(dirname "$here")
label=com.chaselean.aquarium-wallpaper
app="$HOME/Applications/Aquarium Wallpaper.app"
agent="$HOME/Library/LaunchAgents/$label.plist"
domain="gui/$(id -u)"

build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT
swiftc -O -target arm64-apple-macos13.0 -o "$build/AquariumWallpaper" \
	"$here/Wallpaper.swift" -framework Cocoa -framework WebKit -framework IOKit

launchctl bootout "$domain/$label" 2>/dev/null || true

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources/scene/assets"
cp "$build/AquariumWallpaper" "$app/Contents/MacOS/AquariumWallpaper"
cp "$here/Info.plist" "$app/Contents/Info.plist"
cp "$project/wallpaper.html" "$project/style.css" "$app/Contents/Resources/scene/"
cp -R "$project/src" "$project/vendor" "$app/Contents/Resources/scene/"
# Only the surface maps the scene loads; the supplied reference picture stays behind.
cp "$project"/assets/*_diff.jpg "$project"/assets/*_nor_gl.jpg \
	"$app/Contents/Resources/scene/assets/"
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
		<string>$app/Contents/MacOS/AquariumWallpaper</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>ProcessType</key>
	<string>Interactive</string>
	<key>StandardErrorPath</key>
	<string>/tmp/aquarium-wallpaper.log</string>
</dict>
</plist>
PLIST

launchctl bootstrap "$domain" "$agent"
launchctl kickstart -k "$domain/$label"

# The desktop picture behind the live layer: what login, Mission Control and Stage Manager
# show before the scene is drawing. It is a frame of the scene itself.
still="$HOME/Pictures/Aquarium Wallpaper.png"
sleep 8
if pid=$(pgrep -f "Aquarium Wallpaper.app/Contents/MacOS/AquariumWallpaper"); then
	kill -USR1 "$pid" && sleep 7
	if [ -s /tmp/aquarium-wallpaper.png ]; then
		cp /tmp/aquarium-wallpaper.png "$still"
		osascript -e "tell application \"System Events\" to tell every desktop to set picture to \"$still\"" >/dev/null 2>&1 ||
			echo "Could not set the still picture; the live layer covers it anyway."
	fi
fi

echo "Aquarium wallpaper installed: $app"
