import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  Modal,
  Notice,
  Editor,
  MarkdownView,
  moment,
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

interface TrackingResetResult {
  filesCleared: number;
  propertiesCleared: number;
  failedFiles: string[];
}

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

function getDailyNoteFormat(app: App): string {
  const anyApp = app as any;
  try {
    const dn = anyApp.internalPlugins?.getPluginById?.("daily-notes");
    const fmt = dn?.instance?.options?.format;
    if (fmt) return fmt;
  } catch (e) {
    /* ignore */
  }
  try {
    const pn = anyApp.plugins?.getPlugin?.("periodic-notes");
    const fmt = pn?.settings?.daily?.format;
    if (fmt) return fmt;
  } catch (e) {
    /* ignore */
  }
  return "YYYY-MM-DD";
}

export default class FolderRoutinesPlugin extends Plugin {
  settings: FolderRoutinesSettings;

  async onload() {
    await this.loadSettings();

    this.registerMarkdownCodeBlockProcessor(
      "routines",
      (source, el, ctx) => this.renderRoutines(el, ctx)
    );

    this.addCommand({
      id: "insert-routines-block",
      name: "Insert routines checklist block",
      editorCallback: (editor: Editor, _view: MarkdownView) => {
        editor.replaceSelection("```routines\n```\n");
      },
    });

    this.addSettingTab(new FolderRoutinesSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private trackingPropertyNames(): string[] {
    return [
      this.settings.entriesProperty,
      this.settings.subtaskEntriesProperty,
    ].filter((name, index, names) => name.length > 0 && names.indexOf(name) === index);
  }

  async resetTrackingData(): Promise<TrackingResetResult> {
    const properties = this.trackingPropertyNames();
    const files = this.app.vault.getMarkdownFiles().filter((file) => {
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      return (
        frontmatter != null &&
        properties.some((property) =>
          Object.prototype.hasOwnProperty.call(frontmatter, property)
        )
      );
    });

    let filesCleared = 0;
    let propertiesCleared = 0;
    const failedFiles: string[] = [];

    for (const file of files) {
      let removedFromFile = 0;
      try {
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
          for (const property of properties) {
            if (!Object.prototype.hasOwnProperty.call(frontmatter, property))
              continue;
            delete frontmatter[property];
            removedFromFile += 1;
          }
        });
        if (removedFromFile > 0) {
          filesCleared += 1;
          propertiesCleared += removedFromFile;
        }
      } catch (error) {
        failedFiles.push(file.path);
        console.error(
          `Habit Checklist: failed to reset tracking data in ${file.path}`,
          error
        );
      }
    }

    return { filesCleared, propertiesCleared, failedFiles };
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

  /* Every folder in the vault, each parent listed before its children, so the
     settings picker reads like the file explorer. */
  allFolderPaths(): string[] {
    const out: string[] = [];
    const walk = (folder: TFolder) => {
      out.push(folder.path);
      const subs = folder.children
        .filter((c): c is TFolder => c instanceof TFolder)
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const sub of subs) walk(sub);
    };
    walk(this.app.vault.getRoot());
    return out;
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

  private getNoteDate(sourcePath: string): ReturnType<typeof moment> | null {
    const base = (sourcePath.split("/").pop() ?? "").replace(/\.md$/, "");
    const fmt = getDailyNoteFormat(this.app);
    const m = moment(base, fmt, true);
    return m.isValid() ? m : null;
  }

  private isChecked(file: TFile, dateStr: string): boolean {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const entries = this.normalizeEntries(fm?.[this.settings.entriesProperty]);
    return entries.includes(dateStr);
  }

  private getSubtasks(file: TFile): string[] {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    return this.normalizeEntries(fm?.[this.settings.subtasksProperty])
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
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const map = this.normalizeSubtaskEntries(fm?.[this.settings.subtaskEntriesProperty]);
    return (map[name] ?? []).includes(dateStr);
  }

  private async reconcileSubtaskEntries(
    file: TFile,
    subtasks: string[]
  ): Promise<Record<string, string[]>> {
    const entriesProp = this.settings.entriesProperty;
    const subProp = this.settings.subtaskEntriesProperty;

    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const parentDates = this.normalizeEntries(fm?.[entriesProp]);
    const current = this.normalizeSubtaskEntries(fm?.[subProp]);

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
      await this.app.fileManager.processFrontMatter(file, (fmw) => {
        const pDates = this.normalizeEntries(fmw[entriesProp]);
        const map = this.normalizeSubtaskEntries(fmw[subProp]);
        for (const name of subtasks) {
          const set = new Set(map[name] ?? []);
          for (const d of pDates) set.add(d);
          map[name] = [...set].sort();
        }
        fmw[subProp] = map;
      });
    }

    return resolved;
  }

