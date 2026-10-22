import copy
import json
import os
import re
import uuid

import decky

SETTINGS_FILE = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")

RETROARCH = '"/usr/bin/flatpak" run org.libretro.RetroArch'


def _retroarch(profile_id: str, name: str, types: list, core: str) -> dict:
    return {
        "id": profile_id,
        "name": name,
        "fileTypes": types,
        "target": RETROARCH,
        "launchOptions": f'-L /{core} "<rom_path>"',
    }


# Start In is not stored: it is worked out from Target whenever a profile is applied.
DEFAULT_PROFILES = [
    _retroarch("nes", "NES", [".nes"], "mesen_libretro.so"),
    _retroarch("snes", "SNES", [".sfc"], "snes9x_libretro.so"),
    _retroarch("n64", "Nintendo 64", [".z64"], "mupen64plus_next_libretro.so"),
    _retroarch("gb-gbc", "Game Boy/Game Boy Color", [".gb", ".gbc"], "gambatte_libretro.so"),
    _retroarch("gba", "Game Boy Advance", [".gba"], "mgba_libretro.so"),
    _retroarch("nds", "Nintendo DS/DSiWare", [".nds"], "melondsds_libretro.so"),
    {
        "id": "3ds",
        "name": "Nintendo 3DS",
        "fileTypes": [".cci"],
        "target": '"/home/deck/Scripts/azahar.sh"',
        "launchOptions": '"<rom_path>"',
    },
    {
        "id": "gc-wii",
        "name": "Nintendo GameCube/Wii",
        "fileTypes": [".rvz"],
        "target": '"/usr/bin/flatpak" run org.DolphinEmu.dolphin-emu',
        "launchOptions": '-b -e "<rom_path>"',
    },
    {
        "id": "wiiu",
        "name": "Nintendo Wii U",
        "fileTypes": [".wua"],
        "target": '"/home/deck/Applications/Cemu.AppImage"',
        "launchOptions": '-f -g "<rom_path>"',
    },
    {
        "id": "switch",
        "name": "Nintendo Switch",
        "fileTypes": [".nsp", ".xci"],
        "target": '"/home/deck/Applications/Eden.AppImage"',
        "launchOptions": '-f -g "<rom_path>"',
    },
    {
        "id": "ps2",
        "name": "PlayStation 2",
        "fileTypes": [".chd"],
        "target": '"/home/deck/Applications/pcsx2-Qt.AppImage"',
        "launchOptions": '-batch -fullscreen -nogui "<rom_path>"',
    },
    {
        "id": "xbox",
        "name": "Xbox",
        "fileTypes": [".xiso.iso"],
        "target": '"/usr/bin/flatpak" run app.xemu.xemu',
        "launchOptions": '-full-screen -dvd_path "<rom_path>"',
    },
    _retroarch("cdi", "Philips CD-I", [], "same_cdi_libretro.so"),
]

DEFAULTS = {
    # --- ROM side -------------------------------------------------------
    # Where the ROM file browser always starts. Falls back to the nearest existing
    # parent folder if this one doesn't exist (e.g. SD card not inserted).
    "browserDir": "/home/deck/Emulation/roms",
    # each: {id, name, fileTypes: [".sfc", ...], target, launchOptions}
    "profiles": DEFAULT_PROFILES,
    # each: {appid, name, profileId, profileName, rom, source: "added"|"scan"}
    "romGames": [],
    # --- script side ----------------------------------------------------
    # each: {path, subdirs}  (subdirs = also look in that directory's subfolders)
    "scriptDirs": [],
    "exclusions": [],
    # each: {appid, name, script, kind: "steam"|"shortcut", source: "added"|"scan"}
    "scriptGames": [],
    # --- shared ---------------------------------------------------------
    "showGameButton": True,
}

MAX_SCRIPTS = 5000
MAX_ENTRIES = 20000


def _natural_key(text: str) -> list:
    # Alternates str / int starting with str, so keys always compare cleanly.
    return [int(t) if t.isdigit() else t.casefold() for t in re.split(r"(\d+)", text)]


