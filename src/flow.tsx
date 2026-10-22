import { getSettings, listScripts, removeGame, setRomGame, setScriptGame } from "./api";
import {
  ActionMenuModal,
  ConfirmModal,
  FileBrowserModal,
  ProfilePickerModal,
  ScriptPickerModal,
} from "./modals";
import { resolveProfile } from "./profiles";
import { applyProfile, applyScript, basename, clearGame, createShortcut } from "./steam";
import { toast } from "./toast";
import type { Game, Profile, Settings } from "./types";
import { showModal } from "./ui";

/** Called with the new settings after a change, so the Decky menu can refresh if it is open. */
type OnSettings = ((s: Settings) => void) | undefined;

/* ------------------------------------------------------------------ */
/* Choose ROM file                                                      */
/* ------------------------------------------------------------------ */
async function applyRom(game: Game, profile: Profile, romPath: string, onSettings: OnSettings) {
  try {
    await applyProfile(game, profile, romPath);
    const next = await setRomGame(game.appid, game.name, profile.id, profile.name, romPath, "added");
    onSettings?.(next);
    toast(`${profile.name} profile applied to ${game.name}`);
  } catch (e) {
    console.error("[Launch Editor] apply ROM failed", e);
    toast(`Could not update ${game.name}`);
  }
}

/**
 * A ROM chosen for a game that does not exist yet: the shortcut is created only
 * now (after the ROM and profile are settled), so cancelling earlier leaves nothing behind.
 */
async function applyRomToNew(name: string, profile: Profile, romPath: string, onSettings: OnSettings) {
  let game: Game;
  try {
    game = await createShortcut(name, profile.target);
  } catch (e) {
    console.error("[Launch Editor] create shortcut failed", e);
    toast(`Could not create ${name}`);
    return;
  }
  await applyRom(game, profile, romPath, onSettings);
}

/**
 * Choose ROM file -> (profile chosen automatically by file type, or picked by
 * hand) -> `apply`. Shared by the existing-game and new-game flows.
 */
async function chooseRom(gameName: string, apply: (profile: Profile, romPath: string) => void) {
  try {
    const s = await getSettings();
    if (s.profiles.length === 0) {
      toast("Add a console profile first (Console profiles, in the Launch Editor menu).");
      return;
    }
    showModal(
      <FileBrowserModal
        startPath={s.browserDir}
        onSelect={(romPath, chooseProfile) => {
          const romName = basename(romPath);
          const res = resolveProfile(romName, s.profiles);
          // The modal's toggle forces the picker even when the file type matches a profile.
          if (res.kind === "profile" && !chooseProfile) {
            apply(res.profile, romPath);
            return;
          }
          // Several profiles share this file type: offer only those. With the toggle on, or when
          // no profile matches, offer them all.
          const shared = !chooseProfile && res.kind === "ask" && res.candidates.length > 0;
          showModal(
            <ProfilePickerModal
              gameName={gameName}
              romName={romName}
              profiles={shared ? res.candidates : s.profiles}
              conflict={shared ? res.conflict : null}
              onPick={(p) => apply(p, romPath)}
            />,
          );
        }}
      />,
    );
  } catch (e) {
    console.error("[Launch Editor] could not start ROM flow", e);
    toast("Could not open the ROM browser.");
  }
}

/** ROM for a game that already exists. */
export const startRomFlow = (game: Game, onSettings?: OnSettings) =>
  chooseRom(game.name, (profile, romPath) => applyRom(game, profile, romPath, onSettings));

/** ROM for a brand-new Steam shortcut with the given title. */
export const startNewRomFlow = (name: string, onSettings?: OnSettings) =>
  chooseRom(name, (profile, romPath) => applyRomToNew(name, profile, romPath, onSettings));

/* ------------------------------------------------------------------ */
/* Add script file                                                      */
/* ------------------------------------------------------------------ */
export async function startScriptFlow(game: Game, onSettings?: OnSettings) {
  try {
    const s = await getSettings();
    if (s.scriptDirs.length === 0) {
      toast("Add a scripts directory first (Script directories, in the Launch Editor menu).");
      return;
    }
    const scripts = await listScripts();
    // With several directories, say which one each script comes from.
    const multi = s.scriptDirs.length > 1;
    const short = (p: string) => p.replace(/^\/home\/deck(?=\/|$)/, "~");
    const where = (sc: { rel: string; dir: string }) =>
      multi ? (sc.rel ? `${short(sc.dir)}/${sc.rel}` : short(sc.dir)) : sc.rel || undefined;
    showModal(
      <ScriptPickerModal
        title="Choose Script File"
        scripts={scripts}
        where={where}
        emptyText={
          multi ? "No .sh files found in your script directories" : `No .sh files found in ${s.scriptDirs[0].path}`
        }
        onPick={async (path) => {
          try {
            await applyScript(game, path);
            const next = await setScriptGame(game.appid, game.name, path, game.kind, "added");
            onSettings?.(next);
            toast(`${basename(path)} assigned to ${game.name}`);
          } catch (e) {
            console.error("[Launch Editor] assign script failed", e);
            toast(`Could not assign a script to ${game.name}`);
          }
        }}
      />,
    );
  } catch (e) {
    console.error("[Launch Editor] could not start script flow", e);
    toast("Could not open the script list.");
  }
}

/* ------------------------------------------------------------------ */
/* Clear launch options                                                 */
/* ------------------------------------------------------------------ */
/**
 * Yes/No confirmation, then clear the game's launch fields and drop it from the
 * games lists. The one clear flow: the Remove buttons in the Decky menu and
 * "Clear launch options" on game pages both go through here.
 */
export function confirmClear(
  game: { appid: number; name: string; kind: Game["kind"] },
  onSettings?: OnSettings,
  notify = false,
) {
  showModal(
    <ConfirmModal
      title="Clear Launch Options?"
      body={
        <>
          Clear the launch options for <b>{game.name}</b>?
        </>
      }
      onConfirm={async () => {
        try {
          clearGame(game);
          // Not `onSettings?.(await removeGame(...))`: that skips the call entirely
          // (and so never updates the lists) when there is no onSettings.
          const next = await removeGame(game.appid);
          onSettings?.(next);
          if (notify) toast(`Launch options cleared for ${game.name}`);
        } catch (e) {
          console.error("[Launch Editor] clear failed", e);
          toast(`Could not clear ${game.name}`);
        }
      }}
    />,
  );
}

/* ------------------------------------------------------------------ */
/* The game page button                                                 */
/* ------------------------------------------------------------------ */
export function openLaunchMenu(game: Game) {
  showModal(
    <ActionMenuModal
      game={game}
      onRom={() => startRomFlow(game)}
      onScript={() => startScriptFlow(game)}
      onClear={() => confirmClear(game, undefined, true)}
    />,
  );
}