  private async setEntry(file: TFile, dateStr: string, checked: boolean) {
    const prop = this.settings.entriesProperty;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      let entries = this.normalizeEntries(fm[prop]);
      if (checked) {
        if (!entries.includes(dateStr)) entries.push(dateStr);
      } else {
        entries = entries.filter((e) => e !== dateStr);
      }
      entries.sort();
      fm[prop] = entries;
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
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      const map = this.normalizeSubtaskEntries(fm[subProp]);
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
      let entries = this.normalizeEntries(fm[entriesProp]);
      if (allDone) {
        if (!entries.includes(dateStr)) entries.push(dateStr);
      } else {
        entries = entries.filter((e) => e !== dateStr);
      }
      entries.sort();
      fm[entriesProp] = entries;

      if (Object.keys(map).length === 0) {
        delete fm[subProp];
      } else {
        fm[subProp] = map;
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
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      const map = this.normalizeSubtaskEntries(fm[subProp]);
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

      let entries = this.normalizeEntries(fm[entriesProp]);
      if (checked) {
        if (!entries.includes(dateStr)) entries.push(dateStr);
      } else {
        entries = entries.filter((e) => e !== dateStr);
      }
      entries.sort();
      fm[entriesProp] = entries;

      if (Object.keys(map).length === 0) {
        delete fm[subProp];
      } else {
        fm[subProp] = map;
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

    const date = this.getNoteDate(ctx.sourcePath);
    if (!date) {
      el.createDiv({
        cls: "folder-routines-error",
        text: "Habit Checklist: could not parse a date from this note's filename (expected a daily note).",
      });
      return;
    }

    const dateStr = date.format(this.settings.storeDateFormat || "YYYY-MM-DD");
    const container = el.createDiv({
      cls: "folder-routines folder-routines-minimal",
    });

    const section = container.createDiv({
      cls: "folder-routines-section folder-routines-root",
    });
    const body = section.createDiv({ cls: "folder-routines-body" });
    const sync: BlockSync = { id: this.nextBlockId(), setters: new Map() };
    await this.renderFolder(root, body, dateStr, 3, sync);

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
    }) as HTMLInputElement;
    checkbox.classList.add("folder-routines-checkbox");
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

      checkbox.addEventListener("change", async () => {
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
      }) as HTMLInputElement;
      subCheckbox.classList.add("folder-routines-checkbox", "folder-routines-progress-checkbox");
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

      subCheckbox.addEventListener("change", async () => {
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

    checkbox.addEventListener("change", async () => {
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
    });
  }

}

class ResetTrackingDataModal extends Modal {
  private plugin: FolderRoutinesPlugin;

  constructor(app: App, plugin: FolderRoutinesPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    this.setTitle("Reset all tracking data?");
    this.contentEl.createEl("p", {
      text: "This permanently removes habit and subtask completion history from every Markdown file in this vault.",
    });
    this.contentEl.createEl("p", {
      text: "Habit definitions, note content, and plugin settings are kept. This cannot be undone.",
    });

    let cancelButton: HTMLButtonElement | null = null;
    new Setting(this.contentEl)
      .addButton((button) => {
        cancelButton = button.buttonEl;
        button.setButtonText("Cancel").onClick(() => this.close());
      })
      .addButton((button) =>
        button
          .setButtonText("Reset tracking data")
          .setWarning()
          .onClick(async () => {
            button.setDisabled(true).setButtonText("Resetting...");
            if (cancelButton) cancelButton.disabled = true;
            try {
              const result = await this.plugin.resetTrackingData();
              this.close();
              if (result.failedFiles.length > 0) {
                new Notice(
                  `Habit Checklist: cleared ${result.propertiesCleared} properties from ${result.filesCleared} files; ${result.failedFiles.length} files could not be updated. See the developer console.`
                );
              } else if (result.filesCleared === 0) {
                new Notice("Habit Checklist: no tracking data found.");
              } else {
                new Notice(
                  `Habit Checklist: cleared ${result.propertiesCleared} properties from ${result.filesCleared} files. Reopen affected notes to refresh their views.`
                );
              }
            } catch (error) {
              console.error("Habit Checklist: failed to reset tracking data", error);
              new Notice("Habit Checklist: failed to reset tracking data.");
              button.setDisabled(false).setButtonText("Reset tracking data");
              if (cancelButton) cancelButton.disabled = false;
            }
          })
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class FolderRoutinesSettingTab extends PluginSettingTab {
  plugin: FolderRoutinesPlugin;

  constructor(app: App, plugin: FolderRoutinesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Routines folder")
      .setDesc("Folder holding your routine notes.")
      .addDropdown((drop) => {
        const current = this.plugin.settings.routinesFolder;
        const folders = this.plugin.allFolderPaths();
        // A folder that has since been renamed or deleted still gets an entry,
        // so the picker shows what is stored instead of a different folder.
        if (!folders.includes(current))
          drop.addOption(
            current,
            current === "" ? "(none selected)" : `${current} (not found)`
          );
        for (const path of folders)
          drop.addOption(path, path === "/" ? "/ (vault root)" : path);
        drop.setValue(current).onChange(async (value) => {
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

    new Setting(containerEl)
      .setName("Reset all tracking data")
      .setDesc(
        "Permanently delete habit and subtask completion history from every Markdown file in this vault."
      )
      .addButton((button) =>
        button
          .setButtonText("Reset tracking data")
          .setWarning()
          .onClick(() => new ResetTrackingDataModal(this.app, this.plugin).open())
      );
  }
}
