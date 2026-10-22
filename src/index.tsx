import { definePlugin, routerHook } from "@decky/api";
import { useEffect, useState } from "react";
import { FaChevronDown, FaChevronRight, FaTerminal } from "react-icons/fa";
import {
  addDirectory,
  applyScan,
  getSettings,
  removeDirectory,
  setBrowserDir,
  setDirectorySubdirs,
  setShowGameButton,
} from "./api";
import { confirmClear, startNewRomFlow, startRomFlow, startScriptFlow } from "./flow";
import { setGameButtonEnabled, GameButtonHost } from "./GameButton";
import {
  AddRomModal,
  DirectoryBrowserModal,
  ExclusionsModal,
  GamePickerModal,
  NewGameModal,
  ProfileEditorModal,
  subStyle,
} from "./modals";
import { describeFileTypes } from "./profiles";
import { scanLibrary } from "./scan";
import { basename, getInstalledGames, liveName } from "./steam";
import { toast } from "./toast";
import type { Profile, Settings } from "./types";
import {
  ButtonItem,
  DialogButton,
  Focusable,
  PanelSection,
  PanelSectionRow,
  ToggleField,
  showModal,
  staticClasses,
} from "./ui";

const GLOBAL_NAME = "LaunchEditorGameButton";

const ellipsis = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const };

function Chevron({ open, children }: { open: boolean; children: any }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      {open ? <FaChevronDown /> : <FaChevronRight />}
      <span>{children}</span>
    </div>
  );
}

/** One game in a games list: its name, a second line, and a Remove button. */
function GameRow({ name, sub, onRemove }: { name: string; sub: string; onRemove: () => void }) {
  return (
    <PanelSectionRow>
      <Focusable
        // @ts-ignore
        style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%" }}
        // @ts-ignore
        flow-children="row"
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={ellipsis}>{name}</div>
          <div style={{ ...subStyle, ...ellipsis, wordBreak: undefined }}>{sub}</div>
        </div>
        <DialogButton style={{ width: "auto", minWidth: 0, padding: "8px 12px", flexShrink: 0 }} onClick={onRemove}>
          Remove
        </DialogButton>
      </Focusable>
    </PanelSectionRow>
  );
}

