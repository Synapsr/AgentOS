import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Device } from "@agentos/protocol";
import { useAppState, useStore, useT } from "../client/hooks";
import { engineName, LANGUAGES } from "../i18n";
import { canGoBack, navigate } from "../route";
import { AutonomyChoice } from "../ui/AutonomyChoice";
import { Icon, Mark, type IconName } from "../ui/Icon";
import { CLAUDE_KEYS, ownAccountNote } from "../ui/agent";
import { Permissions } from "../ui/Permissions";
import { choreographies, useSurface } from "../ui/surface";
import "./Settings.css";

const KEY_STATES = { "api-key": "keySaved", environment: "keyAccount", none: "keyMissing" } as const;
/** How often the relay's state is read again while it is not connected. */
const RELAY_RECHECK = 2000;
/** How long a toast stays: longer when it says what went wrong. */
const TOAST = { saved: 2400, saveFailed: 4000 } as const;

/** The pages of Settings: one short main page, and what its rows open. */
type Page = "main" | "autonomy" | "voice" | "brain" | "advanced";

/** Saves something, and says so with a toast. */
type Save = (work: () => Promise<unknown>) => Promise<void>;

/** One short page; everything technical one row away, in Advanced. Every change is saved as it is made. */
export function Settings() {
  useSurface("utility");
  const store = useStore();
  const t = useT();
  const node = useAppState((state) => state.node);
  const settings = useAppState((state) => state.settings);
  const [page, setPage] = useState<Page>("main");
  const [toast, setToast] = useState<{ text: keyof typeof TOAST; id: number } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST[toast.text]);
    return () => clearTimeout(timer);
  }, [toast]);

  // The computer connects to its relay in its own time: watch until it has.
  const awaitingRelay = Boolean(settings?.network.relayUrl) && !settings?.network.relayConnected;
  useEffect(() => {
    if (!awaitingRelay) return;
    const timer = setInterval(() => void store.refreshSettings().catch(() => {}), RELAY_RECHECK);
    return () => clearInterval(timer);
  }, [store, awaitingRelay]);

  // A page opened from the main one starts at its top.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [page]);

  if (!node || !settings) return null;

  const save: Save = (work) =>
    work().then(
      () => setToast({ text: "saved", id: Date.now() }),
      () => setToast({ text: "saveFailed", id: Date.now() }),
    );
  const back = () => (page !== "main" ? setPage("main") : history.back());
  const title = { main: t("settings"), autonomy: t("howMuchAsks"), voice: t("voice"), brain: t("brain"), advanced: t("advanced") }[page];

  return (
    <main className="settings">
      <header className="settings-head">
        {(page !== "main" || canGoBack()) && (
          <button className="icon-button" aria-label={t("back")} onClick={back}>
            <Icon name="back" />
          </button>
        )}
        <h1 className="type-title-l">{title}</h1>
      </header>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={page} className="settings-page" variants={choreographies.stagger} initial="hidden" animate="shown" exit="gone">
          {page === "main" && <Main save={save} open={setPage} />}
          {page === "autonomy" && (
            <Group bare>
              <AutonomyChoice value={node.autonomy} onChange={(autonomy) => void save(() => store.updateNode({ autonomy }))} autoFocus />
            </Group>
          )}
          {page === "voice" && <Voice save={save} open={setPage} />}
          {page === "brain" && <Brain save={save} open={setPage} />}
          {page === "advanced" && <Advanced save={save} />}
        </motion.div>
      </AnimatePresence>

      <div className="toasts">
        <AnimatePresence>
          {toast && (
            <motion.p key={toast.id} className="toast" role="status" variants={choreographies.chunk} initial="hidden" animate="shown" exit="gone">
              <span data-tone={toast.text === "saved" ? "go" : "careful"}>
                <Icon name={toast.text === "saved" ? "check" : "alert"} />
              </span>
              {t(toast.text)}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}

/** The main page: names, how the agent works, devices, what it may use, and Advanced. */
function Main({ save, open }: { save: Save; open: (page: Page) => void }) {
  const store = useStore();
  const t = useT();
  const node = useAppState((state) => state.node)!;
  const settings = useAppState((state) => state.settings)!;
  const languages: Record<string, string> = { ...LANGUAGES };
  languages[node.language] ??= node.language;
  const voice = settings.voice.available.find((provider) => provider.id === settings.voice.provider);
  const account = ownAccountNote(t, settings.engine, node.autonomy);
  const engine = engineName(settings.engine.provider);
  const brain = !settings.engine.ready ? "brainMissing" : settings.engine.auth === "environment" ? "brainAccount" : "brainReady";

  return (
    <>
      <Group title={t("you")}>
        <TextRow icon="person" label={t("yourName")} value={node.owner.name} maxLength={80} onSave={(ownerName) => save(() => store.updateNode({ ownerName }))} />
        <TextRow
          icon={<Mark />}
          label={t("agentName")}
          value={node.agent.name}
          maxLength={40}
          onSave={(agentName) => save(() => store.updateNode({ agentName }))}
        />
        <label className="row">
          <Tile icon="globe" />
          <span className="row-title">{t("language")}</span>
          <span className="row-value row-select">
            <select value={node.language} onChange={(event) => void save(() => store.updateNode({ language: event.target.value }))}>
              {Object.entries(languages).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
            <Icon name="chevronDown" dense />
          </span>
        </label>
      </Group>

      <Group title={node.agent.name} note={account}>
        <LinkRow icon="shield" label={t("howMuchAsks")} sub={t(node.autonomy)} onClick={() => open("autonomy")} />
        <LinkRow icon="voice" label={t("voice")} sub={voice?.label} onClick={() => open("voice")} />
        <LinkRow icon="brain" label={t("thinksWithEngine", { engine })} sub={t(brain)} missing={!settings.engine.ready} onClick={() => open("brain")} />
      </Group>

      <Group title={t("devices")}>
        <Devices />
      </Group>

      <Group title={t("permissions")}>
        <Permissions />
      </Group>

      <Group>
        <LinkRow icon="settings" label={t("advanced")} sub={t("advancedHelp")} onClick={() => open("advanced")} />
      </Group>
    </>
  );
}

/** Which voice the agent speaks with. Keys and addresses live in Advanced. */
function Voice({ save, open }: { save: Save; open: (page: Page) => void }) {
  const store = useStore();
  const t = useT();
  const settings = useAppState((state) => state.settings)!;
  const voice = settings.voice.available.find((provider) => provider.id === settings.voice.provider);
  const missing = voice?.needsKey && !settings.voice.hasKey ? "voiceNeedsKey" : voice?.needsUrl && !settings.voice.url ? "voiceNeedsAddress" : null;
  return (
    <Group>
      {settings.voice.available.map((provider) => (
        <label key={provider.id} className="row pick">
          <input
            type="radio"
            name="voice"
            checked={provider.id === settings.voice.provider}
            onChange={() => void save(() => store.updateSettings({ voice: { provider: provider.id } }))}
          />
          <Tile icon="voice" />
          <span className="row-title">{provider.label}</span>
          <span className="row-check">
            <Icon name="check" />
          </span>
        </label>
      ))}
      {missing && (
        <div className="row">
          <Tile icon="alert" tone="careful" />
          <span className="row-text row-sub" data-missing>
            {t(missing)}
          </span>
          <button className="button sm secondary" onClick={() => open("advanced")}>
            {t("advanced")}
          </button>
        </div>
      )}
    </Group>
  );
}

/** The brain, in plain words: is it ready, its key, where to get one. The model and the rest are in Advanced. */
function Brain({ save, open }: { save: Save; open: (page: Page) => void }) {
  const store = useStore();
  const t = useT();
  const node = useAppState((state) => state.node)!;
  const settings = useAppState((state) => state.settings)!;
  const engine = engineName(settings.engine.provider);
  const status = !settings.engine.ready ? "brainMissing" : settings.engine.auth === "environment" ? "brainAccount" : "brainReady";
  return (
    <>
      <Group note={ownAccountNote(t, settings.engine, node.autonomy)}>
        <div className="row row-tall">
          <Tile icon="brain" />
          <span className="row-text">
            <span className="row-title">{t("thinksWithEngine", { engine })}</span>
            <span className="row-sub" data-missing={!settings.engine.ready || undefined}>
              {t(status)}
            </span>
          </span>
        </div>
        {/* A brain that is ready without a key (the practice engine) has none to show. */}
        {(settings.engine.auth !== "none" || !settings.engine.ready) && (
          <WriteOnlyRow
            icon="key"
            label={t("key")}
            note={t(KEY_STATES[settings.engine.auth])}
            missing={settings.engine.auth === "none"}
            placeholder={t("keyReplace")}
            secret
            removable={settings.engine.auth === "api-key"}
            onSave={(apiKey) => save(() => store.updateSettings({ engine: { apiKey } }))}
          />
        )}
        {settings.engine.provider === "claude" && (
          <a className="row row-link" href={CLAUDE_KEYS} target="_blank" rel="noreferrer">
            <Tile icon="plus" />
            <span className="row-title">{t("getKey")}</span>
            <Icon name="chevron" dense />
          </a>
        )}
      </Group>
      <Group>
        <LinkRow icon="settings" label={t("advanced")} sub={t("advancedHelp")} onClick={() => open("advanced")} />
      </Group>
    </>
  );
}

/** Everything technical: the brain's model and workspace, the voice's key, the addresses, the relay. */
function Advanced({ save }: { save: Save }) {
  const store = useStore();
  const t = useT();
  const node = useAppState((state) => state.node)!;
  const settings = useAppState((state) => state.settings)!;
  const voice = settings.voice.available.find((provider) => provider.id === settings.voice.provider);
  const account = ownAccountNote(t, settings.engine, node.autonomy);

  return (
    <>
      <Group title={t("brain")} note={account}>
        <div className="row">
          <Tile icon="brain" />
          <span className="row-title">{t("thinksWith")}</span>
          <span className="row-value">{engineName(settings.engine.provider)}</span>
        </div>
        <TextRow
          icon="settings"
          label={t("model")}
          value={settings.engine.model ?? ""}
          placeholder={t("modelDefault")}
          optional
          onSave={(model) => save(() => store.updateSettings({ engine: { model: model || null } }))}
        />
        {/* A workspace goes with a key; the key itself is on the Brain page. */}
        {(settings.engine.auth !== "none" || !settings.engine.ready) && settings.engine.auth !== "environment" && (
          <WriteOnlyRow
            icon="person"
            label={t("workspaceId")}
            note={settings.engine.hasWorkspaceId ? t("saved") : t("workspaceHelp")}
            placeholder={t("workspacePlaceholder")}
            removable={settings.engine.hasWorkspaceId}
            onSave={(workspaceId) => save(() => store.updateSettings({ engine: { workspaceId } }))}
          />
        )}
      </Group>

      {(voice?.needsKey || voice?.needsUrl) && (
        <Group title={`${t("voice")} · ${voice.label}`}>
          {voice.needsKey && (
            <>
              <WriteOnlyRow
                icon="key"
                label={t("key")}
                note={t(settings.voice.hasKey ? "keySaved" : "keyMissing")}
                missing={!settings.voice.hasKey}
                placeholder={t("keyReplace")}
                secret
                removable={settings.voice.hasKey}
                onSave={(apiKey) => save(() => store.updateSettings({ voice: { apiKey } }))}
              />
              <TextRow
                icon="voice"
                label={t("voiceWhich")}
                value={settings.voice.voice ?? ""}
                placeholder={t("modelDefault")}
                optional
                onSave={(name) => save(() => store.updateSettings({ voice: { voice: name || null } }))}
              />
            </>
          )}
          {voice.needsUrl && (
            <TextRow
              icon="globe"
              label={t("voiceAddress")}
              value={settings.voice.url ?? ""}
              placeholder="http://…"
              optional
              code
              onSave={(url) => save(() => store.updateSettings({ voice: { url: url || null } }))}
            />
          )}
        </Group>
      )}

      <Group title={t("thisComputer")}>
        <TextRow icon="screen" label={t("computerName")} value={node.name} maxLength={80} onSave={(name) => save(() => store.updateNode({ name }))} />
        <div className="row row-tall">
          <Tile icon="globe" />
          <span className="row-title">{t("addresses")}</span>
          <span className="addresses">
            {settings.network.urls.map((url) => (
              <Address key={url} url={url} />
            ))}
          </span>
        </div>
      </Group>

      <Group title={t("reach")} note={settings.network.relayUrl ? null : t("relayHelp")}>
        <TextRow
          icon="globe"
          label={t("relayAddress")}
          value={settings.network.relayUrl ?? ""}
          placeholder="https://…"
          optional
          code
          onSave={(url) => save(() => store.updateSettings({ network: { relayUrl: url || null } }))}
        />
        {settings.network.relayUrl && (
          <>
            <WriteOnlyRow
              icon="key"
              label={t("relayToken")}
              note={settings.network.hasRelayToken ? t("saved") : t("relayTokenHelp")}
              placeholder={t("relayTokenPaste")}
              secret
              removable={settings.network.hasRelayToken}
              onSave={(relayToken) => save(() => store.updateSettings({ network: { relayToken } }))}
            />
            <p className="row row-note row-indented" data-wrong={(!settings.network.relayConnected && settings.network.relayError !== null) || undefined} role="status">
              {settings.network.relayConnected ? t("relayConnected") : (settings.network.relayError ?? t("relayWaiting"))}
            </p>
          </>
        )}
      </Group>
    </>
  );
}

/** A group of rows on a raised surface, with an optional header above and a sentence below. `bare` holds cards of their own. */
function Group({ title, note, bare, children }: { title?: string; note?: string | null; bare?: boolean; children: ReactNode }) {
  return (
    <motion.section className="settings-group" variants={choreographies.chunk}>
      {title && <h2 className="settings-group-title">{title}</h2>}
      {bare ? children : <div className="group">{children}</div>}
      {note && <p className="settings-group-note">{note}</p>}
    </motion.section>
  );
}

/** The 32 px square behind a row's icon. */
function Tile({ icon, tone }: { icon: IconName | ReactNode; tone?: "careful" }) {
  return (
    <span className="tile" data-tone={tone}>
      {typeof icon === "string" ? <Icon name={icon as IconName} /> : icon}
    </span>
  );
}

/** A row that opens a page: its icon, its title, what it is set to, a chevron. */
function LinkRow({ icon, label, sub, missing, onClick }: { icon: IconName; label: string; sub?: string; missing?: boolean; onClick: () => void }) {
  return (
    <button className="row row-link" data-tall={sub ? true : undefined} onClick={onClick}>
      <Tile icon={icon} />
      <span className="row-text">
        <span className="row-title">{label}</span>
        {sub && (
          <span className="row-sub" data-missing={missing || undefined}>
            {sub}
          </span>
        )}
      </span>
      <Icon name="chevron" dense />
    </button>
  );
}

interface TextRowProps {
  icon?: IconName | ReactNode;
  label: string;
  value: string;
  placeholder?: string;
  maxLength?: number;
  /** Whether an empty value may be saved. */
  optional?: boolean;
  /** An address or a model name: set in the code font. */
  code?: boolean;
  onSave: (value: string) => void;
}

/** A value edited in place: it reads as the row's value until it is touched; saved on Enter or when left. */
function TextRow({ icon, label, value, placeholder, maxLength, optional, code, onSave }: TextRowProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const next = draft.trim();
    if (next === value) return;
    if (next || optional) onSave(next);
    else setDraft(value);
  };
  return (
    <label className="row">
      {icon && <Tile icon={icon} />}
      <span className="row-title">{label}</span>
      <input
        className="row-input"
        data-code={code || undefined}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete="off"
        spellCheck={false}
      />
    </label>
  );
}

interface WriteOnlyRowProps {
  icon: IconName;
  label: string;
  /** What is known about the value, since the value itself never comes back. */
  note: string;
  /** The note reports something missing that the agent needs. */
  missing?: boolean;
  placeholder: string;
  /** Hide what is typed. */
  secret?: boolean;
  removable: boolean;
  /** An empty string removes the stored value. */
  onSave: (value: string) => void;
}

/** A value the computer keeps to itself (a key, a workspace id): whether there is one, and a place to paste another. */
function WriteOnlyRow({ icon, label, note, missing, placeholder, secret, removable, onSave }: WriteOnlyRowProps) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const commit = () => {
    if (draft.trim()) onSave(draft.trim());
    setDraft("");
  };
  return (
    <div className="row row-tall row-write">
      <Tile icon={icon} />
      <span className="row-text">
        <span className="row-title">{label}</span>
        <span className="row-sub" data-missing={missing || undefined}>
          {note}
        </span>
      </span>
      <span className="row-edit">
        <input
          className="field"
          type={secret ? "password" : "text"}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
          placeholder={placeholder}
          aria-label={`${label}: ${placeholder}`}
          autoComplete="off"
          spellCheck={false}
        />
        {removable && (
          <button className="button sm quiet" onClick={() => onSave("")}>
            {t("remove")}
          </button>
        )}
      </span>
    </div>
  );
}

const DEVICE_ICONS: Record<Device["platform"], IconName> = {
  ios: "phone",
  android: "phone",
  watchos: "watch",
  web: "globe",
  desktop: "screen",
  cli: "screen",
  node: "screen",
};

/** The phones, watches and browsers that may talk to this computer. Removing one asks once, in place. */
function Devices() {
  const { client } = useStore();
  const t = useT();
  const language = useAppState((state) => state.node?.language ?? "en");
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const reload = useCallback(() => client.devices().then(setDevices, () => {}), [client]);
  useEffect(() => void reload(), [reload]);

  const remove = async (device: Device) => {
    setConfirming(null);
    await client.removeDevice(device.id).then(setDevices, () => {});
  };

  return (
    <>
      {devices?.length === 0 && <p className="row row-note">{t("noDevices")}</p>}
      {devices?.map((device) => (
        <div key={device.id} className="row row-tall">
          <Tile icon={DEVICE_ICONS[device.platform]} />
          <span className="row-text">
            <span className="row-title">{device.name}</span>
            <span className="row-sub">{seen(t, language, device.lastSeenAt)}</span>
          </span>
          {confirming === device.id ? (
            <span className="row-confirm">
              <button className="button sm quiet" autoFocus onClick={() => setConfirming(null)}>
                {t("keep")}
              </button>
              <button className="button sm careful" onClick={() => void remove(device)}>
                {t("remove")}
              </button>
            </span>
          ) : (
            <button className="button sm quiet" onClick={() => setConfirming(device.id)}>
              {t("remove")}
            </button>
          )}
        </div>
      ))}
      <button className="row row-link" onClick={() => navigate("add-phone")}>
        <Tile icon="plus" />
        <span className="row-title">{t("phoneTitle")}</span>
      </button>
    </>
  );
}

/** "Seen 5 minutes ago", in the agent's language. */
function seen(t: ReturnType<typeof useT>, language: string, at: number | null): string {
  if (at === null) return t("neverSeen");
  const minutes = Math.round((at - Date.now()) / 60_000);
  if (minutes > -2) return t("activeNow");
  const format = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  const when =
    minutes > -60 ? format.format(minutes, "minute") : minutes > -60 * 24 ? format.format(Math.round(minutes / 60), "hour") : format.format(Math.round(minutes / 60 / 24), "day");
  return t("lastSeen", { when });
}

/** An address a client can reach this computer at. Press to copy. */
function Address({ url }: { url: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  const copy = async () => {
    await navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button className="address" onClick={() => void copy()} aria-label={`${t("copy")} ${url}`}>
      <span className="swap">
        <Icon name="copy" dense off={copied} />
        <Icon name="check" dense off={!copied} />
      </span>
      {copied ? t("copied") : url.replace(/^https?:\/\//, "")}
    </button>
  );
}
