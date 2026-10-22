import { callable } from "@decky/api";
import type { DirListing, GameKind, Profile, ScriptFile, Settings, Source } from "./types";

export const getSettings = callable<[], Settings>("get_settings");
export const setBrowserDir = callable<[path: string], Settings>("set_browser_dir");
export const setShowGameButton = callable<[value: boolean], Settings>("set_show_game_button");

export const saveProfile = callable<[profile: Partial<Profile>], Settings>("save_profile");
export const deleteProfile = callable<[profileId: string], Settings>("delete_profile");

export const addDirectory = callable<[path: string], Settings>("add_directory");
export const removeDirectory = callable<[path: string], Settings>("remove_directory");
export const setDirectorySubdirs = callable<[path: string, value: boolean], Settings>("set_directory_subdirs");
export const setExclusions = callable<[exclusions: string[]], Settings>("set_exclusions");

export const listDir = callable<[path: string], DirListing>("list_dir");
export const listScripts = callable<[], ScriptFile[]>("list_scripts");

export const setScriptGame = callable<
  [appid: number, name: string, script: string, kind: GameKind, source: Source],
  Settings
>("set_script_game");
export const setRomGame = callable<
  [appid: number, name: string, profileId: string, profileName: string, rom: string, source: Source],
  Settings
>("set_rom_game");
export const removeGame = callable<[appid: number], Settings>("remove_game");
export const applyScan = callable<
  [romAdd: unknown[], romRemove: number[], scriptAdd: unknown[], scriptRemove: number[]],
  Settings
>("apply_scan");