def _norm_types(raw) -> list:
    """['SFC', ' .gb '] -> ['.sfc', '.gb'] (lower-case, leading dot, no duplicates)."""
    if isinstance(raw, str):
        raw = re.split(r"[\s,;]+", raw)
    out, seen = [], set()
    for t in raw or []:
        t = str(t).strip().lower()
        if not t or t == ".":
            continue
        if not t.startswith("."):
            t = "." + t
        if t not in seen:
            seen.add(t)
            out.append(t)
    return out


def _clean_profile(p) -> dict | None:
    if not isinstance(p, dict):
        return None
    name = str(p.get("name", "")).strip()
    target = str(p.get("target", "")).strip()
    if not name or not target:
        return None
    return {
        "id": str(p.get("id") or uuid.uuid4().hex[:8]),
        "name": name,
        "fileTypes": _norm_types(p.get("fileTypes")),
        "target": target,
        "launchOptions": str(p.get("launchOptions", "")).strip(),
    }


def _clean_script_game(g) -> dict | None:
    if not isinstance(g, dict) or not isinstance(g.get("appid"), int):
        return None
    if not isinstance(g.get("script"), str) or not g["script"]:
        return None
    return {
        "appid": g["appid"],
        "name": str(g.get("name", "")),
        "script": g["script"],
        "kind": "shortcut" if g.get("kind") == "shortcut" else "steam",
        "source": "scan" if g.get("source") == "scan" else "added",
    }


def _clean_rom_game(g) -> dict | None:
    if not isinstance(g, dict) or not isinstance(g.get("appid"), int):
        return None
    if not isinstance(g.get("profileId"), str) or not g["profileId"]:
        return None
    return {
        "appid": g["appid"],
        "name": str(g.get("name", "")),
        "profileId": g["profileId"],
        "profileName": str(g.get("profileName", "")),
        "rom": str(g.get("rom", "")),
        "source": "scan" if g.get("source") == "scan" else "added",
    }


def _sorted(profiles: list) -> list:
    return sorted(profiles, key=lambda p: _natural_key(p["name"]))


def _read_json(path: str) -> dict | None:
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except (FileNotFoundError, ValueError, OSError):
        return None


def _migrate() -> dict:
    """First run only: bring over settings from the standalone Script Assigner and
    ROM Manager plugins, if their settings folders are still there."""
    base = os.path.dirname(decky.DECKY_PLUGIN_SETTINGS_DIR)

    def find(names: list) -> dict | None:
        for n in names:
            d = _read_json(os.path.join(base, n, "settings.json"))
            if d is not None:
                return d
        return None

    out: dict = {}
    sa = find(["Script Assigner", "Script-Assigner"])
    rm = find(["ROM Manager", "ROM-Manager"])
    if sa:
        if isinstance(sa.get("scriptDirs"), list):
            out["scriptDirs"] = sa["scriptDirs"]
        elif sa.get("scriptDir"):  # settings from before multiple directories existed
            out["scriptDirs"] = [{"path": str(sa["scriptDir"]), "subdirs": bool(sa.get("includeSubdirs"))}]
        if isinstance(sa.get("exclusions"), list):
            out["exclusions"] = sa["exclusions"]
        if isinstance(sa.get("assignments"), list):
            out["scriptGames"] = sa["assignments"]
        if "showGameButton" in sa:
            out["showGameButton"] = sa["showGameButton"]
    if rm:
        if isinstance(rm.get("profiles"), list):
            out["profiles"] = rm["profiles"]
        if isinstance(rm.get("browserDir"), str):
            out["browserDir"] = rm["browserDir"]
        if rm.get("showGameButton") is False:
            out["showGameButton"] = False
    return out


