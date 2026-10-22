export type GameKind = "steam" | "shortcut";
export type Source = "added" | "scan";

export interface Profile {
  id: string;
  name: string;
  /** Lower-case, leading dot, e.g. [".gb", ".gbc"]. Empty = always ask which profile. */
  fileTypes: string[];
  target: string;
  launchOptions: string;
}

export interface ScriptGame {
  appid: number;
  name: string;
  script: string;
  kind: GameKind;
  source: Source;
}

export interface RomGame {
  appid: number;
  name: string;
  profileId: string;
  /** Name when last seen; the live profile name is used while the profile exists. */
  profileName: string;
  rom: string;
  source: Source;
}

export interface ScriptDir {
  path: string;
  subdirs: boolean;
}

export interface Settings {
  browserDir: string;
  showGameButton: boolean;
  /** Always alphabetical by name (the backend sorts them). */
  profiles: Profile[];
  romGames: RomGame[];
  scriptDirs: ScriptDir[];
  exclusions: string[];
  scriptGames: ScriptGame[];
}

export interface DirListing {
  path: string;
  parent: string | null;
  dirs: string[];
  files: string[];
}

export interface ScriptFile {
  name: string;
  path: string;
  rel: string;
  dir: string;
}

export interface Game {
  appid: number;
  name: string;
  kind: GameKind;
}
