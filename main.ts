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

    this.registerMarkdownCodeBlockProcessor(
      "routine-stats",
      (source, el) => this.renderStats(source, el)
    );

    this.addCommand({
      id: "insert-routines-block",
      name: "Insert routines checklist block",
      editorCallback: (editor: Editor, _view: MarkdownView) => {
        editor.replaceSelection("```routines\n```\n");
      },
    });

    this.addCommand({
      id: "insert-routine-stats-block",
      name: "Insert routine stats board",
      editorCallback: (editor: Editor, _view: MarkdownView) => {
        editor.replaceSelection("```routine-stats\n```\n");
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

  private getCategoryIcon(_name: string): string {
    // Single retro default icon for every section.
    return "◆";
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

  /* ============================================================
     Stats board (```routine-stats```)
     ============================================================ */

  private getEntryDates(file: TFile): Set<string> {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    return new Set(this.normalizeEntries(fm?.[this.settings.entriesProperty]));
  }

  /* Poll the metadata cache until it reflects the just-written entry state,
     so a re-render doesn't read stale frontmatter. */
  private async waitForEntryState(
    file: TFile,
    dateStr: string,
    expected: boolean,
    tries = 20
  ): Promise<void> {
    for (let i = 0; i < tries; i++) {
      if (this.getEntryDates(file).has(dateStr) === expected) return;
      await new Promise((r) => window.setTimeout(r, 25));
    }
  }

  private collectSectionFiles(folder: TFolder): TFile[] {
    return [...folder.children]
      .filter((c): c is TFile => c instanceof TFile && c.extension === "md")
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /* Longest run of consecutive true values. */
  private bestStreak(flags: boolean[]): number {
    let best = 0;
    let run = 0;
    for (const f of flags) {
      run = f ? run + 1 : 0;
      if (run > best) best = run;
    }
    return best;
  }

  /* Trailing run of true values ending at the last index (today). */
  private currentStreak(flags: boolean[]): number {
    let run = 0;
    for (let i = flags.length - 1; i >= 0; i--) {
      if (flags[i]) run++;
      else break;
    }
    return run;
  }

  private rankFor(pct: number): string {
    if (pct >= 95) return "S";
    if (pct >= 85) return "A";
    if (pct >= 70) return "B";
    if (pct >= 50) return "C";
    if (pct >= 25) return "D";
    return "E";
  }

  private sparkline(perDay: number[], routines: number): string {
    const glyphs = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
    if (routines <= 0) return "";
    return perDay
      .map((v) => {
        const ratio = Math.max(0, Math.min(1, v / routines));
        const idx =
          v === 0 ? 0 : Math.max(1, Math.round(ratio * (glyphs.length - 1)));
        return glyphs[idx];
      })
      .join("");
  }

  private async renderStats(source: string, el: HTMLElement) {
    el.empty();

    const root = this.app.vault.getAbstractFileByPath(this.settings.routinesFolder);
    if (!(root instanceof TFolder)) {
      el.createDiv({
        cls: "folder-routines-error",
        text: `Folder Routines: folder "${this.settings.routinesFolder}" not found. Set it in plugin settings.`,
      });
      return;
    }

    const container = el.createDiv({ cls: "folder-routines routine-stats" });

    const toolbar = container.createDiv({ cls: "routine-stats-toolbar" });
    toolbar.createSpan({ cls: "routine-stats-toolbar-title", text: "STATS" });
    toolbar.createSpan({ cls: "routine-stats-toolbar-range", text: "21 DAYS" });

    const boards = container.createDiv({ cls: "routine-stats-boards" });
    this.renderStatsBoards(boards, root, 21);
  }

  private renderStatsBoards(host: HTMLElement, root: TFolder, days: number) {
    host.empty();

    const today = moment().startOf("day");
    const dateStrs: string[] = [];
    const labels: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = today.clone().subtract(i, "days");
      dateStrs.push(d.format(this.settings.storeDateFormat || "YYYY-MM-DD"));
      labels.push(d.format("D"));
    }

    // one grid per subfolder (Fitness, Namaz, ...) plus root-level files
    const sections: { name: string; files: TFile[] }[] = [];
    const rootFiles = this.collectSectionFiles(root);
    if (rootFiles.length) sections.push({ name: root.name, files: rootFiles });
    const subfolders = [...root.children]
      .filter((c): c is TFolder => c instanceof TFolder)
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const sub of subfolders) {
      const files = this.collectSectionFiles(sub);
      if (files.length) sections.push({ name: sub.name, files });
    }

    if (sections.length === 0) {
      host.createDiv({
        cls: "folder-routines-error",
        text: "Folder Routines: no routine notes found.",
      });
      return;
    }

    const weekdays = ["S", "M", "T", "W", "T", "F", "S"];

    sections.forEach((section, sectionIndex) => {
      const colorIndex = sectionIndex % FolderRoutinesPlugin.SECTION_COLORS;
      const board = host.createDiv({
        cls: `folder-routines-section routine-stats-board folder-routines-color-${
          colorIndex + 1
        }`,
      });

      /* ---- gather per-day / per-routine data ---- */
      const rows = section.files.map((file) => {
        const dates = this.getEntryDates(file);
        const flags = dateStrs.map((ds) => dates.has(ds));
        return { file, flags, done: flags.filter(Boolean).length };
      });

      const perDay = dateStrs.map(
        (_, di) => rows.filter((r) => r.flags[di]).length
      );
      const sectionDone = rows.reduce((s, r) => s + r.done, 0);
      const sectionTotal = section.files.length * days || 1;
      const pct = Math.round((sectionDone / sectionTotal) * 100);
      const rank = this.rankFor(pct);
      const xp = sectionDone * 5;
      const level = Math.max(1, Math.floor(xp / 100) + 1);

      // section-level streaks: a "perfect day" = all routines done that day
      const perfectDay = perDay.map((v) => v === section.files.length && v > 0);
      const curStreak = this.currentStreak(perfectDay);
      const bestStreak = Math.max(
        ...rows.map((r) => this.bestStreak(r.flags)),
        this.bestStreak(perfectDay)
      );
      const missed = sectionTotal - sectionDone;

      /* ---- header with metadata ---- */
      const header = board.createDiv({ cls: "folder-routines-heading routine-stats-head" });
      header.createSpan({
        cls: "folder-routines-banner",
        text: this.getCategoryIcon(section.name),
      });
      const headMain = header.createDiv({ cls: "routine-stats-head-main" });
      headMain.createSpan({
        cls: "folder-routines-heading-title",
        text: section.name,
      });
      const headMeta = headMain.createDiv({ cls: "routine-stats-head-meta" });
      headMeta.createSpan({ cls: "routine-stats-lvl", text: `LV.${level}` });
      headMeta.createSpan({ text: `🔥 ${curStreak}` });
      headMeta.createSpan({ text: `${pct}%` });
      header.createDiv({ cls: "routine-stats-rank", text: rank });

      /* ---- summary stat bar ---- */
      const summary = board.createDiv({ cls: "routine-stats-summary" });
      const stat = (icon: string, label: string, value: string, mod = "") => {
        const s = summary.createDiv({ cls: `routine-stats-stat ${mod}` });
        s.createSpan({ cls: "routine-stats-stat-icon", text: icon });
        const b = s.createDiv({ cls: "routine-stats-stat-body" });
        b.createSpan({ cls: "routine-stats-stat-label", text: label });
        b.createSpan({ cls: "routine-stats-stat-value", text: value });
      };
      stat("🔥", "BEST", String(bestStreak), "is-best");
      stat("⚡", "STREAK", String(curStreak), "is-streak");
      stat("🏆", "DONE", `${pct}%`, "is-done");
      stat("⭐", "XP", `+${xp}`, "is-xp");

      /* ---- completion HUD ---- */
      const hud = board.createDiv({ cls: "routine-stats-hud" });
      hud.createSpan({ cls: "routine-stats-hud-label", text: "COMPLETION" });
      const hudBar = hud.createDiv({ cls: "routine-stats-hud-bar" });
      const hudBlocks = 10;
      const hudFilled = Math.round((pct / 100) * hudBlocks);
      for (let i = 0; i < hudBlocks; i++) {
        const blk = hudBar.createDiv({ cls: "routine-stats-hud-block" });
        blk.toggleClass("is-filled", i < hudFilled);
        blk.style.setProperty("--fr-blk", String(i));
      }
      hud.createSpan({ cls: "routine-stats-hud-pct", text: `${pct}%` });

      /* ---- grid, week-grouped ---- */
      const weeks = Math.ceil(days / 7);
      const grid = board.createDiv({ cls: "routine-stats-grid" });
      grid.style.setProperty("--fr-stats-days", String(days));
      grid.style.setProperty("--fr-stats-weeks", String(weeks));
      // build column template with a spacer column before each new week
      const dayCols: string[] = [];
      for (let di = 0; di < days; di++) {
        if (di % 7 === 0 && di !== 0) dayCols.push("0.4rem");
        dayCols.push("1.15rem");
      }
      grid.style.gridTemplateColumns = `max-content ${dayCols.join(
        " "
      )} auto`;

      // day-of-week header row
      grid.createDiv({ cls: "routine-stats-cell routine-stats-corner" });
      dateStrs.forEach((ds, di) => {
        if (di % 7 === 0 && di !== 0)
          grid.createDiv({ cls: "routine-stats-spacer" });
        const wd = moment(ds, this.settings.storeDateFormat || "YYYY-MM-DD").day();
        const cell = grid.createDiv({
          cls: "routine-stats-cell routine-stats-daylabel",
          text: weekdays[wd],
        });
        if (di === days - 1) cell.addClass("is-today-col");
      });
      grid.createDiv({
        cls: "routine-stats-cell routine-stats-daylabel routine-stats-total-head",
        text: "Σ",
      });

      rows.forEach((row) => {
        grid.createDiv({
          cls: "routine-stats-cell routine-stats-rowlabel",
          text: row.file.basename,
        });
        row.flags.forEach((done, di) => {
          if (di % 7 === 0 && di !== 0)
            grid.createDiv({ cls: "routine-stats-spacer" });
          const cell = grid.createDiv({
            cls: "routine-stats-cell routine-stats-day is-clickable",
          });
          cell.toggleClass("is-done", done);
          if (di === days - 1) cell.addClass("is-today-col");
          const ds = dateStrs[di];
          cell.setAttr("aria-label", `${row.file.basename} · ${ds}`);
          cell.setAttr("role", "button");
          cell.tabIndex = 0;

          const toggle = async () => {
            if (cell.hasClass("is-busy")) return;
            cell.addClass("is-busy");
            const target = !cell.hasClass("is-done");
            // optimistic UI so the clicked cell reflects the change instantly
            cell.toggleClass("is-done", target);
            cell.toggleClass("is-missed", !target);
            try {
              const subtasks = this.getSubtasks(row.file);
              if (subtasks.length > 0) {
                await this.setParentToggleAll(row.file, ds, target, subtasks);
              } else {
                await this.setEntry(row.file, ds, target);
              }
              // wait for the metadata cache to reflect the write, then re-render
              await this.waitForEntryState(row.file, ds, target);
              this.renderStatsBoards(host, root, days);
            } catch (e) {
              console.error("Folder Routines: failed to update entry", e);
              new Notice(`Folder Routines: failed to update ${row.file.basename}`);
              cell.toggleClass("is-done", !target);
              cell.toggleClass("is-missed", target);
              cell.removeClass("is-busy");
            }
          };
          // Tap detection: only toggle if the pointer barely moved between
          // down and up, so vertical/horizontal scrolling isn't hijacked.
          let startX = 0;
          let startY = 0;
          let tracking = false;
          const MOVE_TOLERANCE = 10;
          cell.addEventListener("pointerdown", (evt: PointerEvent) => {
            tracking = true;
            startX = evt.clientX;
            startY = evt.clientY;
          });
          cell.addEventListener("pointermove", (evt: PointerEvent) => {
            if (!tracking) return;
            if (
              Math.abs(evt.clientX - startX) > MOVE_TOLERANCE ||
              Math.abs(evt.clientY - startY) > MOVE_TOLERANCE
            ) {
              tracking = false; // treat as a scroll/drag, not a tap
            }
          });
          cell.addEventListener("pointerup", (evt: PointerEvent) => {
            if (!tracking) return;
            tracking = false;
            if (
              Math.abs(evt.clientX - startX) <= MOVE_TOLERANCE &&
              Math.abs(evt.clientY - startY) <= MOVE_TOLERANCE
            ) {
              toggle();
            }
          });
          cell.addEventListener("pointercancel", () => {
            tracking = false;
          });
          cell.addEventListener("keydown", (evt: KeyboardEvent) => {
            if (evt.key === "Enter" || evt.key === " ") {
              evt.preventDefault();
              toggle();
            }
          });
        });
        grid.createDiv({
          cls: "routine-stats-cell routine-stats-rowtotal",
          text: `${row.done}/${days}`,
        });
      });

      // start scrolled to the far right (most recent days / today)
      window.requestAnimationFrame(() => {
        grid.scrollLeft = grid.scrollWidth;
      });

      /* ---- weekly milestones ---- */
      const milestones = board.createDiv({ cls: "routine-stats-weeks" });
      for (let w = 0; w < weeks; w++) {
        const start = w * 7;
        const end = Math.min(start + 7, days);
        const span = end - start;
        const cellsInWeek = span * section.files.length || 1;
        let weekDone = 0;
        for (let di = start; di < end; di++) weekDone += perDay[di];
        const wpct = Math.round((weekDone / cellsInWeek) * 100);
        const stars = Math.max(0, Math.min(5, Math.round(wpct / 20)));
        const wrank = this.rankFor(wpct);
        const chip = milestones.createDiv({ cls: "routine-stats-week-chip" });
        chip.toggleClass("is-perfect", wpct === 100);
        chip.createSpan({
          cls: "routine-stats-week-name",
          text: `WK ${w + 1}`,
        });
        chip.createSpan({
          cls: "routine-stats-week-stars",
          text: "★".repeat(stars) + "☆".repeat(5 - stars),
        });
        chip.createSpan({
          cls: "routine-stats-week-rank",
          text: wpct === 100 ? "PERFECT" : wrank,
        });
      }

      /* ---- sparkline trend ---- */
      const trend = board.createDiv({ cls: "routine-stats-trend" });
      trend.createSpan({ cls: "routine-stats-trend-label", text: "TREND" });
      trend.createSpan({
        cls: "routine-stats-trend-spark",
        text: this.sparkline(perDay, section.files.length),
      });

      /* ---- footer stats grid ---- */
      const footer = board.createDiv({ cls: "routine-stats-footer" });
      const fstat = (label: string, value: string) => {
        const f = footer.createDiv({ cls: "routine-stats-fstat" });
        f.createSpan({ cls: "routine-stats-fstat-value", text: value });
        f.createSpan({ cls: "routine-stats-fstat-label", text: label });
      };
      fstat("BEST STREAK", `${bestStreak}d`);
      fstat("SUCCESS", `${pct}%`);
      fstat("MISSED", `${missed}`);
      fstat("XP GAINED", `+${xp}`);

      /* ---- achievements ---- */
      const achievements: { icon: string; text: string }[] = [];
      if (sectionDone > 0)
        achievements.push({ icon: "⭐", text: "First Clear" });
      if (curStreak >= 7 || bestStreak >= 7)
        achievements.push({ icon: "⚡", text: "7-Day Streak" });
      if (perfectDay.some((p) => p))
        achievements.push({ icon: "🏆", text: "Perfect Day" });
      if (perfectDay.slice(-7).every((p) => p) && days >= 7)
        achievements.push({ icon: "👑", text: "Perfect Week" });
      if (pct === 100)
        achievements.push({ icon: "💎", text: "100% Complete" });
      if (achievements.length) {
        const ach = board.createDiv({ cls: "routine-stats-achievements" });
        achievements.forEach((a) => {
          const badge = ach.createDiv({ cls: "routine-stats-badge" });
          badge.createSpan({ cls: "routine-stats-badge-icon", text: a.icon });
          badge.createSpan({ cls: "routine-stats-badge-text", text: a.text });
        });
      }

      /* ---- legend ---- */
      const legend = board.createDiv({ cls: "routine-stats-legend" });
      const leg = (cls: string, text: string) => {
        const l = legend.createDiv({ cls: "routine-stats-legend-item" });
        l.createSpan({ cls: `routine-stats-legend-swatch ${cls}` });
        l.createSpan({ text });
      };
      leg("is-done", "Done");
      leg("is-missed", "Missed");
      leg("is-today", "Today");
      leg("is-perfect", "Perfect");
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