def _load() -> dict:
    migrated = False
    if os.path.exists(SETTINGS_FILE):
        data = _read_json(SETTINGS_FILE) or {}
    else:
        data = _migrate()
        migrated = bool(data)
    merged = copy.deepcopy(DEFAULTS)
    merged.update({k: v for k, v in data.items() if k in DEFAULTS})

    merged["profiles"] = _sorted([c for c in (_clean_profile(p) for p in merged["profiles"]) if c])
    merged["scriptDirs"] = [
        {"path": d["path"], "subdirs": bool(d.get("subdirs"))}
        for d in merged["scriptDirs"]
        if isinstance(d, dict) and isinstance(d.get("path"), str) and d["path"]
    ]
    merged["exclusions"] = [str(k) for k in merged["exclusions"] if str(k).strip()]
    merged["scriptGames"] = [c for c in (_clean_script_game(g) for g in merged["scriptGames"]) if c]
    merged["romGames"] = [c for c in (_clean_rom_game(g) for g in merged["romGames"]) if c]
    if not isinstance(merged["browserDir"], str) or not merged["browserDir"]:
        merged["browserDir"] = DEFAULTS["browserDir"]
    merged["showGameButton"] = bool(merged["showGameButton"])
    if migrated:
        _save(merged)  # so the import happens only once
    return merged


def _save(data: dict) -> dict:
    data["profiles"] = _sorted(data["profiles"])
    os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)
    tmp = SETTINGS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, SETTINGS_FILE)
    return data


def _existing_dir(path: str) -> str:
    p = os.path.abspath(os.path.expanduser(path or decky.DECKY_USER_HOME))
    while p != "/" and not os.path.isdir(p):
        p = os.path.dirname(p)
    return p


def _collect_scripts(directory: str, recurse: bool) -> list:
    results = []
    if not directory or not os.path.isdir(directory):
        return results

    def add(root: str, filename: str):
        if filename.startswith(".") or not filename.lower().endswith(".sh"):
            return
        full = os.path.join(root, filename)
        if not os.path.isfile(full):
            return
        rel = os.path.relpath(root, directory)
        results.append(
            {"name": filename, "path": full, "rel": "" if rel == "." else rel, "dir": directory}
        )

    try:
        if recurse:
            for root, dirs, files in os.walk(directory):
                dirs[:] = sorted(d for d in dirs if not d.startswith("."))
                for filename in files:
                    add(root, filename)
                if len(results) >= MAX_SCRIPTS:
                    break
        else:
            for filename in os.listdir(directory):
                add(directory, filename)
    except OSError as e:
        decky.logger.error(f"Failed to list scripts in {directory}: {e}")

    results.sort(key=lambda r: (r["name"].lower(), r["path"].lower()))
    return results[:MAX_SCRIPTS]


def _upsert(items: list, new: dict) -> list:
    """Replace the entry with the same appid (keeping how it was first added), or append."""
    for i, it in enumerate(items):
        if it["appid"] == new["appid"]:
            items[i] = {**new, "source": it.get("source", new["source"])}
            return items
    items.append(new)
    return items


