import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  Notice,
  Editor,
  MarkdownFileInfo,
  moment,
  SettingDefinitionItem,
} from "obsidian";

interface FolderRoutinesSettings {
  routinesFolder: string;
  hideRoutineNumbering: boolean;
  entriesProperty: string;
  storeDateFormat: string;
  subtasksProperty: string;
  subtaskEntriesProperty: string;
}

const DEFAULT_SETTINGS: FolderRoutinesSettings = {
  routinesFolder: "Routines",
  hideRoutineNumbering: false,
  entriesProperty: "entries",
  storeDateFormat: "YYYY-MM-DD",
  subtasksProperty: "subtasks",
  subtaskEntriesProperty: "subtaskEntries",
};

const SUBTASK_SEP = "::";

type Frontmatter = Record<string, unknown>;

interface AppPluginAccess {
  internalPlugins?: {
    getPluginById?: (id: string) => unknown;
  };
  plugins?: {
    getPlugin?: (id: string) => unknown;
  };
}

interface ParsedDate {
  isValid(): boolean;
  format(format: string): string;
}

type MomentFactory = (input: string, format: string, strict: boolean) => ParsedDate;

/* Per-block registry of "apply this completion state to my UI" callbacks,
   keyed by ref (note path, or path::subtask). */
interface BlockSync {
  id: string;
  setters: Map<string, (checked: boolean) => void>;
}

/* Broadcast whenever a habit completion is written, so every rendered
  checklist stays in sync without a re-render of the whole page. */
interface RoutineChangeEvent {
  dateStr: string;
  path: string;
  subtask: string | null;
  checked: boolean;
  parentChecked: boolean;
  subtasks: string[];
  originId: string;
}

