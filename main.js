var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => FolderRoutinesPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  routinesFolder: "Routines",
  entriesProperty: "entries",
  storeDateFormat: "YYYY-MM-DD",
  subtasksProperty: "subtasks",
  subtaskEntriesProperty: "subtaskEntries"
};
function getDailyNoteFormat(app) {
  const anyApp = app;
  try {
    const dn = anyApp.internalPlugins?.getPluginById?.("daily-notes");
    const fmt = dn?.instance?.options?.format;
    if (fmt)
      return fmt;
  } catch (e) {
  }
  try {
    const pn = anyApp.plugins?.getPlugin?.("periodic-notes");
    const fmt = pn?.settings?.daily?.format;
    if (fmt)
      return fmt;
  } catch (e) {
  }
  return "YYYY-MM-DD";
}
var FolderRoutinesPlugin = class extends import_obsidian.Plugin {
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
      editorCallback: (editor, _view) => {
        editor.replaceSelection("```routines\n```\n");
      }
    });
    this.addCommand({
      id: "insert-routine-stats-block",
      name: "Insert routine stats board",
      editorCallback: (editor, _view) => {
        editor.replaceSelection("```routine-stats\n```\n");
      }
    });
    this.addSettingTab(new FolderRoutinesSettingTab(this.app, this));
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  normalizeEntries(val) {
    if (val == null)
      return [];
    if (Array.isArray(val))
      return val.map((v) => String(v));
    return [String(val)];
  }
  getNoteDate(sourcePath) {
    const base = (sourcePath.split("/").pop() ?? "").replace(/\.md$/, "");
    const fmt = getDailyNoteFormat(this.app);
    const m = (0, import_obsidian.moment)(base, fmt, true);
    return m.isValid() ? m : null;
  }
  isChecked(file, dateStr) {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const entries = this.normalizeEntries(fm?.[this.settings.entriesProperty]);
    return entries.includes(dateStr);
  }
  getSubtasks(file) {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    return this.normalizeEntries(fm?.[this.settings.subtasksProperty]).map((s) => s.trim()).filter((s) => s.length > 0);
  }
  normalizeSubtaskEntries(val) {
    const out = {};
    if (val == null || typeof val !== "object" || Array.isArray(val))
      return out;
    for (const [key, v] of Object.entries(val)) {
      out[key] = this.normalizeEntries(v);
    }
    return out;
  }
  isSubtaskChecked(file, name, dateStr) {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const map = this.normalizeSubtaskEntries(fm?.[this.settings.subtaskEntriesProperty]);
    return (map[name] ?? []).includes(dateStr);
  }
  async reconcileSubtaskEntries(file, subtasks) {
    const entriesProp = this.settings.entriesProperty;
    const subProp = this.settings.subtaskEntriesProperty;
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const parentDates = this.normalizeEntries(fm?.[entriesProp]);
    const current = this.normalizeSubtaskEntries(fm?.[subProp]);
    const resolved = {};
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
  async setEntry(file, dateStr, checked) {
    const prop = this.settings.entriesProperty;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      let entries = this.normalizeEntries(fm[prop]);
      if (checked) {
        if (!entries.includes(dateStr))
          entries.push(dateStr);
      } else {
        entries = entries.filter((e) => e !== dateStr);
      }
      entries.sort();
      fm[prop] = entries;
    });
  }
  async setSubtaskEntry(file, name, dateStr, checked, allSubtasks) {
    const entriesProp = this.settings.entriesProperty;
    const subProp = this.settings.subtaskEntriesProperty;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      const map = this.normalizeSubtaskEntries(fm[subProp]);
      let dates = map[name] ?? [];
      if (checked) {
        if (!dates.includes(dateStr))
          dates.push(dateStr);
      } else {
        dates = dates.filter((d) => d !== dateStr);
      }
      dates.sort();
      map[name] = dates;
      const allDone = allSubtasks.every((s) => (map[s] ?? []).includes(dateStr));
      let entries = this.normalizeEntries(fm[entriesProp]);
      if (allDone) {
        if (!entries.includes(dateStr))
          entries.push(dateStr);
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
  async setParentToggleAll(file, dateStr, checked, allSubtasks) {
    const entriesProp = this.settings.entriesProperty;
    const subProp = this.settings.subtaskEntriesProperty;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      const map = this.normalizeSubtaskEntries(fm[subProp]);
      for (const name of allSubtasks) {
        let dates = map[name] ?? [];
        if (checked) {
          if (!dates.includes(dateStr))
            dates.push(dateStr);
        } else {
          dates = dates.filter((d) => d !== dateStr);
        }
        dates.sort();
        map[name] = dates;
      }
      let entries = this.normalizeEntries(fm[entriesProp]);
      if (checked) {
        if (!entries.includes(dateStr))
          entries.push(dateStr);
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
  async renderRoutines(el, ctx) {
    el.empty();
    const root = this.app.vault.getAbstractFileByPath(this.settings.routinesFolder);
    if (!(root instanceof import_obsidian.TFolder)) {
      el.createDiv({
        cls: "folder-routines-error",
        text: `Folder Routines: folder "${this.settings.routinesFolder}" not found. Set it in plugin settings.`
      });
      return;
    }
    const date = this.getNoteDate(ctx.sourcePath);
    if (!date) {
      el.createDiv({
        cls: "folder-routines-error",
        text: "Folder Routines: could not parse a date from this note's filename (expected a daily note)."
      });
      return;
    }
    const dateStr = date.format(this.settings.storeDateFormat || "YYYY-MM-DD");
    const container = el.createDiv({ cls: "folder-routines" });
    const section = container.createDiv({
      cls: "folder-routines-section folder-routines-root"
    });
    const header = section.createEl("h2", { cls: "folder-routines-heading" });
    header.createSpan({ cls: "folder-routines-collapse-icon", text: "\u25BC" });
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
  async renderFolder(folder, container, dateStr, depth) {
    const children = [...folder.children].sort(
      (a, b) => a.name.localeCompare(b.name)
    );
    const files = children.filter(
      (c) => c instanceof import_obsidian.TFile && c.extension === "md"
    );
    const subfolders = children.filter(
      (c) => c instanceof import_obsidian.TFolder
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
      const tag = "h" + Math.min(depth, 6);
      const header = section.createEl(tag, { cls: "folder-routines-heading" });
      header.createSpan({ cls: "folder-routines-collapse-icon", text: "\u25BC" });
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
  createProgress(header) {
    const progress = header.createDiv({ cls: "folder-routines-progress" });
    const badge = progress.createDiv({ cls: "folder-routines-progress-badge" });
    badge.createSpan({ cls: "folder-routines-progress-label", text: "QUESTS" });
    badge.createSpan({ cls: "folder-routines-progress-count", text: "0/0" });
    const bar = progress.createDiv({ cls: "folder-routines-progress-bar" });
    for (let i = 0; i < FolderRoutinesPlugin.PROGRESS_BLOCKS; i++) {
      bar.createDiv({ cls: "folder-routines-progress-block" });
    }
  }
  updateSectionProgress(section) {
    const checkboxes = Array.from(
      section.querySelectorAll(".folder-routines-progress-checkbox")
    );
    const total = checkboxes.length;
    const done = checkboxes.filter((checkbox) => checkbox.checked).length;
    const progress = section.querySelector(
      ":scope > .folder-routines-heading .folder-routines-progress"
    );
    if (!progress)
      return;
    const count = progress.querySelector(".folder-routines-progress-count");
    if (count)
      count.setText(`${done}/${total}`);
    const blocks = Array.from(
      progress.querySelectorAll(".folder-routines-progress-block")
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
  showQuestBanner(section) {
    const header = section.querySelector(
      ":scope > .folder-routines-heading"
    );
    if (!header)
      return;
    const banner = header.createDiv({
      cls: "folder-routines-quest-banner",
      text: "\u2605 QUEST COMPLETE \u2605"
    });
    window.setTimeout(() => banner.remove(), 1600);
  }
  showXpPopup(host) {
    const popup = host.createSpan({
      cls: "folder-routines-xp-popup",
      text: "+5 XP"
    });
    window.setTimeout(() => popup.remove(), 900);
  }
  wireSelection(itemEl) {
    const select = () => {
      const root = itemEl.closest(".folder-routines");
      root?.querySelectorAll(".is-selected").forEach((n) => n.removeClass("is-selected"));
      itemEl.addClass("is-selected");
    };
    itemEl.addEventListener("pointerdown", select);
    itemEl.addEventListener("focusin", select);
  }
  getCategoryIcon(_name) {
    return "\u25C6";
  }
  updateAncestorProgress(from) {
    let section = from.closest(".folder-routines-section");
    while (section) {
      this.updateSectionProgress(section);
      section = section.parentElement?.closest(".folder-routines-section") ?? null;
    }
  }
  async renderItem(file, container, dateStr, index = 0) {
    const subtasks = this.getSubtasks(file);
    const itemEl = container.createDiv({ cls: "folder-routines-item" });
    itemEl.tabIndex = 0;
    this.wireSelection(itemEl);
    const label = itemEl.createEl("label", { cls: "folder-routines-label" });
    if (index > 0) {
      label.createSpan({
        cls: "folder-routines-index",
        text: String(index).padStart(2, "0")
      });
    }
    const checkbox = label.createEl("input", {
      type: "checkbox"
    });
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
          if (target)
            this.showXpPopup(itemEl);
        } catch (e) {
          console.error("Folder Routines: failed to update frontmatter", e);
          new import_obsidian.Notice(`Folder Routines: failed to update ${file.basename}`);
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
    const subEls = [];
    const refreshParent = () => {
      const allChecked = subEls.every((s) => s.checkbox.checked);
      checkbox.checked = allChecked;
      itemEl.toggleClass("is-checked", allChecked);
    };
    const setAllDisabled = (disabled) => {
      checkbox.disabled = disabled;
      for (const s of subEls)
        s.checkbox.disabled = disabled;
    };
    const resolved = await this.reconcileSubtaskEntries(file, subtasks);
    subtasks.forEach((name, subIndex) => {
      const subItem = subContainer.createDiv({ cls: "folder-routines-subtask" });
      subItem.tabIndex = 0;
      this.wireSelection(subItem);
      if (subIndex === subtasks.length - 1)
        subItem.addClass("is-last");
      const subLabel = subItem.createEl("label", { cls: "folder-routines-label" });
      subLabel.createSpan({ cls: "folder-routines-tree", text: "" });
      const subCheckbox = subLabel.createEl("input", {
        type: "checkbox"
      });
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
          if (target)
            this.showXpPopup(subItem);
          refreshParent();
        } catch (e) {
          console.error("Folder Routines: failed to update frontmatter", e);
          new import_obsidian.Notice(`Folder Routines: failed to update ${file.basename}`);
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
        new import_obsidian.Notice(`Folder Routines: failed to update ${file.basename}`);
        checkbox.checked = !target;
      } finally {
        setAllDisabled(false);
        this.updateAncestorProgress(itemEl);
      }
    });
  }
  getEntryDates(file) {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    return new Set(this.normalizeEntries(fm?.[this.settings.entriesProperty]));
  }
  async waitForEntryState(file, dateStr, expected, tries = 20) {
    for (let i = 0; i < tries; i++) {
      if (this.getEntryDates(file).has(dateStr) === expected)
        return;
      await new Promise((r) => window.setTimeout(r, 25));
    }
  }
  collectSectionFiles(folder) {
    return [...folder.children].filter(
      (c) => c instanceof import_obsidian.TFile && c.extension === "md"
    ).sort((a, b) => a.name.localeCompare(b.name));
  }
  bestStreak(flags) {
    let best = 0;
    let run = 0;
    for (const f of flags) {
      run = f ? run + 1 : 0;
      if (run > best)
        best = run;
    }
    return best;
  }
  currentStreak(flags) {
    let run = 0;
    for (let i = flags.length - 1; i >= 0; i--) {
      if (flags[i])
        run++;
      else
        break;
    }
    return run;
  }
  rankFor(pct) {
    if (pct >= 95)
      return "S";
    if (pct >= 85)
      return "A";
    if (pct >= 70)
      return "B";
    if (pct >= 50)
      return "C";
    if (pct >= 25)
      return "D";
    return "E";
  }
  sparkline(perDay, routines) {
    const glyphs = ["\u2581", "\u2582", "\u2583", "\u2584", "\u2585", "\u2586", "\u2587", "\u2588"];
    if (routines <= 0)
      return "";
    return perDay.map((v) => {
      const ratio = Math.max(0, Math.min(1, v / routines));
      const idx = v === 0 ? 0 : Math.max(1, Math.round(ratio * (glyphs.length - 1)));
      return glyphs[idx];
    }).join("");
  }
  async renderStats(source, el) {
    el.empty();
    const root = this.app.vault.getAbstractFileByPath(this.settings.routinesFolder);
    if (!(root instanceof import_obsidian.TFolder)) {
      el.createDiv({
        cls: "folder-routines-error",
        text: `Folder Routines: folder "${this.settings.routinesFolder}" not found. Set it in plugin settings.`
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
  renderStatsBoards(host, root, days) {
    host.empty();
    const today = (0, import_obsidian.moment)().startOf("day");
    const dateStrs = [];
    const labels = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = today.clone().subtract(i, "days");
      dateStrs.push(d.format(this.settings.storeDateFormat || "YYYY-MM-DD"));
      labels.push(d.format("D"));
    }
    const sections = [];
    const rootFiles = this.collectSectionFiles(root);
    if (rootFiles.length)
      sections.push({ name: root.name, files: rootFiles });
    const subfolders = [...root.children].filter(
      (c) => c instanceof import_obsidian.TFolder
    ).sort((a, b) => a.name.localeCompare(b.name));
    for (const sub of subfolders) {
      const files = this.collectSectionFiles(sub);
      if (files.length)
        sections.push({ name: sub.name, files });
    }
    if (sections.length === 0) {
      host.createDiv({
        cls: "folder-routines-error",
        text: "Folder Routines: no routine notes found."
      });
      return;
    }
    const weekdays = ["S", "M", "T", "W", "T", "F", "S"];
    sections.forEach((section, sectionIndex) => {
      const colorIndex = sectionIndex % FolderRoutinesPlugin.SECTION_COLORS;
      const board = host.createDiv({
        cls: `folder-routines-section routine-stats-board folder-routines-color-${colorIndex + 1}`
      });
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
      const pct = Math.round(sectionDone / sectionTotal * 100);
      const rank = this.rankFor(pct);
      const xp = sectionDone * 5;
      const level = Math.max(1, Math.floor(xp / 100) + 1);
      const perfectDay = perDay.map((v) => v === section.files.length && v > 0);
      const curStreak = this.currentStreak(perfectDay);
      const bestStreak = Math.max(
        ...rows.map((r) => this.bestStreak(r.flags)),
        this.bestStreak(perfectDay)
      );
      const missed = sectionTotal - sectionDone;
      const header = board.createDiv({ cls: "folder-routines-heading routine-stats-head" });
      header.createSpan({
        cls: "folder-routines-banner",
        text: this.getCategoryIcon(section.name)
      });
      const headMain = header.createDiv({ cls: "routine-stats-head-main" });
      headMain.createSpan({
        cls: "folder-routines-heading-title",
        text: section.name
      });
      const headMeta = headMain.createDiv({ cls: "routine-stats-head-meta" });
      headMeta.createSpan({ cls: "routine-stats-lvl", text: `LV.${level}` });
      headMeta.createSpan({ text: `\u{1F525} ${curStreak}` });
      headMeta.createSpan({ text: `${pct}%` });
      header.createDiv({ cls: "routine-stats-rank", text: rank });
      const summary = board.createDiv({ cls: "routine-stats-summary" });
      const stat = (icon, label, value, mod = "") => {
        const s = summary.createDiv({ cls: `routine-stats-stat ${mod}` });
        s.createSpan({ cls: "routine-stats-stat-icon", text: icon });
        const b = s.createDiv({ cls: "routine-stats-stat-body" });
        b.createSpan({ cls: "routine-stats-stat-label", text: label });
        b.createSpan({ cls: "routine-stats-stat-value", text: value });
      };
      stat("\u{1F525}", "BEST", String(bestStreak), "is-best");
      stat("\u26A1", "STREAK", String(curStreak), "is-streak");
      stat("\u{1F3C6}", "DONE", `${pct}%`, "is-done");
      stat("\u2B50", "XP", `+${xp}`, "is-xp");
      const hud = board.createDiv({ cls: "routine-stats-hud" });
      hud.createSpan({ cls: "routine-stats-hud-label", text: "COMPLETION" });
      const hudBar = hud.createDiv({ cls: "routine-stats-hud-bar" });
      const hudBlocks = 10;
      const hudFilled = Math.round(pct / 100 * hudBlocks);
      for (let i = 0; i < hudBlocks; i++) {
        const blk = hudBar.createDiv({ cls: "routine-stats-hud-block" });
        blk.toggleClass("is-filled", i < hudFilled);
        blk.style.setProperty("--fr-blk", String(i));
      }
      hud.createSpan({ cls: "routine-stats-hud-pct", text: `${pct}%` });
      const weeks = Math.ceil(days / 7);
      const grid = board.createDiv({ cls: "routine-stats-grid" });
      grid.style.setProperty("--fr-stats-days", String(days));
      grid.style.setProperty("--fr-stats-weeks", String(weeks));
      const dayCols = [];
      for (let di = 0; di < days; di++) {
        if (di % 7 === 0 && di !== 0)
          dayCols.push("0.4rem");
        dayCols.push("1.15rem");
      }
      grid.style.gridTemplateColumns = `minmax(3.5rem, 6rem) ${dayCols.join(" ")} auto`;
      grid.createDiv({ cls: "routine-stats-cell routine-stats-corner" });
      dateStrs.forEach((ds, di) => {
        if (di % 7 === 0 && di !== 0)
          grid.createDiv({ cls: "routine-stats-spacer" });
        const wd = (0, import_obsidian.moment)(ds, this.settings.storeDateFormat || "YYYY-MM-DD").day();
        const cell = grid.createDiv({
          cls: "routine-stats-cell routine-stats-daylabel",
          text: weekdays[wd]
        });
        if (di === days - 1)
          cell.addClass("is-today-col");
      });
      grid.createDiv({
        cls: "routine-stats-cell routine-stats-daylabel routine-stats-total-head",
        text: "\u03A3"
      });
      rows.forEach((row) => {
        grid.createDiv({
          cls: "routine-stats-cell routine-stats-rowlabel",
          text: row.file.basename
        });
        row.flags.forEach((done, di) => {
          if (di % 7 === 0 && di !== 0)
            grid.createDiv({ cls: "routine-stats-spacer" });
          const cell = grid.createDiv({
            cls: "routine-stats-cell routine-stats-day is-clickable"
          });
          cell.toggleClass("is-done", done);
          if (di === days - 1)
            cell.addClass("is-today-col");
          const ds = dateStrs[di];
          cell.setAttr("aria-label", `${row.file.basename} \u00B7 ${ds}`);
          cell.setAttr("role", "button");
          cell.tabIndex = 0;
          const toggle = async () => {
            if (cell.hasClass("is-busy"))
              return;
            cell.addClass("is-busy");
            const target = !cell.hasClass("is-done");
            cell.toggleClass("is-done", target);
            cell.toggleClass("is-missed", !target);
            try {
              const subtasks = this.getSubtasks(row.file);
              if (subtasks.length > 0) {
                await this.setParentToggleAll(row.file, ds, target, subtasks);
              } else {
                await this.setEntry(row.file, ds, target);
              }
              await this.waitForEntryState(row.file, ds, target);
              this.renderStatsBoards(host, root, days);
            } catch (e) {
              console.error("Folder Routines: failed to update entry", e);
              new import_obsidian.Notice(`Folder Routines: failed to update ${row.file.basename}`);
              cell.toggleClass("is-done", !target);
              cell.toggleClass("is-missed", target);
              cell.removeClass("is-busy");
            }
          };
          let startX = 0;
          let startY = 0;
          let tracking = false;
          const MOVE_TOLERANCE = 10;
          cell.addEventListener("pointerdown", (evt) => {
            tracking = true;
            startX = evt.clientX;
            startY = evt.clientY;
          });
          cell.addEventListener("pointermove", (evt) => {
            if (!tracking)
              return;
            if (Math.abs(evt.clientX - startX) > MOVE_TOLERANCE || Math.abs(evt.clientY - startY) > MOVE_TOLERANCE) {
              tracking = false;
            }
          });
          cell.addEventListener("pointerup", (evt) => {
            if (!tracking)
              return;
            tracking = false;
            if (Math.abs(evt.clientX - startX) <= MOVE_TOLERANCE && Math.abs(evt.clientY - startY) <= MOVE_TOLERANCE) {
              toggle();
            }
          });
          cell.addEventListener("pointercancel", () => {
            tracking = false;
          });
          cell.addEventListener("keydown", (evt) => {
            if (evt.key === "Enter" || evt.key === " ") {
              evt.preventDefault();
              toggle();
            }
          });
        });
        grid.createDiv({
          cls: "routine-stats-cell routine-stats-rowtotal",
          text: `${row.done}/${days}`
        });
      });
      const milestones = board.createDiv({ cls: "routine-stats-weeks" });
      for (let w = 0; w < weeks; w++) {
        const start = w * 7;
        const end = Math.min(start + 7, days);
        const span = end - start;
        const cellsInWeek = span * section.files.length || 1;
        let weekDone = 0;
        for (let di = start; di < end; di++)
          weekDone += perDay[di];
        const wpct = Math.round(weekDone / cellsInWeek * 100);
        const stars = Math.max(0, Math.min(5, Math.round(wpct / 20)));
        const wrank = this.rankFor(wpct);
        const chip = milestones.createDiv({ cls: "routine-stats-week-chip" });
        chip.toggleClass("is-perfect", wpct === 100);
        chip.createSpan({
          cls: "routine-stats-week-name",
          text: `WK ${w + 1}`
        });
        chip.createSpan({
          cls: "routine-stats-week-stars",
          text: "\u2605".repeat(stars) + "\u2606".repeat(5 - stars)
        });
        chip.createSpan({
          cls: "routine-stats-week-rank",
          text: wpct === 100 ? "PERFECT" : wrank
        });
      }
      const trend = board.createDiv({ cls: "routine-stats-trend" });
      trend.createSpan({ cls: "routine-stats-trend-label", text: "TREND" });
      trend.createSpan({
        cls: "routine-stats-trend-spark",
        text: this.sparkline(perDay, section.files.length)
      });
      const footer = board.createDiv({ cls: "routine-stats-footer" });
      const fstat = (label, value) => {
        const f = footer.createDiv({ cls: "routine-stats-fstat" });
        f.createSpan({ cls: "routine-stats-fstat-value", text: value });
        f.createSpan({ cls: "routine-stats-fstat-label", text: label });
      };
      fstat("BEST STREAK", `${bestStreak}d`);
      fstat("SUCCESS", `${pct}%`);
      fstat("MISSED", `${missed}`);
      fstat("XP GAINED", `+${xp}`);
      const achievements = [];
      if (sectionDone > 0)
        achievements.push({ icon: "\u2B50", text: "First Clear" });
      if (curStreak >= 7 || bestStreak >= 7)
        achievements.push({ icon: "\u26A1", text: "7-Day Streak" });
      if (perfectDay.some((p) => p))
        achievements.push({ icon: "\u{1F3C6}", text: "Perfect Day" });
      if (perfectDay.slice(-7).every((p) => p) && days >= 7)
        achievements.push({ icon: "\u{1F451}", text: "Perfect Week" });
      if (pct === 100)
        achievements.push({ icon: "\u{1F48E}", text: "100% Complete" });
      if (achievements.length) {
        const ach = board.createDiv({ cls: "routine-stats-achievements" });
        achievements.forEach((a) => {
          const badge = ach.createDiv({ cls: "routine-stats-badge" });
          badge.createSpan({ cls: "routine-stats-badge-icon", text: a.icon });
          badge.createSpan({ cls: "routine-stats-badge-text", text: a.text });
        });
      }
      const legend = board.createDiv({ cls: "routine-stats-legend" });
      const leg = (cls, text) => {
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
};
FolderRoutinesPlugin.PROGRESS_BLOCKS = 10;
FolderRoutinesPlugin.SECTION_COLORS = 5;
var FolderRoutinesSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("Routines folder").setDesc("Vault-relative path to the root folder (e.g. Routines).").addText(
      (text) => text.setPlaceholder("Routines").setValue(this.plugin.settings.routinesFolder).onChange(async (value) => {
        this.plugin.settings.routinesFolder = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Entries property").setDesc("Frontmatter property updated when an item is checked.").addText(
      (text) => text.setPlaceholder("entries").setValue(this.plugin.settings.entriesProperty).onChange(async (value) => {
        this.plugin.settings.entriesProperty = value.trim() || "entries";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Stored date format").setDesc("Moment format used for the date written into 'entries'.").addText(
      (text) => text.setPlaceholder("YYYY-MM-DD").setValue(this.plugin.settings.storeDateFormat).onChange(async (value) => {
        this.plugin.settings.storeDateFormat = value.trim() || "YYYY-MM-DD";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Subtasks property").setDesc("Frontmatter property that lists a note's subtasks.").addText(
      (text) => text.setPlaceholder("subtasks").setValue(this.plugin.settings.subtasksProperty).onChange(async (value) => {
        this.plugin.settings.subtasksProperty = value.trim() || "subtasks";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Subtask entries property").setDesc("Frontmatter property where per-subtask completion dates are stored.").addText(
      (text) => text.setPlaceholder("subtaskEntries").setValue(this.plugin.settings.subtaskEntriesProperty).onChange(async (value) => {
        this.plugin.settings.subtaskEntriesProperty = value.trim() || "subtaskEntries";
        await this.plugin.saveSettings();
      })
    );
  }
};