class Plugin:
    async def _main(self):
        # Deliberately does nothing but log: no scanning on install/load.
        decky.logger.info("Launch Editor loaded")

    async def _unload(self):
        decky.logger.info("Launch Editor unloaded")

    # ---- settings -------------------------------------------------------
    async def get_settings(self) -> dict:
        return _load()

    async def set_browser_dir(self, path: str) -> dict:
        s = _load()
        s["browserDir"] = os.path.normpath(os.path.expanduser(path))
        return _save(s)

    async def set_show_game_button(self, value: bool) -> dict:
        s = _load()
        s["showGameButton"] = bool(value)
        return _save(s)

    # ---- console profiles -----------------------------------------------
    async def save_profile(self, profile: dict) -> dict:
        """Create (no id / unknown id) or update (known id) a profile."""
        clean = _clean_profile(profile)
        if clean is None:
            raise ValueError("A profile needs a name and a target.")
        s = _load()
        s["profiles"] = [p for p in s["profiles"] if p["id"] != clean["id"]]
        s["profiles"].append(clean)
        return _save(s)

    async def delete_profile(self, profile_id: str) -> dict:
        s = _load()
        s["profiles"] = [p for p in s["profiles"] if p["id"] != profile_id]
        return _save(s)

    # ---- script directories & exclusions ---------------------------------
    async def add_directory(self, path: str) -> dict:
        s = _load()
        p = os.path.normpath(os.path.expanduser(path))
        if not any(d["path"] == p for d in s["scriptDirs"]):
            s["scriptDirs"].append({"path": p, "subdirs": False})
        return _save(s)

    async def remove_directory(self, path: str) -> dict:
        s = _load()
        s["scriptDirs"] = [d for d in s["scriptDirs"] if d["path"] != path]
        return _save(s)

    async def set_directory_subdirs(self, path: str, value: bool) -> dict:
        s = _load()
        for d in s["scriptDirs"]:
            if d["path"] == path:
                d["subdirs"] = bool(value)
        return _save(s)

    async def set_exclusions(self, exclusions: list) -> dict:
        s = _load()
        cleaned, seen = [], set()
        for k in exclusions:
            k = str(k).strip()
            if k and k.lower() not in seen:
                seen.add(k.lower())
                cleaned.append(k)
        s["exclusions"] = cleaned
        return _save(s)

    # ---- filesystem -----------------------------------------------------
    async def list_dir(self, path: str) -> dict:
        p = _existing_dir(path)
        dirs, files = [], []
        try:
            with os.scandir(p) as it:
                for e in it:
                    if e.name.startswith("."):
                        continue
                    try:
                        if e.is_dir():
                            dirs.append(e.name)
                        elif e.is_file():
                            files.append(e.name)
                    except OSError:
                        continue
        except OSError as err:
            decky.logger.error(f"Failed to list {p}: {err}")
        dirs.sort(key=_natural_key)
        files.sort(key=_natural_key)
        return {
            "path": p,
            "parent": None if p == "/" else os.path.dirname(p),
            "dirs": dirs[:MAX_ENTRIES],
            "files": files[:MAX_ENTRIES],
        }

    async def list_scripts(self) -> list:
        s = _load()
        seen, results = set(), []
        for d in s["scriptDirs"]:
            for r in _collect_scripts(d["path"], d["subdirs"]):
                if r["path"] in seen:  # overlapping directories
                    continue
                seen.add(r["path"])
                results.append(r)
        results.sort(key=lambda r: (r["name"].lower(), r["path"].lower()))
        return results[:MAX_SCRIPTS]

    # ---- the games lists --------------------------------------------------
    # A game is in at most one list: setting it in one takes it out of the other.
    async def set_script_game(self, appid: int, name: str, script: str, kind: str, source: str) -> dict:
        s = _load()
        s["romGames"] = [g for g in s["romGames"] if g["appid"] != appid]
        s["scriptGames"] = [g for g in s["scriptGames"] if g["appid"] != appid]
        s["scriptGames"].append(
            {"appid": appid, "name": name, "script": script, "kind": kind, "source": source}
        )
        return _save(s)

    async def set_rom_game(
        self, appid: int, name: str, profile_id: str, profile_name: str, rom: str, source: str
    ) -> dict:
        s = _load()
        s["scriptGames"] = [g for g in s["scriptGames"] if g["appid"] != appid]
        s["romGames"] = [g for g in s["romGames"] if g["appid"] != appid]
        s["romGames"].append(
            {
                "appid": appid,
                "name": name,
                "profileId": profile_id,
                "profileName": profile_name,
                "rom": rom,
                "source": source,
            }
        )
        return _save(s)

    async def remove_game(self, appid: int) -> dict:
        s = _load()
        s["romGames"] = [g for g in s["romGames"] if g["appid"] != appid]
        s["scriptGames"] = [g for g in s["scriptGames"] if g["appid"] != appid]
        return _save(s)

    async def apply_scan(self, rom_add: list, rom_remove: list, script_add: list, script_remove: list) -> dict:
        """Apply the result of a library scan in one go. Removals first, then
        additions/updates (an updated entry keeps how it was first added)."""
        s = _load()
        drop_rom, drop_script = set(rom_remove), set(script_remove)
        s["romGames"] = [g for g in s["romGames"] if g["appid"] not in drop_rom]
        s["scriptGames"] = [g for g in s["scriptGames"] if g["appid"] not in drop_script]
        for raw in rom_add:
            g = _clean_rom_game(raw)
            if g:
                s["scriptGames"] = [x for x in s["scriptGames"] if x["appid"] != g["appid"]]
                _upsert(s["romGames"], g)
        for raw in script_add:
            g = _clean_script_game(raw)
            if g:
                s["romGames"] = [x for x in s["romGames"] if x["appid"] != g["appid"]]
                _upsert(s["scriptGames"], g)
        return _save(s)
