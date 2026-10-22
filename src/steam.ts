import type { Game, Profile } from "./types";

const w = window as any;

export const APP_TYPE_SHORTCUT = 1073741824; // non-Steam shortcut
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const basename = (p: string) => p.split("/").filter(Boolean).pop() ?? p;
export const dirname = (p: string) => p.substring(0, p.lastIndexOf("/"));

function toArray(raw: any): any[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (raw instanceof Map) return Array.from(raw.values());
  if (typeof raw.values === "function") return Array.from(raw.values());
  try {
    return Array.from(raw);
  } catch {
    return [];
  }
}

export function liveName(appid: number): string | undefined {
  try {
    return w.appStore?.GetAppOverviewByAppID?.(appid)?.display_name || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Installed Steam games and non-Steam shortcuts, alphabetical. Installed games
 * and Deck desktop apps come from their own collections; non-Steam shortcuts
 * are also pulled from the full library by app type, in case this Steam build
 * doesn't list them as "local". If nothing turns up, fall back to the whole
 * library rather than showing an empty list.
 */
export function getInstalledGames(): Game[] {
  const seen = new Map<number, { name: string; shortcut: boolean }>();
  const add = (app: any) => {
    if (app?.appid && !seen.has(app.appid)) {
      seen.set(app.appid, {
        name: app.display_name ?? `App ${app.appid}`,
        shortcut: app.app_type === APP_TYPE_SHORTCUT,
      });
    }
  };
  for (const collection of [w.collectionStore?.localGamesCollection, w.collectionStore?.deckDesktopApps]) {
    for (const app of toArray(collection?.allApps)) add(app);
  }
  for (const app of toArray(w.collectionStore?.allAppsCollection?.allApps)) {
    if (app?.app_type === APP_TYPE_SHORTCUT) add(app);
  }
  if (!seen.size) {
    for (const app of toArray(w.collectionStore?.allAppsCollection?.allApps)) add(app);
  }
  return [...seen]
    .map(([appid, v]) => ({ appid, name: v.name, kind: (v.shortcut ? "shortcut" : "steam") as Game["kind"] }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** Build a Game from an appid (used by the game-page button). */
export function getGameByAppId(appid: number): Game | null {
  try {
    const o = w.appStore?.GetAppOverviewByAppID?.(appid);
    if (!o) return null;
    return {
      appid,
      name: o.display_name || `App ${appid}`,
      kind: o.app_type === APP_TYPE_SHORTCUT ? "shortcut" : "steam",
    };
  } catch {
    return null;
  }
}

/** Fetch an app's details (launch options, shortcut target, ...). */
export function getAppDetails(appid: number, timeoutMs = 2500): Promise<any | null> {
  return new Promise((resolve) => {
    try {
      const cached = w.appDetailsStore?.GetAppDetails?.(appid);
      if (cached) return resolve(cached);
    } catch {
      /* fall through to registration */
    }
    let done = false;
    let reg: any;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (d: any) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        reg?.unregister?.();
      } catch {
        /* ignore */
      }
      resolve(d);
    };
    timer = setTimeout(() => finish(null), timeoutMs);
    try {
      reg = w.SteamClient.Apps.RegisterForAppDetails(appid, (d: any) => finish(d));
      if (done) reg?.unregister?.(); // callback fired synchronously
    } catch {
      finish(null);
    }
  });
}

/**
 * True if `d` looks like fully loaded app details. A missing/partial object
 * must not be read as "this game has no launch options", or a slow Steam
 * response could make a scan treat a game as having lost them.
 */
export function detailsUsable(kind: Game["kind"], d: any): boolean {
  if (!d || typeof d !== "object") return false;
  return kind === "steam"
    ? typeof d.strLaunchOptions === "string"
    : [d.strShortcutExe, d.strShortcutLaunchOptions, d.strLaunchOptions].some((v) => typeof v === "string");
}

/** Run `fn` over `items` with at most `limit` in flight at once. */
export async function forEachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      await fn(items[next++]);
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
}

/* ------------------------------------------------------------------ */
/* ROM profiles: Start In and Launch Options                           */
/* ------------------------------------------------------------------ */

/** The executable inside a Target string: `"/usr/bin/flatpak" run x` -> /usr/bin/flatpak */
function exeOf(target: string): string {
  const t = target.trim();
  const q = t[0];
  if (q === '"' || q === "'") {
    const end = t.indexOf(q, 1);
    return end > 0 ? t.slice(1, end) : t.slice(1);
  }
  return t.split(/\s+/)[0] ?? "";
}

/** Start In is always the folder holding the Target's executable, with a trailing slash. */
export function deriveStartIn(target: string): string {
  const exe = exeOf(target);
  const i = exe.lastIndexOf("/");
  if (i < 0) return "";
  return i === 0 ? "/" : `${exe.slice(0, i)}/`;
}

const ROM_TOKEN = "<rom_path>";
const SAFE_BARE = /^[A-Za-z0-9_\-.,/:@%+=]+$/;

/**
 * Fill `<rom_path>` in a launch-options template. The path is escaped for the
 * quoting around the token, so `"<rom_path>"` stays safe for names containing
 * quotes, `$`, backticks or backslashes.
 */
export function buildLaunchOptions(template: string, romPath: string): string {
  let out = "";
  let quote: "" | '"' | "'" = "";
  for (let i = 0; i < template.length; ) {
    if (template.startsWith(ROM_TOKEN, i)) {
      if (quote === '"') out += romPath.replace(/([\\"$`])/g, "\\$1");
      else if (quote === "'") out += romPath.replace(/'/g, "'\\''");
      else out += SAFE_BARE.test(romPath) ? romPath : `'${romPath.replace(/'/g, "'\\''")}'`;
      i += ROM_TOKEN.length;
      continue;
    }
    const ch = template[i];
    if (ch === "\\" && quote !== "'" && i + 1 < template.length) {
      out += ch + template[i + 1];
      i += 2;
      continue;
    }
    if (ch === '"' && quote !== "'") quote = quote === '"' ? "" : '"';
    else if (ch === "'" && quote !== '"') quote = quote === "'" ? "" : "'";
    out += ch;
    i++;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Writing launch fields                                               */
/* ------------------------------------------------------------------ */

/** Non-Steam shortcut: clear Target / Start In / Launch Options, then fill them from the profile. */
export async function applyProfile(game: Game, profile: Profile, romPath: string) {
  const A = w.SteamClient.Apps;
  A.SetShortcutExe(game.appid, "");
  A.SetShortcutStartDir(game.appid, "");
  A.SetShortcutLaunchOptions(game.appid, "");
  await sleep(100);
  A.SetShortcutExe(game.appid, profile.target);
  A.SetShortcutStartDir(game.appid, deriveStartIn(profile.target));
  A.SetShortcutLaunchOptions(game.appid, buildLaunchOptions(profile.launchOptions, romPath));
}

/**
 * Create a new non-Steam shortcut titled `name`. `exe` is only a starting Target
 * (the profile's); applyProfile then writes the real Target / Start In / Launch Options.
 */
export async function createShortcut(name: string, exe: string): Promise<Game> {
  const A = w.SteamClient.Apps;
  const appid = await A.AddShortcut(name, exe, deriveStartIn(exe), "");
  if (typeof appid !== "number" || appid <= 0) throw new Error(`AddShortcut returned ${String(appid)}`);
  await sleep(250); // let Steam register the new shortcut before editing it
  A.SetShortcutName(appid, name);
  return { appid, name, kind: "shortcut" };
}

/** Clear, then set, the launch fields for a script. */
export async function applyScript(game: Game, scriptPath: string) {
  const A = w.SteamClient.Apps;
  if (game.kind === "steam") {
    A.SetAppLaunchOptions(game.appid, "");
    await sleep(100);
    A.SetAppLaunchOptions(game.appid, `"${scriptPath}" %command%`);
  } else {
    A.SetShortcutExe(game.appid, "");
    A.SetShortcutStartDir(game.appid, "");
    A.SetShortcutLaunchOptions(game.appid, "");
    await sleep(100);
    A.SetShortcutExe(game.appid, `"${scriptPath}"`);
    A.SetShortcutStartDir(game.appid, `${dirname(scriptPath)}/`);
    // Launch Options stays blank
  }
}

/** Clear the launch fields for a game. */
export function clearGame(game: { appid: number; kind: Game["kind"] }) {
  const A = w.SteamClient.Apps;
  if (game.kind === "steam") {
    A.SetAppLaunchOptions(game.appid, "");
  } else {
    A.SetShortcutExe(game.appid, "");
    A.SetShortcutStartDir(game.appid, "");
    A.SetShortcutLaunchOptions(game.appid, "");
  }
}
