import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  MarkdownPostProcessorContext,
  Notice,
  Editor,
  MarkdownView,
  moment,
} from "obsidian";

interface FolderRoutinesSettings {
  routinesFolder: string;
  entriesProperty: string;
  storeDateFormat: string;
  subtasksProperty: string;
  subtaskEntriesProperty: string;
}

const DEFAULT_SETTINGS: FolderRoutinesSettings = {
  routinesFolder: "Routines",
  entriesProperty: "entries",
  storeDateFormat: "YYYY-MM-DD",
  subtasksProperty: "subtasks",
  subtaskEntriesProperty: "subtaskEntries",
};

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
  ) {
    const entriesProp = this.settings.entriesProperty;
    const subProp = this.settings.subtaskEntriesProperty;
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

    const root = this.app.vault.getAbstractFileByPath(this.settings.routinesFolder);
    if (!(root instanceof TFolder)) {
      el.createDiv({
        cls: "folder-routines-error",
        text: `Folder Routines: folder "${this.settings.routinesFolder}" not found. Set it in plugin settings.`,
      });
      return;
    }

    const date = this.getNoteDate(ctx.sourcePath);
    if (!date) {
      el.createDiv({
        cls: "folder-routines-error",
        text: "Folder Routines: could not parse a date from this note's filename (expected a daily note).",
      });
      return;
    }

    const dateStr = date.format(this.settings.storeDateFormat || "YYYY-MM-DD");
    const container = el.createDiv({ cls: "folder-routines" });

    const section = container.createDiv({
      cls: "folder-routines-section folder-routines-root",
    });
    const header = section.createEl("h2", { cls: "folder-routines-heading" });
    header.createSpan({ cls: "folder-routines-collapse-icon", text: "▼" });
    header.createSpan({ cls: "folder-routines-banner", text: this.getCategoryIcon("Habits") });
    header.createSpan({ cls: "folder-routines-heading-title", text: "Habits" });
    this.createProgress(header);

    const body = section.createDiv({ cls: "folder-routines-body" });
    await this.renderFolder(root, body, dateStr, 3);
    this.updateSectionProgress(section);

    header.addEventListener("click", () => {
      section.toggleClass("is-collapsed", !section.hasClass("is-collapsed"));
    });
  }

  private async renderFolder(
    folder: TFolder,
    container: HTMLElement,
    dateStr: string,
    depth: number
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
      await this.renderItem(file, container, dateStr, index);
    }

    for (let sectionIndex = 0; sectionIndex < subfolders.length; sectionIndex++) {
      const sub = subfolders[sectionIndex];
      const section = container.createDiv({ cls: "folder-routines-section" });
      const colorIndex = sectionIndex % FolderRoutinesPlugin.SECTION_COLORS;
      section.addClass(`folder-routines-color-${colorIndex + 1}`);
      const tag = ("h" + Math.min(depth, 6)) as keyof HTMLElementTagNameMap;
      const header = section.createEl(tag, { cls: "folder-routines-heading" });
      header.createSpan({ cls: "folder-routines-collapse-icon", text: "▼" });
      header.createSpan({ cls: "folder-routines-banner", text: this.getCategoryIcon(sub.name) });
      header.createSpan({ cls: "folder-routines-heading-title", text: sub.name });
      this.createProgress(header);

      const body = section.createDiv({ cls: "folder-routines-body" });
      await this.renderFolder(sub, body, dateStr, depth + 1);
      this.updateSectionProgress(section);

      header.addEventListener("click", () => {
        section.toggleClass("is-collapsed", !section.hasClass("is-collapsed"));
      });
    }
  }

  private static readonly PROGRESS_BLOCKS = 10;
  private static readonly SECTION_COLORS = 5;

  private createProgress(header: HTMLElement) {
    const progress = header.createDiv({ cls: "folder-routines-progress" });
    const badge = progress.createDiv({ cls: "folder-routines-progress-badge" });
    badge.createSpan({ cls: "folder-routines-progress-label", text: "QUESTS" });
    badge.createSpan({ cls: "folder-routines-progress-count", text: "0/0" });
    const bar = progress.createDiv({ cls: "folder-routines-progress-bar" });
    for (let i = 0; i < FolderRoutinesPlugin.PROGRESS_BLOCKS; i++) {
      bar.createDiv({ cls: "folder-routines-progress-block" });
    }
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

    const blocks = Array.from(
      progress.querySelectorAll<HTMLElement>(".folder-routines-progress-block")
    );
    const ratio = total === 0 ? 0 : done / total;
    const filled = Math.round(ratio * blocks.length);
    blocks.forEach((block, index) => {
      block.toggleClass("is-filled", index < filled);
    });

    const wasComplete = section.hasClass("is-complete");
    const isComplete = total > 0 && done === total;
    section.toggleClass("is-complete", isComplete);
    if (isComplete && !wasComplete) {
      section.addClass("is-just-completed");
      window.setTimeout(() => section.removeClass("is-just-completed"), 600);
      this.showQuestBanner(section);
    }
  }

  private showQuestBanner(section: HTMLElement) {
    const header = section.querySelector<HTMLElement>(
      ":scope > .folder-routines-heading"
    );
    if (!header) return;
    const banner = header.createDiv({
      cls: "folder-routines-quest-banner",
      text: "★ QUEST COMPLETE ★",
    });
    window.setTimeout(() => banner.remove(), 1600);
  }

  private showXpPopup(host: HTMLElement) {
    const popup = host.createSpan({
      cls: "folder-routines-xp-popup",
      text: "+5 XP",
    });
    window.setTimeout(() => popup.remove(), 900);
  }

  private getCategoryIcon(name: string): string {
    const key = name.toLowerCase().trim();
    const icons: Record<string, string> = {
      habits: "❤",
      routine: "🧭",
      fitness: "💪",
      workout: "🏋",
      walk: "👟",
      namaz: "☪",
      learning: "📚",
      reading: "📖",
      nutrition: "🍎",
      food: "🍖",
      water: "💧",
      sleep: "🌙",
      meditation: "🧘",
      streaks: "🔥",
      work: "💼",
    };
    return icons[key] ?? "◆";
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
    index = 0
  ) {
    const subtasks = this.getSubtasks(file);
    const itemEl = container.createDiv({ cls: "folder-routines-item" });
    itemEl.tabIndex = 0;
    this.wireSelection(itemEl);
    const label = itemEl.createEl("label", { cls: "folder-routines-label" });
    if (index > 0) {
      label.createSpan({
        cls: "folder-routines-index",
        text: String(index).padStart(2, "0"),
      });
    }
    const checkbox = label.createEl("input", {
      type: "checkbox",
    }) as HTMLInputElement;
    checkbox.classList.add("folder-routines-checkbox");
    label.createSpan({ text: file.basename, cls: "folder-routines-text" });

    if (subtasks.length === 0) {
      checkbox.classList.add("folder-routines-progress-checkbox");
      checkbox.checked = this.isChecked(file, dateStr);
      itemEl.toggleClass("is-checked", checkbox.checked);

      checkbox.addEventListener("change", async () => {
        const target = checkbox.checked;
        checkbox.disabled = true;
        try {
          await this.setEntry(file, dateStr, target);
          itemEl.toggleClass("is-checked", target);
          if (target) this.showXpPopup(itemEl);
        } catch (e) {
          console.error("Folder Routines: failed to update frontmatter", e);
          new Notice(`Folder Routines: failed to update ${file.basename}`);
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

      subCheckbox.addEventListener("change", async () => {
        const target = subCheckbox.checked;
        setAllDisabled(true);
        try {
          await this.setSubtaskEntry(file, name, dateStr, target, subtasks);
          subItem.toggleClass("is-checked", target);
          if (target) this.showXpPopup(subItem);
          refreshParent();
        } catch (e) {
          console.error("Folder Routines: failed to update frontmatter", e);
          new Notice(`Folder Routines: failed to update ${file.basename}`);
          subCheckbox.checked = !target;
        } finally {
          setAllDisabled(false);
          this.updateAncestorProgress(subItem);
        }
      });
    });

    refreshParent();

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
      } catch (e) {
        console.error("Folder Routines: failed to update frontmatter", e);
        new Notice(`Folder Routines: failed to update ${file.basename}`);
        checkbox.checked = !target;
      } finally {
        setAllDisabled(false);
        this.updateAncestorProgress(itemEl);
      }
    });
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
      .setDesc("Vault-relative path to the root folder (e.g. Routines).")
      .addText((text) =>
        text
          .setPlaceholder("Routines")
          .setValue(this.plugin.settings.routinesFolder)
          .onChange(async (value) => {
            this.plugin.settings.routinesFolder = value.trim();
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