function makeRef(path: string, subtask?: string | null): string {
  return subtask != null && subtask !== "" ? path + SUBTASK_SEP + subtask : path;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nestedString(value: unknown, keys: string[]): string | null {
  let current = value;
  for (const key of keys) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return typeof current === "string" && current.length > 0 ? current : null;
}

function loadSettings(value: unknown): FolderRoutinesSettings {
  const settings = isRecord(value) ? value : {};
  const stringValue = (
    key: Exclude<keyof FolderRoutinesSettings, "hideRoutineNumbering">
  ): string => {
    const storedValue = settings[key];
    return typeof storedValue === "string" ? storedValue : DEFAULT_SETTINGS[key];
  };
  return {
    routinesFolder: stringValue("routinesFolder"),
    hideRoutineNumbering:
      typeof settings.hideRoutineNumbering === "boolean"
        ? settings.hideRoutineNumbering
        : DEFAULT_SETTINGS.hideRoutineNumbering,
    entriesProperty: stringValue("entriesProperty"),
    storeDateFormat: stringValue("storeDateFormat"),
    subtasksProperty: stringValue("subtasksProperty"),
    subtaskEntriesProperty: stringValue("subtaskEntriesProperty"),
  };
}

function getDailyNoteFormat(app: App): string {
  const appWithPlugins = app as unknown as AppPluginAccess;
  try {
    const format = nestedString(
      appWithPlugins.internalPlugins?.getPluginById?.("daily-notes"),
      ["instance", "options", "format"]
    );
    if (format) return format;
  } catch {
    // An unavailable optional plugin should fall back to the configured default.
  }
  try {
    const format = nestedString(
      appWithPlugins.plugins?.getPlugin?.("periodic-notes"),
      ["settings", "daily", "format"]
    );
    if (format) return format;
  } catch {
    // An unavailable optional plugin should fall back to the configured default.
  }
  return "YYYY-MM-DD";
}

export default class FolderRoutinesPlugin extends Plugin {
  settings!: FolderRoutinesSettings;

  async onload() {
    await this.loadSettings();

    this.registerMarkdownCodeBlockProcessor(
      "routines",
      (source, el, ctx) => this.renderRoutines(el, ctx)
    );

    this.addCommand({
      id: "insert-routines-block",
      name: "Insert routines checklist block",
      editorCallback: (editor: Editor, _context: MarkdownFileInfo) => {
        editor.replaceSelection("```routines\n```\n");
      },
    });

    this.addSettingTab(new FolderRoutinesSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = loadSettings(await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /* The configured routines folder, or null when it no longer exists. The
     picker stores the vault root as "/", which is not a normal folder path. */
  routinesRoot(): TFolder | null {
    const path = this.settings.routinesFolder;
    const vaultRoot = this.app.vault.getRoot();
    if (path === "/" || path === vaultRoot.path) return vaultRoot;
    const folder = this.app.vault.getAbstractFileByPath(path);
    return folder instanceof TFolder ? folder : null;
  }

  private displayName(name: string): string {
    if (!this.settings.hideRoutineNumbering) return name;
    const withoutNumbering = name.replace(/^\s*\d+[.)]\s+/, "");
    return withoutNumbering || name;
  }

  /* ============================================================
     Live sync between blocks
     ============================================================ */

  private changeListeners = new Set<(e: RoutineChangeEvent) => void>();
  private blockSeq = 0;

  private nextBlockId(): string {
    this.blockSeq += 1;
    return `fr-block-${this.blockSeq}`;
  }

  /* Register a listener bound to a rendered code block: it is dropped as soon
     as Obsidian unloads that block's element. */
  private registerBlockListener(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    listener: (e: RoutineChangeEvent) => void
  ) {
    this.changeListeners.add(listener);
    const child = new MarkdownRenderChild(el);
    child.register(() => this.changeListeners.delete(listener));
    ctx.addChild(child);
  }

  private emitRoutineChange(e: RoutineChangeEvent) {
    for (const listener of [...this.changeListeners]) {
      try {
        listener(e);
      } catch (err) {
        console.error("Habit Checklist: sync listener failed", err);
      }
    }
  }

  private normalizeEntries(val: unknown): string[] {
    if (val == null) return [];
    if (Array.isArray(val)) return val.map((v) => String(v));
    return [String(val)];
  }

  private getDateString(sourcePath: string): string | null {
    const base = (sourcePath.split("/").pop() ?? "").replace(/\.md$/, "");
    const fmt = getDailyNoteFormat(this.app);
    const parsedDate = (moment as unknown as MomentFactory)(base, fmt, true);
    return parsedDate.isValid()
      ? parsedDate.format(this.settings.storeDateFormat || "YYYY-MM-DD")
      : null;
  }

  private frontmatter(file: TFile): Frontmatter | null {
    const value: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter;
    return isRecord(value) ? value : null;
  }

  private async updateFrontmatter(
    file: TFile,
    update: (frontmatter: Frontmatter) => void
  ): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (frontmatter: unknown) => {
      if (isRecord(frontmatter)) update(frontmatter);
    });
  }

  private isChecked(file: TFile, dateStr: string): boolean {
    const frontmatter = this.frontmatter(file);
    const entries = this.normalizeEntries(
      frontmatter?.[this.settings.entriesProperty]
    );
    return entries.includes(dateStr);
  }

  private getSubtasks(file: TFile): string[] {
    const frontmatter = this.frontmatter(file);
    return this.normalizeEntries(frontmatter?.[this.settings.subtasksProperty])
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  private normalizeSubtaskEntries(val: unknown): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    if (val == null || typeof val !== "object" || Array.isArray(val)) return out;
    for (const [key, v] of Object.entries(val as Record<string, unknown>)) {
      out[key] = this.normalizeEntries(v);
    }
    return out;
  }

  private isSubtaskChecked(file: TFile, name: string, dateStr: string): boolean {
    const frontmatter = this.frontmatter(file);
    const map = this.normalizeSubtaskEntries(
      frontmatter?.[this.settings.subtaskEntriesProperty]
    );
    return (map[name] ?? []).includes(dateStr);
  }

  private async reconcileSubtaskEntries(
    file: TFile,
    subtasks: string[]
  ): Promise<Record<string, string[]>> {
    const entriesProp = this.settings.entriesProperty;
    const subProp = this.settings.subtaskEntriesProperty;

    const frontmatter = this.frontmatter(file);
    const parentDates = this.normalizeEntries(frontmatter?.[entriesProp]);
    const current = this.normalizeSubtaskEntries(frontmatter?.[subProp]);

    const resolved: Record<string, string[]> = {};
    let changed = false;
    for (const name of subtasks) {
      const set = new Set(current[name] ?? []);
      const before = set.size;
      for (const d of parentDates) set.add(d);
      if (set.size !== before) changed = true;
      resolved[name] = [...set].sort();
    }

    if (changed) {
      await this.updateFrontmatter(file, (updatedFrontmatter) => {
        const pDates = this.normalizeEntries(updatedFrontmatter[entriesProp]);
        const map = this.normalizeSubtaskEntries(updatedFrontmatter[subProp]);
        for (const name of subtasks) {
          const set = new Set(map[name] ?? []);
          for (const d of pDates) set.add(d);
          map[name] = [...set].sort();
        }
        updatedFrontmatter[subProp] = map;
      });
    }

    return resolved;
  }

  private async setEntry(file: TFile, dateStr: string, checked: boolean) {
    const prop = this.settings.entriesProperty;
    await this.updateFrontmatter(file, (frontmatter) => {
      let entries = this.normalizeEntries(frontmatter[prop]);
      if (checked) {
        if (!entries.includes(dateStr)) entries.push(dateStr);
      } else {
        entries = entries.filter((e) => e !== dateStr);
      }
      entries.sort();
      frontmatter[prop] = entries;
    });
  }

  private async setSubtaskEntry(
    file: TFile,
    name: string,
    dateStr: string,
    checked: boolean,
    allSubtasks: string[]
  ): Promise<boolean> {
    const entriesProp = this.settings.entriesProperty;
    const subProp = this.settings.subtaskEntriesProperty;
    let parentChecked = false;
    await this.updateFrontmatter(file, (frontmatter) => {
      const map = this.normalizeSubtaskEntries(frontmatter[subProp]);
      let dates = map[name] ?? [];
      if (checked) {
        if (!dates.includes(dateStr)) dates.push(dateStr);
      } else {
        dates = dates.filter((d) => d !== dateStr);
      }
      dates.sort();
      map[name] = dates;

      const allDone = allSubtasks.every((s) => (map[s] ?? []).includes(dateStr));
      parentChecked = allDone;
      let entries = this.normalizeEntries(frontmatter[entriesProp]);
      if (allDone) {
        if (!entries.includes(dateStr)) entries.push(dateStr);
      } else {
        entries = entries.filter((e) => e !== dateStr);
      }
      entries.sort();
      frontmatter[entriesProp] = entries;

      if (Object.keys(map).length === 0) {
        delete frontmatter[subProp];
      } else {
        frontmatter[subProp] = map;
      }
    });
    return parentChecked;
  }

  private async setParentToggleAll(
    file: TFile,
    dateStr: string,
    checked: boolean,
    allSubtasks: string[]
  ) {
    const entriesProp = this.settings.entriesProperty;
    const subProp = this.settings.subtaskEntriesProperty;
    await this.updateFrontmatter(file, (frontmatter) => {
      const map = this.normalizeSubtaskEntries(frontmatter[subProp]);
      for (const name of allSubtasks) {
        let dates = map[name] ?? [];
        if (checked) {
          if (!dates.includes(dateStr)) dates.push(dateStr);
        } else {
          dates = dates.filter((d) => d !== dateStr);
        }
        dates.sort();
        map[name] = dates;
      }

      let entries = this.normalizeEntries(frontmatter[entriesProp]);
      if (checked) {
        if (!entries.includes(dateStr)) entries.push(dateStr);
      } else {
        entries = entries.filter((e) => e !== dateStr);
      }
      entries.sort();
      frontmatter[entriesProp] = entries;

      if (Object.keys(map).length === 0) {
        delete frontmatter[subProp];
      } else {
        frontmatter[subProp] = map;
      }
    });
  }

  private async renderRoutines(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
    el.empty();

    const root = this.routinesRoot();
    if (!root) {
      el.createDiv({
        cls: "folder-routines-error",
        text: `Habit Checklist: folder "${this.settings.routinesFolder}" not found. Set it in plugin settings.`,
      });
      return;
    }

    const dateStr = this.getDateString(ctx.sourcePath);
    if (!dateStr) {
      el.createDiv({
        cls: "folder-routines-error",
        text: "Habit Checklist: could not parse a date from this note's filename (expected a daily note).",
      });
      return;
    }

    const container = el.createDiv({
      cls: "folder-routines folder-routines-minimal",
    });

    const section = container.createDiv({
      cls: "folder-routines-section folder-routines-root",
    });
    const body = section.createDiv({ cls: "folder-routines-body" });
    const sync: BlockSync = { id: this.nextBlockId(), setters: new Map() };
    await this.renderFolder(root, body, dateStr, 3, sync);
    this.layoutColumns(body);

    this.registerBlockListener(el, ctx, (ev) => {
      if (ev.originId === sync.id || ev.dateStr !== dateStr) return;
      sync.setters.get(makeRef(ev.path, ev.subtask))?.(ev.checked);
    });
  }

  private async renderFolder(
    folder: TFolder,
    container: HTMLElement,
    dateStr: string,
    depth: number,
    sync: BlockSync
  ) {
    const children = [...folder.children].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    const files = children.filter(
      (c): c is TFile => c instanceof TFile && c.extension === "md"
    );
    const subfolders = children.filter(
      (c): c is TFolder => c instanceof TFolder
    );

    let index = 0;
    for (const file of files) {
      index++;
      await this.renderItem(file, container, dateStr, index, sync);
    }

    for (let sectionIndex = 0; sectionIndex < subfolders.length; sectionIndex++) {
      const sub = subfolders[sectionIndex];
      const section = container.createDiv({ cls: "folder-routines-section" });
      const colorIndex = sectionIndex % FolderRoutinesPlugin.SECTION_COLORS;
      section.addClass(`folder-routines-color-${colorIndex + 1}`);
      const tag = ("h" + Math.min(depth, 6)) as keyof HTMLElementTagNameMap;
      const header = section.createEl(tag, { cls: "folder-routines-heading" });
      header.createSpan({
        cls: "folder-routines-heading-title",
        text: this.displayName(sub.name),
      });
      this.createProgress(header);

      const body = section.createDiv({ cls: "folder-routines-body" });
      await this.renderFolder(sub, body, dateStr, depth + 1, sync);
      this.updateSectionProgress(section);

      header.addEventListener("click", () => {
        section.toggleClass("is-collapsed", !section.hasClass("is-collapsed"));
      });
    }
  }

  private static readonly SECTION_COLORS = 4;

  /* Split the checklist's top-level blocks into two column wrappers. A block
     is a section, or an item together with its subtask list. Reading order
     is kept: the first column runs top to bottom, then the second, and the
     split point balances the visible rows. The wrappers are invisible to
     layout until the stylesheet decides the pane is wide enough to place
     them side by side, so narrow panes still render one column. */
  private layoutColumns(body: HTMLElement) {
    let host = body;
    let blocks = this.topLevelBlocks(body);
    if (blocks.length === 1 && blocks[0][0].hasClass("folder-routines-section")) {
      const inner = blocks[0][0].querySelector<HTMLElement>(
        ":scope > .folder-routines-body"
      );
      if (inner) {
        host = inner;
        blocks = this.topLevelBlocks(inner);
      }
    }
    if (blocks.length < 2) return;

    const rowSelector =
      ".folder-routines-heading, .folder-routines-item, .folder-routines-subtask";
    const weights = blocks.map((block) =>
      block.reduce(
        (rows, el) =>
          rows +
          (el.matches(rowSelector) ? 1 : 0) +
          el.querySelectorAll(rowSelector).length,
        0
      )
    );
    const total = weights.reduce((sum, w) => sum + w, 0);
    let split = 1;
    let bestDistance = Infinity;
    let running = 0;
    for (let i = 0; i < blocks.length - 1; i++) {
      running += weights[i];
      const distance = Math.abs(running * 2 - total);
      if (distance < bestDistance) {
        bestDistance = distance;
        split = i + 1;
      }
    }

    const columns = host.createDiv({ cls: "folder-routines-columns" });
    const left = columns.createDiv({ cls: "folder-routines-column" });
    const right = columns.createDiv({ cls: "folder-routines-column" });
    blocks.forEach((block, i) => {
      const column = i < split ? left : right;
      for (const el of block) column.appendChild(el);
    });
  }

  /* Direct children of a body grouped into blocks: a subtask list always
     belongs to the item rendered immediately before it. */
  private topLevelBlocks(body: HTMLElement): HTMLElement[][] {
    const blocks: HTMLElement[][] = [];
    for (const child of Array.from(body.children)) {
      if (!(child instanceof HTMLElement)) continue;
      if (child.hasClass("folder-routines-subtasks") && blocks.length > 0) {
        blocks[blocks.length - 1].push(child);
      } else {
        blocks.push([child]);
      }
    }
    return blocks;
  }

  private createProgress(header: HTMLElement) {
    const progress = header.createDiv({ cls: "folder-routines-progress" });
    const badge = progress.createDiv({ cls: "folder-routines-progress-badge" });
    badge.createSpan({ cls: "folder-routines-progress-label", text: "Progress" });
    badge.createSpan({ cls: "folder-routines-progress-count", text: "0/0" });
    const bar = progress.createDiv({ cls: "folder-routines-progress-bar" });
    bar.createDiv({ cls: "folder-routines-progress-fill" });
  }

  private updateSectionProgress(section: HTMLElement) {
    const checkboxes = Array.from(
      section.querySelectorAll<HTMLInputElement>(".folder-routines-progress-checkbox")
    );
    const total = checkboxes.length;
    const done = checkboxes.filter((checkbox) => checkbox.checked).length;
    const progress = section.querySelector<HTMLElement>(
      ":scope > .folder-routines-heading .folder-routines-progress"
    );
    if (!progress) return;

    const count = progress.querySelector<HTMLElement>(".folder-routines-progress-count");
    if (count) count.setText(`${done}/${total}`);

    const fill = progress.querySelector<HTMLElement>(".folder-routines-progress-fill");
    const ratio = total === 0 ? 0 : done / total;
    if (fill) fill.style.setProperty("--fr-progress", `${ratio * 100}%`);

    const isComplete = total > 0 && done === total;
    section.toggleClass("is-complete", isComplete);
  }

  private updateAncestorProgress(from: HTMLElement) {
    let section = from.closest<HTMLElement>(".folder-routines-section");
    while (section) {
      this.updateSectionProgress(section);
      section = section.parentElement?.closest<HTMLElement>(".folder-routines-section") ?? null;
    }
  }

  private wireSelection(itemEl: HTMLElement) {
    const select = () => {
      const root = itemEl.closest<HTMLElement>(".folder-routines");
      root
        ?.querySelectorAll(".is-selected")
        .forEach((n) => n.removeClass("is-selected"));
      itemEl.addClass("is-selected");
    };
    itemEl.addEventListener("pointerdown", select);
    itemEl.addEventListener("focusin", select);
  }

  private async renderItem(
    file: TFile,
    container: HTMLElement,
    dateStr: string,
    index = 0,
    sync?: BlockSync
  ) {
    const subtasks = this.getSubtasks(file);
    const itemEl = container.createDiv({ cls: "folder-routines-item" });
    itemEl.tabIndex = 0;
    this.wireSelection(itemEl);
    const label = itemEl.createEl("label", { cls: "folder-routines-label" });
    if (index > 0 && !this.settings.hideRoutineNumbering) {
      label.createSpan({
        cls: "folder-routines-index",
        text: String(index).padStart(2, "0"),
      });
    }
    const checkbox = label.createEl("input", {
      type: "checkbox",
    });
    checkbox.classList.add("folder-routines-checkbox");
    label.createSpan({ cls: "folder-routines-checkbox-indicator" });
    label.createSpan({
      text: this.displayName(file.basename),
      cls: "folder-routines-text",
    });

    if (subtasks.length === 0) {
      checkbox.classList.add("folder-routines-progress-checkbox");
      checkbox.checked = this.isChecked(file, dateStr);
      itemEl.toggleClass("is-checked", checkbox.checked);

      sync?.setters.set(file.path, (checked) => {
        if (checkbox.checked === checked) return;
        checkbox.checked = checked;
        itemEl.toggleClass("is-checked", checked);
        this.updateAncestorProgress(itemEl);
      });

      checkbox.addEventListener("change", () => {
        void (async () => {
        const target = checkbox.checked;
        checkbox.disabled = true;
        try {
          await this.setEntry(file, dateStr, target);
          itemEl.toggleClass("is-checked", target);
          this.emitRoutineChange({
            dateStr,
            path: file.path,
            subtask: null,
            checked: target,
            parentChecked: target,
            subtasks: [],
            originId: sync?.id ?? "",
          });
        } catch (e) {
          console.error("Habit Checklist: failed to update frontmatter", e);
          new Notice(`Habit Checklist: failed to update ${file.basename}`);
          checkbox.checked = !target;
        } finally {
          checkbox.disabled = false;
          this.updateAncestorProgress(itemEl);
        }
        })();
      });
      return;
    }

    checkbox.classList.add("folder-routines-parent-checkbox");

    const subContainer = container.createDiv({ cls: "folder-routines-subtasks" });
    const subEls: { name: string; el: HTMLElement; checkbox: HTMLInputElement }[] = [];

    const refreshParent = () => {
      const allChecked = subEls.every((s) => s.checkbox.checked);
      checkbox.checked = allChecked;
      itemEl.toggleClass("is-checked", allChecked);
    };

    const setAllDisabled = (disabled: boolean) => {
      checkbox.disabled = disabled;
      for (const s of subEls) s.checkbox.disabled = disabled;
    };

    const resolved = await this.reconcileSubtaskEntries(file, subtasks);

    subtasks.forEach((name, subIndex) => {
      const subItem = subContainer.createDiv({ cls: "folder-routines-subtask" });
      subItem.tabIndex = 0;
      this.wireSelection(subItem);
      if (subIndex === subtasks.length - 1) subItem.addClass("is-last");
      const subLabel = subItem.createEl("label", { cls: "folder-routines-label" });
      subLabel.createSpan({ cls: "folder-routines-tree", text: "" });
      const subCheckbox = subLabel.createEl("input", {
        type: "checkbox",
      });
      subCheckbox.classList.add("folder-routines-checkbox", "folder-routines-progress-checkbox");
      subLabel.createSpan({ cls: "folder-routines-checkbox-indicator" });
      subCheckbox.checked = (resolved[name] ?? []).includes(dateStr);
      subLabel.createSpan({ text: name, cls: "folder-routines-text" });
      subItem.toggleClass("is-checked", subCheckbox.checked);
      subEls.push({ name, el: subItem, checkbox: subCheckbox });

      sync?.setters.set(makeRef(file.path, name), (checked) => {
        if (subCheckbox.checked === checked) return;
        subCheckbox.checked = checked;
        subItem.toggleClass("is-checked", checked);
        refreshParent();
        this.updateAncestorProgress(subItem);
      });

      subCheckbox.addEventListener("change", () => {
        void (async () => {
        const target = subCheckbox.checked;
        setAllDisabled(true);
        try {
          const parentChecked = await this.setSubtaskEntry(
            file,
            name,
            dateStr,
            target,
            subtasks
          );
          subItem.toggleClass("is-checked", target);
          refreshParent();
          this.emitRoutineChange({
            dateStr,
            path: file.path,
            subtask: name,
            checked: target,
            parentChecked,
            subtasks,
            originId: sync?.id ?? "",
          });
        } catch (e) {
          console.error("Habit Checklist: failed to update frontmatter", e);
          new Notice(`Habit Checklist: failed to update ${file.basename}`);
          subCheckbox.checked = !target;
        } finally {
          setAllDisabled(false);
          this.updateAncestorProgress(subItem);
        }
        })();
      });
    });

    refreshParent();

    sync?.setters.set(file.path, (checked) => {
      checkbox.checked = checked;
      itemEl.toggleClass("is-checked", checked);
      for (const s of subEls) {
        s.checkbox.checked = checked;
        s.el.toggleClass("is-checked", checked);
      }
      this.updateAncestorProgress(itemEl);
    });

    checkbox.addEventListener("change", () => {
      void (async () => {
      const target = checkbox.checked;
      setAllDisabled(true);
      try {
        await this.setParentToggleAll(file, dateStr, target, subtasks);
        itemEl.toggleClass("is-checked", target);
        for (const s of subEls) {
          s.checkbox.checked = target;
          s.el.toggleClass("is-checked", target);
        }
        this.emitRoutineChange({
          dateStr,
          path: file.path,
          subtask: null,
          checked: target,
          parentChecked: target,
          subtasks,
          originId: sync?.id ?? "",
        });
      } catch (e) {
        console.error("Habit Checklist: failed to update frontmatter", e);
        new Notice(`Habit Checklist: failed to update ${file.basename}`);
        checkbox.checked = !target;
      } finally {
        setAllDisabled(false);
        this.updateAncestorProgress(itemEl);
      }
      })();
    });
  }

}

class FolderRoutinesSettingTab extends PluginSettingTab {
  plugin: FolderRoutinesPlugin;

  constructor(app: App, plugin: FolderRoutinesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: "Routines folder",
        desc: "Folder holding your routine notes.",
        control: {
          type: "folder",
          key: "routinesFolder",
          placeholder: "Routines",
        },
      },
      {
        name: "Hide routine numbering",
        desc: "Hide checklist indices and leading file or folder numbering. Names on disk are unchanged.",
        control: { type: "toggle", key: "hideRoutineNumbering" },
      },
      {
        name: "Entries property",
        desc: "Frontmatter property updated when an item is checked.",
        control: { type: "text", key: "entriesProperty", placeholder: "entries" },
      },
      {
        name: "Stored date format",
        desc: "Moment format used for the date written into entries.",
        control: { type: "text", key: "storeDateFormat", placeholder: "YYYY-MM-DD" },
      },
      {
        name: "Subtasks property",
        desc: "Frontmatter property that lists a note's subtasks.",
        control: { type: "text", key: "subtasksProperty", placeholder: "subtasks" },
      },
      {
        name: "Subtask entries property",
        desc: "Frontmatter property where per-subtask completion dates are stored.",
        control: {
          type: "text",
          key: "subtaskEntriesProperty",
          placeholder: "subtaskEntries",
        },
      },
    ];
  }

  getControlValue(key: string): unknown {
    return this.plugin.settings[key as keyof FolderRoutinesSettings];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === "hideRoutineNumbering" && typeof value === "boolean") {
      this.plugin.settings.hideRoutineNumbering = value;
    } else if (key === "routinesFolder" && typeof value === "string") {
      this.plugin.settings.routinesFolder = value.trim() || DEFAULT_SETTINGS.routinesFolder;
    } else if (key === "entriesProperty" && typeof value === "string") {
      this.plugin.settings.entriesProperty = value.trim() || DEFAULT_SETTINGS.entriesProperty;
    } else if (key === "storeDateFormat" && typeof value === "string") {
      this.plugin.settings.storeDateFormat = value.trim() || DEFAULT_SETTINGS.storeDateFormat;
    } else if (key === "subtasksProperty" && typeof value === "string") {
      this.plugin.settings.subtasksProperty = value.trim() || DEFAULT_SETTINGS.subtasksProperty;
    } else if (key === "subtaskEntriesProperty" && typeof value === "string") {
      this.plugin.settings.subtaskEntriesProperty =
        value.trim() || DEFAULT_SETTINGS.subtaskEntriesProperty;
    } else {
      return;
    }
    await this.plugin.saveSettings();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Routines folder")
      .setDesc("Folder holding your routine notes.")
      .addText((text) => {
        text.setPlaceholder("Routines").setValue(this.plugin.settings.routinesFolder).onChange(async (value) => {
          this.plugin.settings.routinesFolder = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Hide routine numbering")
      .setDesc(
        "Hide checklist indices and leading file or folder numbering such as '1. Meditation'. Names on disk are unchanged; reopen affected notes to apply."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.hideRoutineNumbering)
          .onChange(async (value) => {
            this.plugin.settings.hideRoutineNumbering = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Entries property")
      .setDesc("Frontmatter property updated when an item is checked.")
      .addText((text) =>
        text
          .setPlaceholder("entries")
          .setValue(this.plugin.settings.entriesProperty)
          .onChange(async (value) => {
            this.plugin.settings.entriesProperty = value.trim() || "entries";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Stored date format")
      .setDesc("Moment format used for the date written into 'entries'.")
      .addText((text) =>
        text
          .setPlaceholder("YYYY-MM-DD")
          .setValue(this.plugin.settings.storeDateFormat)
          .onChange(async (value) => {
            this.plugin.settings.storeDateFormat = value.trim() || "YYYY-MM-DD";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Subtasks property")
      .setDesc("Frontmatter property that lists a note's subtasks.")
      .addText((text) =>
        text
          .setPlaceholder("subtasks")
          .setValue(this.plugin.settings.subtasksProperty)
          .onChange(async (value) => {
            this.plugin.settings.subtasksProperty = value.trim() || "subtasks";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Subtask entries property")
      .setDesc("Frontmatter property where per-subtask completion dates are stored.")
      .addText((text) =>
        text
          .setPlaceholder("subtaskEntries")
          .setValue(this.plugin.settings.subtaskEntriesProperty)
          .onChange(async (value) => {
            this.plugin.settings.subtaskEntriesProperty =
              value.trim() || "subtaskEntries";
            await this.plugin.saveSettings();
          })
      );

  }
}