function Content() {
  const [s, setS] = useState<Settings | null>(null);
  const [romOpen, setRomOpen] = useState(false);
  const [scriptOpen, setScriptOpen] = useState(false);
  const [profilesOpen, setProfilesOpen] = useState(false);
  // Console profile groups under "ROM Games" that are expanded (all start collapsed).
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState("");

  useEffect(() => {
    getSettings().then(setS);
  }, []);

  if (!s) return <PanelSection>Loading…</PanelSection>;

  const nameOf = (a: { appid: number; name: string }) => liveName(a.appid) ?? a.name;
  const byName = (a: { appid: number; name: string }, b: { appid: number; name: string }) =>
    nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: "base" });

  // ROM games grouped under their console profile's name.
  const profileName = (id: string, fallback: string) => s.profiles.find((p) => p.id === id)?.name ?? fallback;
  const groups = new Map<string, typeof s.romGames>();
  for (const g of s.romGames) {
    const key = profileName(g.profileId, g.profileName || "Unknown profile");
    groups.set(key, [...(groups.get(key) ?? []), g]);
  }
  const groupNames = [...groups.keys()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
  const scriptGames = [...s.scriptGames].sort(byName);
  const toggleGroup = (group: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (!next.delete(group)) next.add(group);
      return next;
    });

  /* ---- Add ROM: a new Steam game, or an existing non-Steam one --------- */
  // ROM profiles write a shortcut's Target / Start In / Launch Options, so only
  // non-Steam games can take one (the game page's action menu applies the same rule).
  const startNewRom = () =>
    showModal(<NewGameModal onSubmit={(name) => startNewRomFlow(name, setS)} />, window);

  const startExistingRom = () => {
    const games = getInstalledGames().filter((g) => g.kind === "shortcut");
    if (games.length === 0) {
      toast("No non-Steam games found.");
      return;
    }
    const currentRoms: Record<number, string> = {};
    for (const a of s.romGames) currentRoms[a.appid] = basename(a.rom);
    showModal(
      <GamePickerModal
        kind="rom"
        games={games}
        current={currentRoms}
        onPick={(game) => startRomFlow(game, setS)}
      />,
      window,
    );
  };

  const startAddRom = () => {
    if (s.profiles.length === 0) {
      toast("Add a console profile first (Console profiles, below).");
      return;
    }
    showModal(<AddRomModal onNew={startNewRom} onExisting={startExistingRom} />, window);
  };

  /* ---- Add Script (any game) ------------------------------------------ */
  const startAddScript = () => {
    if (s.scriptDirs.length === 0) {
      toast("Add a scripts directory first (Script directories, below).");
      return;
    }
    const games = getInstalledGames();
    if (games.length === 0) {
      toast("No installed games found.");
      return;
    }
    const currentScripts: Record<number, string> = {};
    for (const a of s.scriptGames) currentScripts[a.appid] = basename(a.script);
    showModal(
      <GamePickerModal
        kind="script"
        games={games}
        current={currentScripts}
        onPick={(game) => startScriptFlow(game, setS)}
      />,
      window,
    );
  };

  /* ---- Scan (never touches launch options) ----------------------------- */
  const doScan = async () => {
    setScanning(true);
    setScanMsg("Scanning…");
    try {
      const plan = await scanLibrary(s);
      if (plan.romAdd.length || plan.romRemove.length || plan.scriptAdd.length || plan.scriptRemove.length) {
        setS(await applyScan(plan.romAdd, plan.romRemove, plan.scriptAdd, plan.scriptRemove));
      }
      const parts: string[] = [];
      if (plan.added > 0) parts.push(`${plan.added} added`);
      if (plan.removed > 0) parts.push(`${plan.removed} removed`);
      setScanMsg(parts.length ? `Done — ${parts.join(", ")}` : "Done — no changes");
    } catch (e) {
      console.error("[Launch Editor] scan failed", e);
      setScanMsg("Scan failed.");
    } finally {
      setScanning(false);
    }
    setTimeout(() => setScanMsg(""), 5000);
  };

  /* ---- Settings ---------------------------------------------------------- */
  const pickRomDir = () =>
    showModal(
      <DirectoryBrowserModal
        title="ROM Starting Directory"
        startPath={s.browserDir}
        onSelect={async (p: string) => setS(await setBrowserDir(p))}
      />,
    );
  const addDir = () =>
    showModal(
      <DirectoryBrowserModal
        title="Scripts Directory"
        startPath={s.scriptDirs[s.scriptDirs.length - 1]?.path || "/home/deck"}
        onSelect={async (p: string) => setS(await addDirectory(p))}
      />,
    );
  const editExclusions = () => showModal(<ExclusionsModal initial={s.exclusions} onChange={setS} />);
  const editProfile = (profile: Profile | null) =>
    showModal(<ProfileEditorModal profile={profile} profiles={s.profiles} onChange={setS} />);

  return (
    <>
      <PanelSection title="Games">
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={startAddRom}>
            Add ROM
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={startAddScript}>
            Add Script
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={scanning} onClick={doScan}>
            {scanMsg || "Scan Library"}
          </ButtonItem>
        </PanelSectionRow>

        <PanelSectionRow>
          <ButtonItem layout="below" onClick={() => setRomOpen(!romOpen)}>
            <Chevron open={romOpen}>ROM Games ({s.romGames.length})</Chevron>
          </ButtonItem>
        </PanelSectionRow>
        {romOpen && s.romGames.length === 0 && (
          <PanelSectionRow>
            <div style={{ opacity: 0.7 }}>No ROM games yet. Use Add ROM, a game's page button, or Scan.</div>
          </PanelSectionRow>
        )}
        {romOpen &&
          groupNames.map((group) => {
            const groupOpen = openGroups.has(group);
            const groupGames = groups.get(group)!;
            return (
              <div key={group}>
                <PanelSectionRow>
                  <ButtonItem layout="below" onClick={() => toggleGroup(group)}>
                    <div style={{ paddingLeft: "14px" }}>
                      <Chevron open={groupOpen}>
                        {group} ({groupGames.length})
                      </Chevron>
                    </div>
                  </ButtonItem>
                </PanelSectionRow>
                {groupOpen &&
                  [...groupGames].sort(byName).map((g) => (
                    <GameRow
                      key={g.appid}
                      name={nameOf(g)}
                      sub={basename(g.rom)}
                      onRemove={() => confirmClear({ appid: g.appid, name: nameOf(g), kind: "shortcut" }, setS)}
                    />
                  ))}
              </div>
            );
          })}

        <PanelSectionRow>
          <ButtonItem layout="below" onClick={() => setScriptOpen(!scriptOpen)}>
            <Chevron open={scriptOpen}>Script Games ({s.scriptGames.length})</Chevron>
          </ButtonItem>
        </PanelSectionRow>
        {scriptOpen && s.scriptGames.length === 0 && (
          <PanelSectionRow>
            <div style={{ opacity: 0.7 }}>No script games yet. Use Add Script or Scan.</div>
          </PanelSectionRow>
        )}
        {scriptOpen &&
          scriptGames.map((a) => (
            <GameRow
              key={a.appid}
              name={nameOf(a)}
              sub={basename(a.script)}
              onRemove={() => confirmClear({ appid: a.appid, name: nameOf(a), kind: a.kind }, setS)}
            />
          ))}
      </PanelSection>

      <PanelSection title="Console profiles">
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={() => editProfile(null)}>
            Add Profile
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={() => setProfilesOpen(!profilesOpen)}>
            <Chevron open={profilesOpen}>Profiles ({s.profiles.length})</Chevron>
          </ButtonItem>
        </PanelSectionRow>
        {profilesOpen && s.profiles.length === 0 && (
          <PanelSectionRow>
            <div style={{ opacity: 0.7 }}>No profiles yet. Use Add Profile.</div>
          </PanelSectionRow>
        )}
        {profilesOpen &&
          s.profiles.map((p) => (
            <PanelSectionRow key={p.id}>
              <ButtonItem layout="below" onClick={() => editProfile(p)} description={describeFileTypes(p)}>
                {p.name}
              </ButtonItem>
            </PanelSectionRow>
          ))}
      </PanelSection>

      <PanelSection title="Script directories">
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={addDir}
            description={s.scriptDirs.length === 0 ? "None set" : undefined}
          >
            Add Directory
          </ButtonItem>
        </PanelSectionRow>
        {s.scriptDirs.map((d) => (
          <div key={d.path}>
            <PanelSectionRow>
              <ToggleField
                label={d.path}
                description="Include subdirectories"
                checked={d.subdirs}
                onChange={async (v: boolean) => setS(await setDirectorySubdirs(d.path, v))}
              />
            </PanelSectionRow>
            <PanelSectionRow>
              <ButtonItem layout="below" onClick={async () => setS(await removeDirectory(d.path))}>
                Remove
              </ButtonItem>
            </PanelSectionRow>
          </div>
        ))}
      </PanelSection>

      <PanelSection title="Settings">
        <PanelSectionRow>
          <ToggleField
            label="Button on game pages"
            description="Adds a button next to the Controller button to add or clear launch options"
            checked={s.showGameButton}
            onChange={async (v: boolean) => {
              setGameButtonEnabled(v);
              setS(await setShowGameButton(v));
            }}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={pickRomDir} description={s.browserDir}>
            ROM Starting Directory
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={editExclusions}
            description={s.exclusions.length > 0 ? s.exclusions.join(", ") : "Script file keywords/patterns to ignore upon scan"}
          >
            Script Exclusions
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
    </>
  );
}

export default definePlugin(() => {
  getSettings()
    .then((st) => setGameButtonEnabled(st.showGameButton !== false))
    .catch(() => {});
  routerHook.addGlobalComponent(GLOBAL_NAME, GameButtonHost);

  return {
    name: "Launch Editor",
    titleView: <div className={staticClasses.Title}>Launch Editor</div>,
    content: <Content />,
    icon: <FaTerminal />,
    onDismount() {
      routerHook.removeGlobalComponent(GLOBAL_NAME);
    },
  };
});
