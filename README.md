# Decky Launch Editor
A Decky Loader plugin that can assign launch paths/arguments to games according to configured profiles, or assign shell script file paths.

Combines my previous ROM Manager and Script Assigner plugins as they are both plugins which edit launch options.

## Features
- Configure "console profiles" with different launch options and arguments
- Add a new non-Steam game and automatically apply a profile's launch options/arguments to it
- Add optional file types to profiles to instantly apply a profile when a matching file type is chosen for a game
- Includes 13 pre-configured profiles for several emulated consoles (Most are standard, but the 3DS one uses my own niche configuration)
- Add a shell script's path to a game's launch options
- Define one or more directories to search for shell scripts in, including the per-directory option to toggle subdirectories
- Includes the option to add a shortcut button to game pages (next to the Steam Input button) that quickly lets you assign ROM launch paths/arguments, a script path, or clear existing launch options
- Scan the library for games with matching ROM profile and shell script paths, and clear them from the dropdown list if desired
- Exclude specific shell script-bound games via `.sh` filename keywords/patterns

## Building
```
npm install
npm run build
```

## AI Disclosure
All programming was done using Claude. Testing, documentation, and any other writing is all done by me.
