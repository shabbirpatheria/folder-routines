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
  hideRoutineNumbering: false,
  entriesProperty: "entries",
  storeDateFormat: "YYYY-MM-DD",
  subtasksProperty: "subtasks",
  subtaskEntriesProperty: "subtaskEntries",
  pixelCalendarProperty: "pixelCalendarPlan",
  pixelCalendarTasksProperty: "pixelCalendarTasks",
  pixelCalendarTimesProperty: "pixelCalendarTimes",
  calendarStartTime: "00:00"
};
var SLOT_MINUTES = 30;
var MIN_DURATION = 30;
var RESIZE_STEP = 30;
var MAX_COLUMNS = 2;
var MAX_BANDS = 8;
var DAY_MINUTES = 24 * 60;
var SUBTASK_SEP = "::";
var CUSTOM_REF_PREFIX = "custom:";
function clampMinute(v) {
  return Math.max(0, Math.min(DAY_MINUTES, Math.round(v)));
}
function formatHM(min) {
  const m = clampMinute(min);
  const h = Math.floor(m / 60);
  return String(h === 24 ? 24 : h).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
}
function parseHM(text) {
  const s = String(text ?? "").trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m)
    return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm) || mm > 59 || h > 24)
    return null;
  return clampMinute(h * 60 + mm);
}
function snapToSlot(min) {
  const snapped = Math.floor(Math.min(min, DAY_MINUTES - SLOT_MINUTES) / SLOT_MINUTES) * SLOT_MINUTES;
  return Math.max(0, snapped);
}
function slotKeyForMinutes(min) {
  return formatHM(snapToSlot(min));
}
function makeRef(path, subtask) {
  return subtask != null && subtask !== "" ? path + SUBTASK_SEP + subtask : path;
}
function parseRef(ref) {
  const idx = ref.indexOf(SUBTASK_SEP);
  if (idx === -1)
    return { path: ref, subtask: null };
  return { path: ref.slice(0, idx), subtask: ref.slice(idx + SUBTASK_SEP.length) };
}
function isCustomRef(ref) {
  return ref.startsWith(CUSTOM_REF_PREFIX);
}
function makeCustomRef(id) {
  return CUSTOM_REF_PREFIX + id;
}
function customRefId(ref) {
  return ref.slice(CUSTOM_REF_PREFIX.length);
}
function newCustomTaskId() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
}
function buildSlotKeys(startMin = 0) {
  const keys = [];
  for (let m = snapToSlot(startMin); m < 24 * 60; m += SLOT_MINUTES) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    keys.push(String(h).padStart(2, "0") + ":" + String(mm).padStart(2, "0"));
  }
  return keys;
}
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
var _FolderRoutinesPlugin = class _FolderRoutinesPlugin extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    /* ============================================================
       Live sync between blocks
       ============================================================ */
    this.changeListeners = /* @__PURE__ */ new Set();
    this.blockSeq = 0;
  }
  async onload() {
    await this.loadSettings();
    this.registerMarkdownCodeBlockProcessor(
      "routines",
      (source, el, ctx) => this.renderRoutines(el, ctx)
    );
    this.registerMarkdownCodeBlockProcessor(
      "routine-stats",
      (source, el, ctx) => this.renderStats(source, el, ctx)
    );
    this.registerMarkdownCodeBlockProcessor(
      "pixel-calendar",
      (source, el, ctx) => this.renderPixelCalendar(el, ctx)
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
    this.addCommand({
      id: "insert-pixel-calendar-block",
      name: "Insert pixel calendar block",
      editorCallback: (editor, _view) => {
        editor.replaceSelection("```pixel-calendar\n```\n");
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
  trackingPropertyNames() {
    return [
      this.settings.entriesProperty,
      this.settings.subtaskEntriesProperty,
      this.settings.pixelCalendarProperty,
      this.settings.pixelCalendarTasksProperty,
      this.settings.pixelCalendarTimesProperty
    ].filter((name, index, names) => name.length > 0 && names.indexOf(name) === index);
  }
  async resetTrackingData() {
    const properties = this.trackingPropertyNames();
    const files = this.app.vault.getMarkdownFiles().filter((file) => {
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      return frontmatter != null && properties.some(
        (property) => Object.prototype.hasOwnProperty.call(frontmatter, property)
      );
    });
    let filesCleared = 0;
    let propertiesCleared = 0;
    const failedFiles = [];
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
          `Folder Routines: failed to reset tracking data in ${file.path}`,
          error
        );
      }
    }
    return { filesCleared, propertiesCleared, failedFiles };
  }
  /* First minute the calendar shows, snapped down to a slot boundary. An
     unreadable setting falls back to midnight. */
  calendarStartMinutes() {
    return snapToSlot(parseHM(this.settings.calendarStartTime) ?? 0);
  }
  /* The configured routines folder, or null when it no longer exists. The
     picker stores the vault root as "/", which is not a normal folder path. */
  routinesRoot() {
    const path = this.settings.routinesFolder;
    const vaultRoot = this.app.vault.getRoot();
    if (path === "/" || path === vaultRoot.path)
      return vaultRoot;
    const folder = this.app.vault.getAbstractFileByPath(path);
    return folder instanceof import_obsidian.TFolder ? folder : null;
  }
  /* Every folder in the vault, each parent listed before its children, so the
     settings picker reads like the file explorer. */
  allFolderPaths() {
    const out = [];
    const walk = (folder) => {
      out.push(folder.path);
      const subs = folder.children.filter((c) => c instanceof import_obsidian.TFolder).sort((a, b) => a.name.localeCompare(b.name));
      for (const sub of subs)
        walk(sub);
    };
    walk(this.app.vault.getRoot());
    return out;
  }
  displayName(name) {
    if (!this.settings.hideRoutineNumbering)
      return name;
    const withoutNumbering = name.replace(/^\s*\d+[.)]\s+/, "");
    return withoutNumbering || name;
  }
  nextBlockId() {
    this.blockSeq += 1;
    return `fr-block-${this.blockSeq}`;
  }
  /* Register a listener bound to a rendered code block: it is dropped as soon
     as Obsidian unloads that block's element. */
  registerBlockListener(el, ctx, listener) {
    this.changeListeners.add(listener);
    const child = new import_obsidian.MarkdownRenderChild(el);
    child.register(() => this.changeListeners.delete(listener));
    ctx.addChild(child);
  }
  emitRoutineChange(e) {
    for (const listener of [...this.changeListeners]) {
      try {
        listener(e);
      } catch (err) {
        console.error("Folder Routines: sync listener failed", err);
      }
    }
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
      for (const d of parentDates)
        set.add(d);
      if (set.size !== before)
        changed = true;
      resolved[name] = [...set].sort();
    }
    if (changed) {
      await this.app.fileManager.processFrontMatter(file, (fmw) => {
        const pDates = this.normalizeEntries(fmw[entriesProp]);
        const map = this.normalizeSubtaskEntries(fmw[subProp]);
        for (const name of subtasks) {
          const set = new Set(map[name] ?? []);
          for (const d of pDates)
            set.add(d);
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
    let parentChecked = false;
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
      parentChecked = allDone;
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
    return parentChecked;
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
    const root = this.routinesRoot();
    if (!root) {
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
    header.createSpan({ cls: "folder-routines-heading-title", text: "Habits" });
    this.createProgress(header);
    const body = section.createDiv({ cls: "folder-routines-body" });
    const sync = { id: this.nextBlockId(), setters: /* @__PURE__ */ new Map() };
    await this.renderFolder(root, body, dateStr, 3, sync);
    this.updateSectionProgress(section);
    this.registerBlockListener(el, ctx, (ev) => {
      if (ev.originId === sync.id || ev.dateStr !== dateStr)
        return;
      sync.setters.get(makeRef(ev.path, ev.subtask))?.(ev.checked);
    });
    header.addEventListener("click", () => {
      section.toggleClass("is-collapsed", !section.hasClass("is-collapsed"));
    });
  }
  async renderFolder(folder, container, dateStr, depth, sync) {
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
      await this.renderItem(file, container, dateStr, index, sync);
    }
    for (let sectionIndex = 0; sectionIndex < subfolders.length; sectionIndex++) {
      const sub = subfolders[sectionIndex];
      const section = container.createDiv({ cls: "folder-routines-section" });
      const colorIndex = sectionIndex % _FolderRoutinesPlugin.SECTION_COLORS;
      section.addClass(`folder-routines-color-${colorIndex + 1}`);
      const tag = "h" + Math.min(depth, 6);
      const header = section.createEl(tag, { cls: "folder-routines-heading" });
      header.createSpan({
        cls: "folder-routines-heading-title",
        text: this.displayName(sub.name)
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
  createProgress(header) {
    const progress = header.createDiv({ cls: "folder-routines-progress" });
    const badge = progress.createDiv({ cls: "folder-routines-progress-badge" });
    badge.createSpan({ cls: "folder-routines-progress-label", text: "QUESTS" });
    badge.createSpan({ cls: "folder-routines-progress-count", text: "0/0" });
    const bar = progress.createDiv({ cls: "folder-routines-progress-bar" });
    bar.createDiv({ cls: "folder-routines-progress-fill" });
  }
  onAnimationComplete(element, animationName, complete) {
    let completed = false;
    const finish = (event) => {
      if (event && (event.target !== element || event.animationName !== animationName))
        return;
      if (completed)
        return;
      completed = true;
      element.removeEventListener("animationend", finish);
      element.removeEventListener("animationcancel", finish);
      complete();
    };
    element.addEventListener("animationend", finish);
    element.addEventListener("animationcancel", finish);
    const activeAnimations = window.getComputedStyle(element).animationName.split(",").map((name) => name.trim());
    if (!activeAnimations.includes(animationName))
      finish();
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
    const fill = progress.querySelector(".folder-routines-progress-fill");
    const ratio = total === 0 ? 0 : done / total;
    if (fill)
      fill.style.setProperty("--fr-progress", `${ratio * 100}%`);
    const wasComplete = section.hasClass("is-complete");
    const isComplete = total > 0 && done === total;
    section.toggleClass("is-complete", isComplete);
    if (isComplete && !wasComplete) {
      section.addClass("is-just-completed");
      const header = section.querySelector(
        ":scope > .folder-routines-heading"
      );
      if (header) {
        this.onAnimationComplete(
          header,
          "fr-section-flash",
          () => section.removeClass("is-just-completed")
        );
      } else {
        section.removeClass("is-just-completed");
      }
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
    this.onAnimationComplete(banner, "fr-banner", () => banner.remove());
  }
  showXpPopup(host) {
    const popup = host.createSpan({
      cls: "folder-routines-xp-popup",
      text: "+5 XP"
    });
    this.onAnimationComplete(popup, "fr-xp", () => popup.remove());
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
  wireSelection(itemEl) {
    const select = () => {
      const root = itemEl.closest(".folder-routines");
      root?.querySelectorAll(".is-selected").forEach((n) => n.removeClass("is-selected"));
      itemEl.addClass("is-selected");
    };
    itemEl.addEventListener("pointerdown", select);
    itemEl.addEventListener("focusin", select);
  }
  async renderItem(file, container, dateStr, index = 0, sync) {
    const subtasks = this.getSubtasks(file);
    const itemEl = container.createDiv({ cls: "folder-routines-item" });
    itemEl.tabIndex = 0;
    this.wireSelection(itemEl);
    const label = itemEl.createEl("label", { cls: "folder-routines-label" });
    if (index > 0 && !this.settings.hideRoutineNumbering) {
      label.createSpan({
        cls: "folder-routines-index",
        text: String(index).padStart(2, "0")
      });
    }
    const checkbox = label.createEl("input", {
      type: "checkbox"
    });
    checkbox.classList.add("folder-routines-checkbox");
    label.createSpan({
      text: this.displayName(file.basename),
      cls: "folder-routines-text"
    });
    if (subtasks.length === 0) {
      checkbox.classList.add("folder-routines-progress-checkbox");
      checkbox.checked = this.isChecked(file, dateStr);
      itemEl.toggleClass("is-checked", checkbox.checked);
      sync?.setters.set(file.path, (checked) => {
        if (checkbox.checked === checked)
          return;
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
          if (target)
            this.showXpPopup(itemEl);
          this.emitRoutineChange({
            dateStr,
            path: file.path,
            subtask: null,
            checked: target,
            parentChecked: target,
            subtasks: [],
            originId: sync?.id ?? ""
          });
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
      sync?.setters.set(makeRef(file.path, name), (checked) => {
        if (subCheckbox.checked === checked)
          return;
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
          if (target)
            this.showXpPopup(subItem);
          refreshParent();
          this.emitRoutineChange({
            dateStr,
            path: file.path,
            subtask: name,
            checked: target,
            parentChecked,
            subtasks,
            originId: sync?.id ?? ""
          });
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
          originId: sync?.id ?? ""
        });
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
  /* ============================================================
     Pixel calendar (```pixel-calendar```)
     ============================================================ */
  loadPlan(file) {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const raw = fm?.[this.settings.pixelCalendarProperty];
    const out = {};
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw)) {
        out[k] = this.normalizeEntries(v);
      }
    }
    return out;
  }
  async savePlanState(file, plan, tasks, spans) {
    const planProp = this.settings.pixelCalendarProperty;
    const taskProp = this.settings.pixelCalendarTasksProperty;
    const timeProp = this.settings.pixelCalendarTimesProperty;
    const scheduled = /* @__PURE__ */ new Set();
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      const cleanPlan = {};
      for (const [k, v] of Object.entries(plan)) {
        if (Array.isArray(v) && v.length > 0) {
          cleanPlan[k] = [...v];
          for (const ref of v)
            scheduled.add(ref);
        }
      }
      if (Object.keys(cleanPlan).length === 0) {
        delete fm[planProp];
      } else {
        fm[planProp] = cleanPlan;
      }
      const cleanTasks = {};
      for (const [id, task] of Object.entries(tasks)) {
        if (task && task.title.trim().length > 0) {
          cleanTasks[id] = { title: task.title, done: task.done === true };
        }
      }
      if (Object.keys(cleanTasks).length === 0) {
        delete fm[taskProp];
      } else {
        fm[taskProp] = cleanTasks;
      }
      const cleanSpans = {};
      for (const [ref, span] of Object.entries(spans)) {
        if (!scheduled.has(ref) || !span)
          continue;
        const isDefault = span.start % SLOT_MINUTES === 0 && span.end - span.start === SLOT_MINUTES;
        if (isDefault)
          continue;
        cleanSpans[ref] = { start: formatHM(span.start), end: formatHM(span.end) };
      }
      if (Object.keys(cleanSpans).length === 0) {
        delete fm[timeProp];
      } else {
        fm[timeProp] = cleanSpans;
      }
    });
  }
  loadTimeSpans(file) {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const raw = fm?.[this.settings.pixelCalendarTimesProperty];
    const out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      return out;
    for (const [ref, value] of Object.entries(raw)) {
      if (!value || typeof value !== "object" || Array.isArray(value))
        continue;
      const obj = value;
      const start = parseHM(obj.start);
      const end = parseHM(obj.end);
      if (start == null || end == null)
        continue;
      out[ref] = { start, end: Math.max(end, start + MIN_DURATION) };
    }
    return out;
  }
  /* One-off tasks for a single day, stored alongside the plan on the daily
     note so they never touch the routine folder. */
  loadCustomTasks(file) {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const raw = fm?.[this.settings.pixelCalendarTasksProperty];
    const out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      return out;
    for (const [id, value] of Object.entries(raw)) {
      if (typeof value === "string") {
        if (value.trim())
          out[id] = { title: value, done: false };
      } else if (value && typeof value === "object" && !Array.isArray(value)) {
        const obj = value;
        const title = obj.title == null ? "" : String(obj.title);
        if (title.trim())
          out[id] = { title, done: obj.done === true };
      }
    }
    return out;
  }
  collectHabitFiles(folder, out) {
    const children = [...folder.children].sort(
      (a, b) => a.name.localeCompare(b.name)
    );
    for (const c of children) {
      if (c instanceof import_obsidian.TFile && c.extension === "md")
        out.push(c);
      else if (c instanceof import_obsidian.TFolder)
        this.collectHabitFiles(c, out);
    }
  }
  async renderPixelCalendar(el, ctx) {
    el.empty();
    const root = this.routinesRoot();
    if (!root) {
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
    const noteFile = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!(noteFile instanceof import_obsidian.TFile)) {
      el.createDiv({
        cls: "folder-routines-error",
        text: "Folder Routines: could not resolve this note to save the plan."
      });
      return;
    }
    const dateStr = date.format(this.settings.storeDateFormat || "YYYY-MM-DD");
    const plan = this.loadPlan(noteFile);
    const customTasks = this.loadCustomTasks(noteFile);
    const spans = this.loadTimeSpans(noteFile);
    const blockId = this.nextBlockId();
    const habitFiles = [];
    this.collectHabitFiles(root, habitFiles);
    const colorByPath = /* @__PURE__ */ new Map();
    const assignColors = (folder, inherited) => {
      const kids = [...folder.children].sort(
        (a, b) => a.name.localeCompare(b.name)
      );
      const files = kids.filter(
        (c) => c instanceof import_obsidian.TFile && c.extension === "md"
      );
      const subs = kids.filter((c) => c instanceof import_obsidian.TFolder);
      for (const f of files)
        if (inherited > 0)
          colorByPath.set(f.path, inherited);
      subs.forEach(
        (sub, i) => assignColors(sub, i % _FolderRoutinesPlugin.SECTION_COLORS + 1)
      );
    };
    assignColors(root, 0);
    const applyColor = (elm, path) => {
      const c = colorByPath.get(path) ?? 1;
      elm.addClass(`folder-routines-color-${c}`);
    };
    const done = /* @__PURE__ */ new Set();
    const subtasksByPath = /* @__PURE__ */ new Map();
    for (const f of habitFiles) {
      const subs = this.getSubtasks(f);
      subtasksByPath.set(f.path, subs);
      if (subs.length > 0) {
        const resolved = await this.reconcileSubtaskEntries(f, subs);
        let allDone = true;
        for (const s of subs) {
          if ((resolved[s] ?? []).includes(dateStr))
            done.add(makeRef(f.path, s));
          else
            allDone = false;
        }
        if (allDone)
          done.add(f.path);
      } else if (this.isChecked(f, dateStr)) {
        done.add(f.path);
      }
    }
    const dayStart = this.calendarStartMinutes();
    const startRow = dayStart / SLOT_MINUTES;
    const visibleStart = (min) => Math.max(min, dayStart);
    const slotKeys = buildSlotKeys(dayStart);
    const now = (0, import_obsidian.moment)();
    const isToday = date.isSame(now, "day");
    const pad = (n) => String(n).padStart(2, "0");
    const currentSlotKey = (m) => {
      const total = m.hours() * 60 + Math.floor(m.minutes() / SLOT_MINUTES) * SLOT_MINUTES;
      return pad(Math.floor(total / 60)) + ":" + pad(total % 60);
    };
    const fileForPath = (p) => {
      const f = this.app.vault.getAbstractFileByPath(p);
      return f instanceof import_obsidian.TFile ? f : null;
    };
    const slotOfRef = (ref) => {
      for (const k of Object.keys(plan)) {
        if (plan[k].includes(ref))
          return k;
      }
      return null;
    };
    const removeRefEverywhere = (ref) => {
      for (const k of Object.keys(plan)) {
        plan[k] = plan[k].filter((r) => r !== ref);
        if (plan[k].length === 0)
          delete plan[k];
      }
    };
    const discardRef = (ref) => {
      removeRefEverywhere(ref);
      delete spans[ref];
      if (isCustomRef(ref))
        delete customTasks[customRefId(ref)];
    };
    const placeRef = (ref, slotKey) => {
      removeRefEverywhere(ref);
      if (!plan[slotKey])
        plan[slotKey] = [];
      if (!plan[slotKey].includes(ref))
        plan[slotKey].push(ref);
    };
    const spanOf = (ref, slotKey) => {
      const explicit = spans[ref];
      if (explicit)
        return explicit;
      const start = parseHM(slotKey) ?? 0;
      return { start, end: start + SLOT_MINUTES };
    };
    const durationOf = (ref) => {
      const slotKey = slotOfRef(ref);
      if (!slotKey)
        return SLOT_MINUTES;
      const s = spanOf(ref, slotKey);
      return s.end - s.start;
    };
    const setSpan = (ref, startMin, endMin) => {
      const start = clampMinute(Math.min(startMin, DAY_MINUTES - MIN_DURATION));
      const end = clampMinute(Math.max(endMin, start + MIN_DURATION));
      spans[ref] = { start, end };
      placeRef(ref, slotKeyForMinutes(start));
    };
    let saveChain = Promise.resolve();
    const persist = () => {
      saveChain = saveChain.then(() => this.savePlanState(noteFile, plan, customTasks, spans)).catch((e) => {
        console.error("Folder Routines: failed to save pixel calendar plan", e);
        new import_obsidian.Notice("Folder Routines: failed to save calendar plan");
      });
    };
    const applyDone = (path, subtask, target, subs) => {
      if (subtask != null) {
        const ref = makeRef(path, subtask);
        if (target)
          done.add(ref);
        else
          done.delete(ref);
        const allDone = subs.length > 0 && subs.every((s) => done.has(makeRef(path, s)));
        if (allDone)
          done.add(path);
        else
          done.delete(path);
      } else if (subs.length > 0) {
        if (target) {
          done.add(path);
          for (const s of subs)
            done.add(makeRef(path, s));
        } else {
          done.delete(path);
          for (const s of subs)
            done.delete(makeRef(path, s));
        }
      } else {
        if (target)
          done.add(path);
        else
          done.delete(path);
      }
    };
    const setRefDone = async (ref, target) => {
      if (isCustomRef(ref)) {
        const task = customTasks[customRefId(ref)];
        if (!task)
          return;
        task.done = target;
        persist();
        return;
      }
      const { path, subtask } = parseRef(ref);
      const file = fileForPath(path);
      if (!file)
        return;
      const subs = subtasksByPath.get(path) ?? [];
      let parentChecked = target;
      if (subtask != null) {
        parentChecked = await this.setSubtaskEntry(
          file,
          subtask,
          dateStr,
          target,
          subs
        );
      } else if (subs.length > 0) {
        await this.setParentToggleAll(file, dateStr, target, subs);
      } else {
        await this.setEntry(file, dateStr, target);
      }
      applyDone(path, subtask, target, subs);
      this.emitRoutineChange({
        dateStr,
        path,
        subtask,
        checked: target,
        parentChecked,
        subtasks: subs,
        originId: blockId
      });
    };
    const refLabel = (ref) => {
      if (isCustomRef(ref)) {
        const task = customTasks[customRefId(ref)];
        return { text: task ? task.title : "Missing task", parent: "TASK" };
      }
      const { path, subtask } = parseRef(ref);
      const file = fileForPath(path);
      const rawBase = file ? file.basename : (path.split("/").pop() ?? path).replace(/\.md$/, "");
      const base = this.displayName(rawBase);
      if (subtask != null)
        return { text: subtask, parent: base };
      return { text: base, parent: null };
    };
    const makeDraggable = (elm, ref) => {
      elm.setAttr("draggable", "true");
      elm.addEventListener("dragstart", (e) => {
        if (e.dataTransfer) {
          e.dataTransfer.setData("text/plain", ref);
          e.dataTransfer.effectAllowed = "move";
        }
        elm.addClass("is-dragging");
      });
      elm.addEventListener("dragend", () => elm.removeClass("is-dragging"));
    };
    const wireDropZone = (zone, onDrop) => {
      const over = (e) => {
        e.preventDefault();
        if (e.dataTransfer)
          e.dataTransfer.dropEffect = "move";
        zone.addClass("is-drop-target");
      };
      zone.addEventListener("dragover", over);
      zone.addEventListener("dragenter", over);
      zone.addEventListener("dragleave", () => zone.removeClass("is-drop-target"));
      zone.addEventListener("drop", (e) => {
        e.preventDefault();
        zone.removeClass("is-drop-target");
        const ref = e.dataTransfer?.getData("text/plain");
        if (ref)
          onDrop(ref);
      });
    };
    const container = el.createDiv({ cls: "folder-routines pixel-calendar" });
    const header = container.createDiv({ cls: "pixel-calendar-header" });
    header.createSpan({ cls: "folder-routines-collapse-icon", text: "\u25BC" });
    header.createSpan({ cls: "pixel-calendar-title", text: "Day Plan" });
    header.createSpan({
      cls: "pixel-calendar-date",
      text: date.format("dddd, MMMM D, YYYY")
    });
    header.addEventListener("click", () => {
      container.toggleClass(
        "is-collapsed",
        !container.hasClass("is-collapsed")
      );
    });
    const layout = container.createDiv({ cls: "pixel-calendar-layout" });
    const sideEl = layout.createDiv({ cls: "pixel-calendar-side" });
    const gridWrap = layout.createDiv({ cls: "pixel-calendar-grid-wrap" });
    const gridEl = gridWrap.createDiv({ cls: "pixel-calendar-grid" });
    let refresh = () => {
    };
    let openSideSection = null;
    const isRefDone = (ref) => {
      if (isCustomRef(ref))
        return customTasks[customRefId(ref)]?.done === true;
      return done.has(ref);
    };
    const addChipCheckbox = (host, ref, chip = host) => {
      const checkbox = host.createEl("input", {
        type: "checkbox"
      });
      checkbox.checked = isRefDone(ref);
      if (checkbox.checked)
        chip.addClass("is-done");
      checkbox.addEventListener("click", (e) => e.stopPropagation());
      checkbox.addEventListener("dblclick", (e) => e.stopPropagation());
      checkbox.addEventListener("change", async () => {
        const target = checkbox.checked;
        checkbox.disabled = true;
        try {
          await setRefDone(ref, target);
          refresh();
        } catch (err) {
          console.error("Folder Routines: failed to update frontmatter", err);
          new import_obsidian.Notice("Folder Routines: failed to update completion");
          checkbox.checked = !target;
          checkbox.disabled = false;
        }
      });
      return checkbox;
    };
    const openTaskInput = (host, initial, onCommit) => {
      const wrap = host.createDiv({ cls: "pixel-calendar-task-input" });
      const input = wrap.createEl("input", { type: "text" });
      input.value = initial;
      input.placeholder = "Task name\u2026";
      input.setAttr("aria-label", "Task name");
      let closed = false;
      const finish = (commit) => {
        if (closed)
          return;
        closed = true;
        const value = input.value.trim();
        if (commit && value)
          onCommit(value);
        else
          refresh();
      };
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      });
      input.addEventListener("blur", () => finish(true));
      input.addEventListener("click", (e) => e.stopPropagation());
      input.addEventListener("dblclick", (e) => e.stopPropagation());
      input.focus();
      input.select();
    };
    const addTaskAt = (zone, slotKey) => {
      openTaskInput(zone, "", (title) => {
        const id = newCustomTaskId();
        customTasks[id] = { title, done: false };
        placeRef(makeCustomRef(id), slotKey);
        refresh();
        persist();
      });
    };
    const rowHeightPx = () => {
      const unit = gridEl.querySelector(
        ".pixel-calendar-unit"
      );
      const h = unit?.getBoundingClientRect().height ?? 0;
      return h > 0 ? h : 0;
    };
    const snap = (mins) => Math.round(mins / RESIZE_STEP) * RESIZE_STEP;
    const decorateEvent = (chip, ref, span) => {
      const handle = chip.createDiv({ cls: "pixel-calendar-event-handle" });
      handle.setAttr("aria-label", "Drag to change duration");
      handle.setAttr("title", "Drag to stretch");
      handle.addEventListener("click", (e) => e.stopPropagation());
      handle.addEventListener("dblclick", (e) => e.stopPropagation());
      handle.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const rowH = rowHeightPx();
        if (!rowH)
          return;
        const startY = e.clientY;
        const startEnd = span.end;
        let endMin = startEnd;
        chip.addClass("is-resizing");
        chip.setAttr("draggable", "false");
        try {
          handle.setPointerCapture(e.pointerId);
        } catch (err) {
        }
        const onMove = (ev) => {
          const deltaMin = (ev.clientY - startY) / rowH * SLOT_MINUTES;
          endMin = clampMinute(
            Math.max(span.start + MIN_DURATION, snap(startEnd + deltaMin))
          );
          chip.style.height = `calc(var(--fr-slot-h) * ${(endMin - visibleStart(span.start)) / SLOT_MINUTES} - 3px)`;
        };
        const onUp = () => {
          handle.removeEventListener("pointermove", onMove);
          handle.removeEventListener("pointerup", onUp);
          handle.removeEventListener("pointercancel", onUp);
          chip.removeClass("is-resizing");
          if (endMin !== startEnd) {
            setSpan(ref, span.start, endMin);
            persist();
          }
          refresh();
        };
        handle.addEventListener("pointermove", onMove);
        handle.addEventListener("pointerup", onUp);
        handle.addEventListener("pointercancel", onUp);
      });
    };
    const renderCustomChip = (host, ref, span) => {
      const id = customRefId(ref);
      const task = customTasks[id];
      const chip = host.createDiv({
        cls: "pixel-calendar-chip pixel-calendar-slot-chip pixel-calendar-event is-custom"
      });
      makeDraggable(chip, ref);
      if (!task) {
        chip.addClass("is-missing");
        chip.createSpan({
          cls: "pixel-calendar-chip-text",
          text: "Missing task"
        });
      } else {
        const head = chip.createDiv({ cls: "pixel-calendar-event-head" });
        addChipCheckbox(head, ref, chip);
        const info = head.createDiv({ cls: "pixel-calendar-chip-info" });
        const title = info.createSpan({
          cls: "pixel-calendar-chip-text",
          text: task.title
        });
        info.createSpan({ cls: "pixel-calendar-chip-parent", text: "TASK" });
        title.setAttr("title", "Double-click to rename");
        const startRename = (e) => {
          const target = e.target;
          if (target?.closest(
            ".pixel-calendar-event-handle, .pixel-calendar-chip-remove"
          ))
            return;
          e.preventDefault();
          e.stopPropagation();
          chip.empty();
          chip.addClass("is-editing");
          chip.setAttr("draggable", "false");
          openTaskInput(chip, task.title, (newTitle) => {
            task.title = newTitle;
            refresh();
            persist();
          });
        };
        chip.addEventListener("dblclick", startRename);
        const remove = head.createEl("button", {
          cls: "pixel-calendar-chip-remove",
          text: "\xD7"
        });
        remove.setAttr("aria-label", "Delete task");
        remove.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          discardRef(ref);
          refresh();
          persist();
        });
        decorateEvent(chip, ref, span);
      }
      return chip;
    };
    const renderSlotChip = (host, ref, span) => {
      if (isCustomRef(ref))
        return renderCustomChip(host, ref, span);
      const { subtask, path } = parseRef(ref);
      const file = fileForPath(path);
      const chip = host.createDiv({
        cls: "pixel-calendar-chip pixel-calendar-slot-chip pixel-calendar-event"
      });
      makeDraggable(chip, ref);
      applyColor(chip, path);
      if (subtask != null)
        chip.addClass("is-subtask");
      if (!file) {
        chip.addClass("is-missing");
        chip.createSpan({
          cls: "pixel-calendar-chip-text",
          text: refLabel(ref).text
        });
        return chip;
      }
      const head = chip.createDiv({ cls: "pixel-calendar-event-head" });
      addChipCheckbox(head, ref, chip);
      const info = head.createDiv({ cls: "pixel-calendar-chip-info" });
      const lbl = refLabel(ref);
      info.createSpan({ cls: "pixel-calendar-chip-text", text: lbl.text });
      if (lbl.parent)
        info.createSpan({
          cls: "pixel-calendar-chip-parent",
          text: lbl.parent
        });
      const remove = head.createEl("button", {
        cls: "pixel-calendar-chip-remove",
        text: "\xD7"
      });
      remove.setAttr("aria-label", "Remove from calendar");
      remove.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        discardRef(ref);
        refresh();
        persist();
      });
      decorateEvent(chip, ref, span);
      return chip;
    };
    const renderSideHabit = (file, containerEl) => {
      const subs = subtasksByPath.get(file.path) ?? [];
      const wrap = containerEl.createDiv({ cls: "pixel-calendar-side-habit" });
      const chip = wrap.createDiv({
        cls: "pixel-calendar-chip pixel-calendar-side-chip"
      });
      makeDraggable(chip, file.path);
      applyColor(chip, file.path);
      addChipCheckbox(chip, file.path);
      const info = chip.createDiv({ cls: "pixel-calendar-chip-info" });
      info.createSpan({
        cls: "pixel-calendar-chip-text",
        text: this.displayName(file.basename)
      });
      const at = slotOfRef(file.path);
      if (at) {
        chip.addClass("is-scheduled");
        const s = spanOf(file.path, at);
        info.createSpan({
          cls: "pixel-calendar-chip-time",
          text: `${formatHM(s.start)}\u2013${formatHM(s.end)}`
        });
      }
      if (subs.length > 0) {
        const subWrap = wrap.createDiv({ cls: "pixel-calendar-side-subtasks" });
        for (const name of subs) {
          const sref = makeRef(file.path, name);
          const sChip = subWrap.createDiv({
            cls: "pixel-calendar-chip pixel-calendar-side-chip is-subtask"
          });
          makeDraggable(sChip, sref);
          applyColor(sChip, file.path);
          addChipCheckbox(sChip, sref);
          const sInfo = sChip.createDiv({ cls: "pixel-calendar-chip-info" });
          sInfo.createSpan({ cls: "pixel-calendar-chip-text", text: name });
          const sAt = slotOfRef(sref);
          if (sAt) {
            sChip.addClass("is-scheduled");
            const ss = spanOf(sref, sAt);
            sInfo.createSpan({
              cls: "pixel-calendar-chip-time",
              text: `${formatHM(ss.start)}\u2013${formatHM(ss.end)}`
            });
          }
        }
      }
    };
    const renderSideFolder = (folder, containerEl, depth) => {
      const children = [...folder.children].sort(
        (a, b) => a.name.localeCompare(b.name)
      );
      const files = children.filter(
        (c) => c instanceof import_obsidian.TFile && c.extension === "md"
      );
      const subfolders = children.filter(
        (c) => c instanceof import_obsidian.TFolder
      );
      for (const file of files)
        renderSideHabit(file, containerEl);
      const sections = [];
      subfolders.forEach((sub, i) => {
        const colorIndex = i % _FolderRoutinesPlugin.SECTION_COLORS;
        const section = containerEl.createDiv({
          cls: `pixel-calendar-side-section folder-routines-color-${colorIndex + 1}`
        });
        sections.push(section);
        if (openSideSection !== sub.path)
          section.addClass("is-collapsed");
        const secHeader = section.createDiv({
          cls: "pixel-calendar-side-heading"
        });
        secHeader.createSpan({
          cls: "folder-routines-collapse-icon",
          text: "\u25BE"
        });
        secHeader.createSpan({ text: this.displayName(sub.name) });
        const body = section.createDiv({ cls: "pixel-calendar-side-body" });
        renderSideFolder(sub, body, depth + 1);
        secHeader.addEventListener("click", () => {
          const willOpen = section.hasClass("is-collapsed");
          for (const s of sections)
            s.addClass("is-collapsed");
          if (willOpen) {
            section.removeClass("is-collapsed");
            openSideSection = sub.path;
          } else {
            openSideSection = null;
          }
        });
      });
    };
    const layoutEvents = (layer, rowEls) => {
      const items = [];
      for (const key of Object.keys(plan)) {
        for (const ref of plan[key]) {
          const span = spanOf(ref, key);
          if (span.end <= dayStart)
            continue;
          items.push({ ref, span });
        }
      }
      items.sort(
        (a, b) => a.span.start - b.span.start || b.span.end - b.span.start - (a.span.end - a.span.start)
      );
      const firstRow = (min) => Math.floor(visibleStart(min) / SLOT_MINUTES) - startRow;
      const lastRow = (min) => Math.max(0, Math.floor((min - 1) / SLOT_MINUTES) - startRow);
      const rowStartMin = (row) => (row + startRow) * SLOT_MINUTES;
      const cellsOf = (r1, r2, band) => {
        const out = [];
        if (r1 === r2)
          return [r1 * MAX_BANDS + band];
        for (let b = band; b < MAX_BANDS; b++)
          out.push(r1 * MAX_BANDS + b);
        for (let r = r1 + 1; r < r2; r++)
          for (let b = 0; b < MAX_BANDS; b++)
            out.push(r * MAX_BANDS + b);
        for (let b = 0; b <= band; b++)
          out.push(r2 * MAX_BANDS + b);
        return out;
      };
      const taken = [];
      for (let c = 0; c < MAX_COLUMNS; c++)
        taken.push(/* @__PURE__ */ new Set());
      const placed = [];
      for (const it of items) {
        const r1 = firstRow(it.span.start);
        const r2 = Math.max(r1, lastRow(it.span.end));
        let band = MAX_BANDS - 1;
        let col = 0;
        let cells = cellsOf(r1, r2, band);
        let found = false;
        for (let b = 0; b < MAX_BANDS && !found; b++) {
          const candidate = cellsOf(r1, r2, b);
          for (let c = 0; c < MAX_COLUMNS && !found; c++) {
            if (candidate.some((k) => taken[c].has(k)))
              continue;
            band = b;
            col = c;
            cells = candidate;
            found = true;
          }
        }
        for (const k of cells)
          taken[col].add(k);
        placed.push({ ...it, r1, r2, band, col, cells });
      }
      const units = rowEls.map(() => 1);
      for (const p of placed) {
        for (let r = p.r1; r <= p.r2; r++)
          if (r < units.length)
            units[r] = Math.max(units[r], p.band + 1);
      }
      const rowTop = [];
      let acc = 0;
      for (let r = 0; r < units.length; r++) {
        rowTop[r] = acc;
        acc += units[r];
        rowEls[r].style.setProperty("--fr-row-units", String(units[r]));
      }
      for (const p of placed) {
        const chip = renderSlotChip(layer, p.ref, p.span);
        const beside = placed.some(
          (o) => o !== p && o.col !== p.col && o.cells.some((k) => p.cells.includes(k))
        );
        const top = rowTop[p.r1] + p.band + (visibleStart(p.span.start) - rowStartMin(p.r1)) / SLOT_MINUTES;
        const bottom = rowTop[p.r2] + p.band + (p.span.end - rowStartMin(p.r2)) / SLOT_MINUTES;
        chip.setAttr("data-start", formatHM(p.span.start));
        chip.setAttr("data-end", formatHM(p.span.end));
        chip.setAttr("data-band", String(p.band));
        chip.style.top = `calc(var(--fr-slot-h) * ${top})`;
        chip.style.height = `calc(var(--fr-slot-h) * ${bottom - top} - 3px)`;
        chip.style.left = beside ? `${p.col * 50}%` : "0%";
        chip.style.width = beside ? "50%" : "100%";
        wireDropZone(chip, (ref) => {
          if (ref === p.ref)
            return;
          placeRef(ref, slotKeyForMinutes(visibleStart(p.span.start)));
          delete spans[ref];
          refresh();
          persist();
        });
      }
    };
    const rebuildGrid = () => {
      const rowEls = [];
      for (const key of slotKeys) {
        const row = gridEl.createDiv({ cls: "pixel-calendar-row" });
        rowEls.push(row);
        row.setAttr("data-slot", key);
        if (key.endsWith(":00"))
          row.addClass("is-hour");
        if (isToday && key === currentSlotKey(now))
          row.addClass("is-now");
        row.createDiv({ cls: "pixel-calendar-time", text: key });
        const zone = row.createDiv({ cls: "pixel-calendar-slot" });
        zone.setAttr("aria-label", `${key} \u2014 double-click to add a task`);
        wireDropZone(zone, (ref) => {
          const duration = durationOf(ref);
          const start = parseHM(key) ?? 0;
          setSpan(ref, start, start + duration);
          refresh();
          persist();
        });
        zone.addEventListener("dblclick", (e) => {
          const target = e.target;
          if (target?.closest(".pixel-calendar-chip"))
            return;
          if (zone.querySelector(".pixel-calendar-task-input"))
            return;
          e.preventDefault();
          addTaskAt(zone, key);
        });
      }
      gridEl.createDiv({ cls: "pixel-calendar-unit" });
      layoutEvents(gridEl.createDiv({ cls: "pixel-calendar-events" }), rowEls);
    };
    refresh = () => {
      const prevScroll = gridWrap.scrollTop;
      sideEl.empty();
      const sideHeader = sideEl.createDiv({ cls: "pixel-calendar-side-header" });
      sideHeader.createSpan({
        cls: "pixel-calendar-side-title",
        text: "Habits"
      });
      sideHeader.createSpan({
        cls: "pixel-calendar-side-hint",
        text: "Double-click a time to add a task"
      });
      const sideList = sideEl.createDiv({ cls: "pixel-calendar-side-list" });
      if (habitFiles.length === 0) {
        sideList.createDiv({
          cls: "pixel-calendar-side-empty",
          text: `No habits found in "${this.settings.routinesFolder}".`
        });
      } else {
        renderSideFolder(root, sideList, 0);
      }
      wireDropZone(sideList, (ref) => {
        discardRef(ref);
        refresh();
        persist();
      });
      gridEl.empty();
      rebuildGrid();
      gridWrap.scrollTop = prevScroll;
    };
    refresh();
    this.registerBlockListener(el, ctx, (ev) => {
      if (ev.originId === blockId || ev.dateStr !== dateStr)
        return;
      if (!subtasksByPath.has(ev.path))
        return;
      applyDone(ev.path, ev.subtask, ev.checked, ev.subtasks);
      refresh();
    });
    const scrollKey = isToday ? currentSlotKey(now) : slotKeyForMinutes(visibleStart(8 * 60));
    const targetRow = gridEl.querySelector(
      `[data-slot="${scrollKey}"]`
    );
    if (targetRow)
      gridWrap.scrollTop = Math.max(0, targetRow.offsetTop - 8);
  }
  /* ============================================================
     Stats board (```routine-stats```)
     ============================================================ */
  getEntryDates(file, overrides) {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const entries = new Set(
      this.normalizeEntries(fm?.[this.settings.entriesProperty])
    );
    const fileOverrides = overrides?.get(file.path);
    if (!fileOverrides)
      return entries;
    for (const [dateStr, expected] of fileOverrides) {
      if (entries.has(dateStr) === expected) {
        fileOverrides.delete(dateStr);
      } else if (expected) {
        entries.add(dateStr);
      } else {
        entries.delete(dateStr);
      }
    }
    if (fileOverrides.size === 0)
      overrides?.delete(file.path);
    return entries;
  }
  setEntryOverride(overrides, path, dateStr, expected) {
    let fileOverrides = overrides.get(path);
    if (!fileOverrides) {
      fileOverrides = /* @__PURE__ */ new Map();
      overrides.set(path, fileOverrides);
    }
    fileOverrides.set(dateStr, expected);
  }
  collectSectionFiles(folder) {
    return [...folder.children].filter((c) => c instanceof import_obsidian.TFile && c.extension === "md").sort((a, b) => a.name.localeCompare(b.name));
  }
  /* Longest run of consecutive true values. */
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
  /* Trailing run of true values ending at the last index (today). */
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
  async renderStats(source, el, ctx) {
    el.empty();
    const root = this.routinesRoot();
    if (!root) {
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
    const blockId = this.nextBlockId();
    const entryOverrides = /* @__PURE__ */ new Map();
    this.renderStatsBoards(boards, root, 21, blockId, entryOverrides);
    this.registerBlockListener(el, ctx, (ev) => {
      if (ev.originId === blockId)
        return;
      const file = this.app.vault.getAbstractFileByPath(ev.path);
      if (!(file instanceof import_obsidian.TFile))
        return;
      this.setEntryOverride(
        entryOverrides,
        file.path,
        ev.dateStr,
        ev.parentChecked
      );
      this.renderStatsBoards(
        boards,
        root,
        21,
        blockId,
        entryOverrides
      );
    });
  }
  renderStatsBoards(host, root, days, blockId, entryOverrides) {
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
      sections.push({ name: this.displayName(root.name), files: rootFiles });
    const subfolders = [...root.children].filter((c) => c instanceof import_obsidian.TFolder).sort((a, b) => a.name.localeCompare(b.name));
    for (const sub of subfolders) {
      const files = this.collectSectionFiles(sub);
      if (files.length)
        sections.push({ name: this.displayName(sub.name), files });
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
      const colorIndex = sectionIndex % _FolderRoutinesPlugin.SECTION_COLORS;
      const board = host.createDiv({
        cls: `folder-routines-section routine-stats-board folder-routines-color-${colorIndex + 1}`
      });
      const rows = section.files.map((file) => {
        const dates = this.getEntryDates(file, entryOverrides);
        const flags = dateStrs.map((ds) => dates.has(ds));
        return {
          file,
          name: this.displayName(file.basename),
          flags,
          done: flags.filter(Boolean).length
        };
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
      grid.style.gridTemplateColumns = `max-content ${dayCols.join(
        " "
      )} auto`;
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
          text: row.name
        });
        const runLen = [];
        row.flags.forEach((done, di) => {
          runLen[di] = done ? (di > 0 ? runLen[di - 1] : 0) + 1 : 0;
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
          const prevDone = di > 0 && row.flags[di - 1] === true;
          const nextDone = row.flags[di + 1] === true;
          const isRunEnd = done && !nextDone;
          const streak = runLen[di];
          if (done && (prevDone || nextDone))
            cell.addClass("is-run");
          if (done && prevDone)
            cell.addClass("is-run-cont");
          if (done && nextDone) {
            cell.addClass("is-run-link");
            if ((di + 1) % 7 === 0)
              cell.addClass("is-week-bridge");
          }
          if (isRunEnd && streak > 1) {
            cell.addClass("is-run-end");
            cell.createSpan({
              cls: "routine-stats-run-count",
              text: String(streak)
            });
            cell.setAttr("data-streak", String(streak));
          }
          const ds = dateStrs[di];
          cell.setAttr(
            "aria-label",
            isRunEnd && streak > 1 ? `${row.name} \xB7 ${ds} \xB7 ${streak} day streak` : `${row.name} \xB7 ${ds}`
          );
          cell.setAttr("role", "button");
          cell.tabIndex = 0;
          const toggle = async () => {
            if (cell.hasClass("is-busy"))
              return;
            cell.addClass("is-busy");
            const target = !cell.hasClass("is-done");
            cell.toggleClass("is-done", target);
            cell.toggleClass("is-missed", !target);
            cell.empty();
            for (const c of [
              "is-run",
              "is-run-cont",
              "is-run-link",
              "is-run-end",
              "is-week-bridge"
            ])
              cell.removeClass(c);
            try {
              const subtasks = this.getSubtasks(row.file);
              if (subtasks.length > 0) {
                await this.setParentToggleAll(row.file, ds, target, subtasks);
              } else {
                await this.setEntry(row.file, ds, target);
              }
              this.emitRoutineChange({
                dateStr: ds,
                path: row.file.path,
                subtask: null,
                checked: target,
                parentChecked: target,
                subtasks,
                originId: blockId
              });
              this.setEntryOverride(
                entryOverrides,
                row.file.path,
                ds,
                target
              );
              this.renderStatsBoards(
                host,
                root,
                days,
                blockId,
                entryOverrides
              );
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
      grid.scrollLeft = grid.scrollWidth;
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
_FolderRoutinesPlugin.SECTION_COLORS = 4;
var FolderRoutinesPlugin = _FolderRoutinesPlugin;
var ResetTrackingDataModal = class extends import_obsidian.Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }
  onOpen() {
    this.setTitle("Reset all tracking data?");
    this.contentEl.createEl("p", {
      text: "This permanently removes all completion history, subtask completion history, saved calendar plans, one-off calendar tasks, and custom calendar times from every Markdown file in this vault."
    });
    this.contentEl.createEl("p", {
      text: "Habit definitions, note content, and plugin settings are kept. This cannot be undone."
    });
    let cancelButton = null;
    new import_obsidian.Setting(this.contentEl).addButton((button) => {
      cancelButton = button.buttonEl;
      button.setButtonText("Cancel").onClick(() => this.close());
    }).addButton(
      (button) => button.setButtonText("Reset tracking data").setWarning().onClick(async () => {
        button.setDisabled(true).setButtonText("Resetting...");
        if (cancelButton)
          cancelButton.disabled = true;
        try {
          const result = await this.plugin.resetTrackingData();
          this.close();
          if (result.failedFiles.length > 0) {
            new import_obsidian.Notice(
              `Folder Routines: cleared ${result.propertiesCleared} properties from ${result.filesCleared} files; ${result.failedFiles.length} files could not be updated. See the developer console.`
            );
          } else if (result.filesCleared === 0) {
            new import_obsidian.Notice("Folder Routines: no tracking data found.");
          } else {
            new import_obsidian.Notice(
              `Folder Routines: cleared ${result.propertiesCleared} properties from ${result.filesCleared} files. Reopen affected notes to refresh their views.`
            );
          }
        } catch (error) {
          console.error("Folder Routines: failed to reset tracking data", error);
          new import_obsidian.Notice("Folder Routines: failed to reset tracking data.");
          button.setDisabled(false).setButtonText("Reset tracking data");
          if (cancelButton)
            cancelButton.disabled = false;
        }
      })
    );
  }
  onClose() {
    this.contentEl.empty();
  }
};
var FolderRoutinesSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("Routines folder").setDesc("Folder holding your routine notes.").addDropdown((drop) => {
      const current = this.plugin.settings.routinesFolder;
      const folders = this.plugin.allFolderPaths();
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
    new import_obsidian.Setting(containerEl).setName("Hide routine numbering").setDesc(
      "Hide checklist indices and leading file or folder numbering such as '1. Meditation' across checklists, calendars, and stats. Names on disk are unchanged; reopen affected notes to apply."
    ).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.hideRoutineNumbering).onChange(async (value) => {
        this.plugin.settings.hideRoutineNumbering = value;
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
    new import_obsidian.Setting(containerEl).setName("Pixel calendar property").setDesc(
      "Frontmatter property on the daily note where the pixel-calendar day plan is stored."
    ).addText(
      (text) => text.setPlaceholder("pixelCalendarPlan").setValue(this.plugin.settings.pixelCalendarProperty).onChange(async (value) => {
        this.plugin.settings.pixelCalendarProperty = value.trim() || "pixelCalendarPlan";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Pixel calendar tasks property").setDesc(
      "Frontmatter property in the daily note where one-off calendar tasks are stored."
    ).addText(
      (text) => text.setPlaceholder("pixelCalendarTasks").setValue(this.plugin.settings.pixelCalendarTasksProperty).onChange(async (value) => {
        this.plugin.settings.pixelCalendarTasksProperty = value.trim() || "pixelCalendarTasks";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Pixel calendar times property").setDesc(
      "Frontmatter property in the daily note where custom start/finish times are stored."
    ).addText(
      (text) => text.setPlaceholder("pixelCalendarTimes").setValue(this.plugin.settings.pixelCalendarTimesProperty).onChange(async (value) => {
        this.plugin.settings.pixelCalendarTimesProperty = value.trim() || "pixelCalendarTimes";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Calendar start time").setDesc(
      "Earliest time the day plan shows. Slots before it are hidden; reopen the note to apply."
    ).addDropdown((drop) => {
      for (const key of buildSlotKeys())
        drop.addOption(key, key);
      drop.setValue(formatHM(this.plugin.calendarStartMinutes())).onChange(async (value) => {
        this.plugin.settings.calendarStartTime = value;
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian.Setting(containerEl).setName("Reset all tracking data").setDesc(
      "Permanently delete completion history and saved calendar data from every Markdown file in this vault."
    ).addButton(
      (button) => button.setButtonText("Reset tracking data").setWarning().onClick(() => new ResetTrackingDataModal(this.app, this.plugin).open())
    );
  }
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibWFpbi50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHtcclxuICBBcHAsXHJcbiAgUGx1Z2luLFxyXG4gIFBsdWdpblNldHRpbmdUYWIsXHJcbiAgU2V0dGluZyxcclxuICBURmlsZSxcclxuICBURm9sZGVyLFxyXG4gIE1hcmtkb3duUG9zdFByb2Nlc3NvckNvbnRleHQsXHJcbiAgTWFya2Rvd25SZW5kZXJDaGlsZCxcclxuICBNb2RhbCxcclxuICBOb3RpY2UsXHJcbiAgRWRpdG9yLFxyXG4gIE1hcmtkb3duVmlldyxcclxuICBtb21lbnQsXHJcbn0gZnJvbSBcIm9ic2lkaWFuXCI7XHJcblxyXG5pbnRlcmZhY2UgRm9sZGVyUm91dGluZXNTZXR0aW5ncyB7XHJcbiAgcm91dGluZXNGb2xkZXI6IHN0cmluZztcclxuICBoaWRlUm91dGluZU51bWJlcmluZzogYm9vbGVhbjtcclxuICBlbnRyaWVzUHJvcGVydHk6IHN0cmluZztcclxuICBzdG9yZURhdGVGb3JtYXQ6IHN0cmluZztcclxuICBzdWJ0YXNrc1Byb3BlcnR5OiBzdHJpbmc7XHJcbiAgc3VidGFza0VudHJpZXNQcm9wZXJ0eTogc3RyaW5nO1xyXG4gIHBpeGVsQ2FsZW5kYXJQcm9wZXJ0eTogc3RyaW5nO1xyXG4gIHBpeGVsQ2FsZW5kYXJUYXNrc1Byb3BlcnR5OiBzdHJpbmc7XHJcbiAgcGl4ZWxDYWxlbmRhclRpbWVzUHJvcGVydHk6IHN0cmluZztcclxuICBjYWxlbmRhclN0YXJ0VGltZTogc3RyaW5nO1xyXG59XHJcblxyXG5jb25zdCBERUZBVUxUX1NFVFRJTkdTOiBGb2xkZXJSb3V0aW5lc1NldHRpbmdzID0ge1xyXG4gIHJvdXRpbmVzRm9sZGVyOiBcIlJvdXRpbmVzXCIsXHJcbiAgaGlkZVJvdXRpbmVOdW1iZXJpbmc6IGZhbHNlLFxyXG4gIGVudHJpZXNQcm9wZXJ0eTogXCJlbnRyaWVzXCIsXHJcbiAgc3RvcmVEYXRlRm9ybWF0OiBcIllZWVktTU0tRERcIixcclxuICBzdWJ0YXNrc1Byb3BlcnR5OiBcInN1YnRhc2tzXCIsXHJcbiAgc3VidGFza0VudHJpZXNQcm9wZXJ0eTogXCJzdWJ0YXNrRW50cmllc1wiLFxyXG4gIHBpeGVsQ2FsZW5kYXJQcm9wZXJ0eTogXCJwaXhlbENhbGVuZGFyUGxhblwiLFxyXG4gIHBpeGVsQ2FsZW5kYXJUYXNrc1Byb3BlcnR5OiBcInBpeGVsQ2FsZW5kYXJUYXNrc1wiLFxyXG4gIHBpeGVsQ2FsZW5kYXJUaW1lc1Byb3BlcnR5OiBcInBpeGVsQ2FsZW5kYXJUaW1lc1wiLFxyXG4gIGNhbGVuZGFyU3RhcnRUaW1lOiBcIjAwOjAwXCIsXHJcbn07XHJcblxyXG5jb25zdCBTTE9UX01JTlVURVMgPSAzMDtcclxuLyogYSBoYWJpdCBvY2N1cGllcyBhdCBsZWFzdCBvbmUgd2hvbGUgc2xvdCwgYW5kIGdyb3dzIGEgc2xvdCBhdCBhIHRpbWUgKi9cclxuY29uc3QgTUlOX0RVUkFUSU9OID0gMzA7XHJcbmNvbnN0IFJFU0laRV9TVEVQID0gMzA7XHJcbi8qIGF0IG1vc3QgdHdvIGV2ZW50cyBzaXQgc2lkZSBieSBzaWRlOyB0aGUgbmV4dCBvbmUgd3JhcHMgdG8gYSBuZXcgYmFuZCAqL1xyXG5jb25zdCBNQVhfQ09MVU1OUyA9IDI7XHJcbmNvbnN0IE1BWF9CQU5EUyA9IDg7XHJcbmNvbnN0IERBWV9NSU5VVEVTID0gMjQgKiA2MDtcclxuY29uc3QgU1VCVEFTS19TRVAgPSBcIjo6XCI7XHJcblxyXG4vKiBPbmUtb2ZmIHRhc2tzIGxpdmUgaW4gdGhlIHBsYW4gdW5kZXIgYSBwcmVmaXggdGhhdCBjYW4gbmV2ZXIgY29sbGlkZSB3aXRoIGFcclxuICAgdmF1bHQgcGF0aCAoXCI6XCIgaXMgbm90IGEgbGVnYWwgZmlsZW5hbWUgY2hhcmFjdGVyIG9uIFdpbmRvd3MvbWFjT1MpLiAqL1xyXG5jb25zdCBDVVNUT01fUkVGX1BSRUZJWCA9IFwiY3VzdG9tOlwiO1xyXG5cclxudHlwZSBQbGFuTWFwID0gUmVjb3JkPHN0cmluZywgc3RyaW5nW10+O1xyXG5cclxuaW50ZXJmYWNlIEN1c3RvbVRhc2sge1xyXG4gIHRpdGxlOiBzdHJpbmc7XHJcbiAgZG9uZTogYm9vbGVhbjtcclxufVxyXG5cclxudHlwZSBDdXN0b21UYXNrTWFwID0gUmVjb3JkPHN0cmluZywgQ3VzdG9tVGFzaz47XHJcblxyXG4vKiBFeHBsaWNpdCBzdGFydC9maW5pc2ggZm9yIGEgc2NoZWR1bGVkIHJlZiwgaW4gbWludXRlcyBmcm9tIG1pZG5pZ2h0LlxyXG4gICBBYnNlbnQgbWVhbnMgXCJ0aGUgMzAtbWludXRlIHNsb3QgaXQgc2l0cyBpblwiLiAqL1xyXG5pbnRlcmZhY2UgVGltZVNwYW4ge1xyXG4gIHN0YXJ0OiBudW1iZXI7XHJcbiAgZW5kOiBudW1iZXI7XHJcbn1cclxuXHJcbnR5cGUgVGltZVNwYW5NYXAgPSBSZWNvcmQ8c3RyaW5nLCBUaW1lU3Bhbj47XHJcbnR5cGUgRW50cnlTdGF0ZU92ZXJyaWRlcyA9IE1hcDxzdHJpbmcsIE1hcDxzdHJpbmcsIGJvb2xlYW4+PjtcclxuXHJcbmludGVyZmFjZSBUcmFja2luZ1Jlc2V0UmVzdWx0IHtcclxuICBmaWxlc0NsZWFyZWQ6IG51bWJlcjtcclxuICBwcm9wZXJ0aWVzQ2xlYXJlZDogbnVtYmVyO1xyXG4gIGZhaWxlZEZpbGVzOiBzdHJpbmdbXTtcclxufVxyXG5cclxuZnVuY3Rpb24gY2xhbXBNaW51dGUodjogbnVtYmVyKTogbnVtYmVyIHtcclxuICByZXR1cm4gTWF0aC5tYXgoMCwgTWF0aC5taW4oREFZX01JTlVURVMsIE1hdGgucm91bmQodikpKTtcclxufVxyXG5cclxuZnVuY3Rpb24gZm9ybWF0SE0obWluOiBudW1iZXIpOiBzdHJpbmcge1xyXG4gIGNvbnN0IG0gPSBjbGFtcE1pbnV0ZShtaW4pO1xyXG4gIGNvbnN0IGggPSBNYXRoLmZsb29yKG0gLyA2MCk7XHJcbiAgcmV0dXJuIChcclxuICAgIFN0cmluZyhoID09PSAyNCA/IDI0IDogaCkucGFkU3RhcnQoMiwgXCIwXCIpICtcclxuICAgIFwiOlwiICtcclxuICAgIFN0cmluZyhtICUgNjApLnBhZFN0YXJ0KDIsIFwiMFwiKVxyXG4gICk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHBhcnNlSE0odGV4dDogdW5rbm93bik6IG51bWJlciB8IG51bGwge1xyXG4gIGNvbnN0IHMgPSBTdHJpbmcodGV4dCA/PyBcIlwiKS50cmltKCk7XHJcbiAgY29uc3QgbSA9IC9eKFxcZHsxLDJ9KTooXFxkezJ9KSQvLmV4ZWMocyk7XHJcbiAgaWYgKCFtKSByZXR1cm4gbnVsbDtcclxuICBjb25zdCBoID0gTnVtYmVyKG1bMV0pO1xyXG4gIGNvbnN0IG1tID0gTnVtYmVyKG1bMl0pO1xyXG4gIGlmICghTnVtYmVyLmlzRmluaXRlKGgpIHx8ICFOdW1iZXIuaXNGaW5pdGUobW0pIHx8IG1tID4gNTkgfHwgaCA+IDI0KSByZXR1cm4gbnVsbDtcclxuICByZXR1cm4gY2xhbXBNaW51dGUoaCAqIDYwICsgbW0pO1xyXG59XHJcblxyXG4vKiBMYXJnZXN0IHNsb3QgYm91bmRhcnkgYXQgb3IgYmVsb3cgYSB0aW1lLCBuZXZlciBwYXN0IHRoZSBmaW5hbCBzbG90LiAqL1xyXG5mdW5jdGlvbiBzbmFwVG9TbG90KG1pbjogbnVtYmVyKTogbnVtYmVyIHtcclxuICBjb25zdCBzbmFwcGVkID1cclxuICAgIE1hdGguZmxvb3IoTWF0aC5taW4obWluLCBEQVlfTUlOVVRFUyAtIFNMT1RfTUlOVVRFUykgLyBTTE9UX01JTlVURVMpICpcclxuICAgIFNMT1RfTUlOVVRFUztcclxuICByZXR1cm4gTWF0aC5tYXgoMCwgc25hcHBlZCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHNsb3RLZXlGb3JNaW51dGVzKG1pbjogbnVtYmVyKTogc3RyaW5nIHtcclxuICByZXR1cm4gZm9ybWF0SE0oc25hcFRvU2xvdChtaW4pKTtcclxufVxyXG5cclxuLyogUGVyLWJsb2NrIHJlZ2lzdHJ5IG9mIFwiYXBwbHkgdGhpcyBjb21wbGV0aW9uIHN0YXRlIHRvIG15IFVJXCIgY2FsbGJhY2tzLFxyXG4gICBrZXllZCBieSByZWYgKG5vdGUgcGF0aCwgb3IgcGF0aDo6c3VidGFzaykuICovXHJcbmludGVyZmFjZSBCbG9ja1N5bmMge1xyXG4gIGlkOiBzdHJpbmc7XHJcbiAgc2V0dGVyczogTWFwPHN0cmluZywgKGNoZWNrZWQ6IGJvb2xlYW4pID0+IHZvaWQ+O1xyXG59XHJcblxyXG4vKiBCcm9hZGNhc3Qgd2hlbmV2ZXIgYSBoYWJpdCBjb21wbGV0aW9uIGlzIHdyaXR0ZW4sIHNvIGV2ZXJ5IHJlbmRlcmVkIGJsb2NrXHJcbiAgIChjaGVja2xpc3QsIGNhbGVuZGFyLCBzdGF0cykgb24gYW55IG9wZW4gbm90ZSBzdGF5cyBpbiBzeW5jIHdpdGhvdXQgYVxyXG4gICByZS1yZW5kZXIgb2YgdGhlIHdob2xlIHBhZ2UuICovXHJcbmludGVyZmFjZSBSb3V0aW5lQ2hhbmdlRXZlbnQge1xyXG4gIGRhdGVTdHI6IHN0cmluZztcclxuICBwYXRoOiBzdHJpbmc7XHJcbiAgc3VidGFzazogc3RyaW5nIHwgbnVsbDtcclxuICBjaGVja2VkOiBib29sZWFuO1xyXG4gIHBhcmVudENoZWNrZWQ6IGJvb2xlYW47XHJcbiAgc3VidGFza3M6IHN0cmluZ1tdO1xyXG4gIG9yaWdpbklkOiBzdHJpbmc7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG1ha2VSZWYocGF0aDogc3RyaW5nLCBzdWJ0YXNrPzogc3RyaW5nIHwgbnVsbCk6IHN0cmluZyB7XHJcbiAgcmV0dXJuIHN1YnRhc2sgIT0gbnVsbCAmJiBzdWJ0YXNrICE9PSBcIlwiID8gcGF0aCArIFNVQlRBU0tfU0VQICsgc3VidGFzayA6IHBhdGg7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHBhcnNlUmVmKHJlZjogc3RyaW5nKTogeyBwYXRoOiBzdHJpbmc7IHN1YnRhc2s6IHN0cmluZyB8IG51bGwgfSB7XHJcbiAgY29uc3QgaWR4ID0gcmVmLmluZGV4T2YoU1VCVEFTS19TRVApO1xyXG4gIGlmIChpZHggPT09IC0xKSByZXR1cm4geyBwYXRoOiByZWYsIHN1YnRhc2s6IG51bGwgfTtcclxuICByZXR1cm4geyBwYXRoOiByZWYuc2xpY2UoMCwgaWR4KSwgc3VidGFzazogcmVmLnNsaWNlKGlkeCArIFNVQlRBU0tfU0VQLmxlbmd0aCkgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gaXNDdXN0b21SZWYocmVmOiBzdHJpbmcpOiBib29sZWFuIHtcclxuICByZXR1cm4gcmVmLnN0YXJ0c1dpdGgoQ1VTVE9NX1JFRl9QUkVGSVgpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBtYWtlQ3VzdG9tUmVmKGlkOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gIHJldHVybiBDVVNUT01fUkVGX1BSRUZJWCArIGlkO1xyXG59XHJcblxyXG5mdW5jdGlvbiBjdXN0b21SZWZJZChyZWY6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgcmV0dXJuIHJlZi5zbGljZShDVVNUT01fUkVGX1BSRUZJWC5sZW5ndGgpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBuZXdDdXN0b21UYXNrSWQoKTogc3RyaW5nIHtcclxuICByZXR1cm4gKFxyXG4gICAgRGF0ZS5ub3coKS50b1N0cmluZygzNikgKyBcIi1cIiArIE1hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnNsaWNlKDIsIDYpXHJcbiAgKTtcclxufVxyXG5cclxuLyogU2xvdHMgZnJvbSB0aGUgc3RhcnQgb2YgdGhlIHZpc2libGUgZGF5IHRocm91Z2ggdG8gbWlkbmlnaHQuIEFueXRoaW5nXHJcbiAgIGVhcmxpZXIgaXMgc2ltcGx5IG5vdCBwYXJ0IG9mIHRoZSBncmlkLiAqL1xyXG5mdW5jdGlvbiBidWlsZFNsb3RLZXlzKHN0YXJ0TWluID0gMCk6IHN0cmluZ1tdIHtcclxuICBjb25zdCBrZXlzOiBzdHJpbmdbXSA9IFtdO1xyXG4gIGZvciAobGV0IG0gPSBzbmFwVG9TbG90KHN0YXJ0TWluKTsgbSA8IDI0ICogNjA7IG0gKz0gU0xPVF9NSU5VVEVTKSB7XHJcbiAgICBjb25zdCBoID0gTWF0aC5mbG9vcihtIC8gNjApO1xyXG4gICAgY29uc3QgbW0gPSBtICUgNjA7XHJcbiAgICBrZXlzLnB1c2goU3RyaW5nKGgpLnBhZFN0YXJ0KDIsIFwiMFwiKSArIFwiOlwiICsgU3RyaW5nKG1tKS5wYWRTdGFydCgyLCBcIjBcIikpO1xyXG4gIH1cclxuICByZXR1cm4ga2V5cztcclxufVxyXG5cclxuZnVuY3Rpb24gZ2V0RGFpbHlOb3RlRm9ybWF0KGFwcDogQXBwKTogc3RyaW5nIHtcclxuICBjb25zdCBhbnlBcHAgPSBhcHAgYXMgYW55O1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBkbiA9IGFueUFwcC5pbnRlcm5hbFBsdWdpbnM/LmdldFBsdWdpbkJ5SWQ/LihcImRhaWx5LW5vdGVzXCIpO1xyXG4gICAgY29uc3QgZm10ID0gZG4/Lmluc3RhbmNlPy5vcHRpb25zPy5mb3JtYXQ7XHJcbiAgICBpZiAoZm10KSByZXR1cm4gZm10O1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIC8qIGlnbm9yZSAqL1xyXG4gIH1cclxuICB0cnkge1xyXG4gICAgY29uc3QgcG4gPSBhbnlBcHAucGx1Z2lucz8uZ2V0UGx1Z2luPy4oXCJwZXJpb2RpYy1ub3Rlc1wiKTtcclxuICAgIGNvbnN0IGZtdCA9IHBuPy5zZXR0aW5ncz8uZGFpbHk/LmZvcm1hdDtcclxuICAgIGlmIChmbXQpIHJldHVybiBmbXQ7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgLyogaWdub3JlICovXHJcbiAgfVxyXG4gIHJldHVybiBcIllZWVktTU0tRERcIjtcclxufVxyXG5cclxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgRm9sZGVyUm91dGluZXNQbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xyXG4gIHNldHRpbmdzOiBGb2xkZXJSb3V0aW5lc1NldHRpbmdzO1xyXG5cclxuICBhc3luYyBvbmxvYWQoKSB7XHJcbiAgICBhd2FpdCB0aGlzLmxvYWRTZXR0aW5ncygpO1xyXG5cclxuICAgIHRoaXMucmVnaXN0ZXJNYXJrZG93bkNvZGVCbG9ja1Byb2Nlc3NvcihcclxuICAgICAgXCJyb3V0aW5lc1wiLFxyXG4gICAgICAoc291cmNlLCBlbCwgY3R4KSA9PiB0aGlzLnJlbmRlclJvdXRpbmVzKGVsLCBjdHgpXHJcbiAgICApO1xyXG5cclxuICAgIHRoaXMucmVnaXN0ZXJNYXJrZG93bkNvZGVCbG9ja1Byb2Nlc3NvcihcclxuICAgICAgXCJyb3V0aW5lLXN0YXRzXCIsXHJcbiAgICAgIChzb3VyY2UsIGVsLCBjdHgpID0+IHRoaXMucmVuZGVyU3RhdHMoc291cmNlLCBlbCwgY3R4KVxyXG4gICAgKTtcclxuXHJcbiAgICB0aGlzLnJlZ2lzdGVyTWFya2Rvd25Db2RlQmxvY2tQcm9jZXNzb3IoXHJcbiAgICAgIFwicGl4ZWwtY2FsZW5kYXJcIixcclxuICAgICAgKHNvdXJjZSwgZWwsIGN0eCkgPT4gdGhpcy5yZW5kZXJQaXhlbENhbGVuZGFyKGVsLCBjdHgpXHJcbiAgICApO1xyXG5cclxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XHJcbiAgICAgIGlkOiBcImluc2VydC1yb3V0aW5lcy1ibG9ja1wiLFxyXG4gICAgICBuYW1lOiBcIkluc2VydCByb3V0aW5lcyBjaGVja2xpc3QgYmxvY2tcIixcclxuICAgICAgZWRpdG9yQ2FsbGJhY2s6IChlZGl0b3I6IEVkaXRvciwgX3ZpZXc6IE1hcmtkb3duVmlldykgPT4ge1xyXG4gICAgICAgIGVkaXRvci5yZXBsYWNlU2VsZWN0aW9uKFwiYGBgcm91dGluZXNcXG5gYGBcXG5cIik7XHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICB0aGlzLmFkZENvbW1hbmQoe1xyXG4gICAgICBpZDogXCJpbnNlcnQtcm91dGluZS1zdGF0cy1ibG9ja1wiLFxyXG4gICAgICBuYW1lOiBcIkluc2VydCByb3V0aW5lIHN0YXRzIGJvYXJkXCIsXHJcbiAgICAgIGVkaXRvckNhbGxiYWNrOiAoZWRpdG9yOiBFZGl0b3IsIF92aWV3OiBNYXJrZG93blZpZXcpID0+IHtcclxuICAgICAgICBlZGl0b3IucmVwbGFjZVNlbGVjdGlvbihcImBgYHJvdXRpbmUtc3RhdHNcXG5gYGBcXG5cIik7XHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICB0aGlzLmFkZENvbW1hbmQoe1xyXG4gICAgICBpZDogXCJpbnNlcnQtcGl4ZWwtY2FsZW5kYXItYmxvY2tcIixcclxuICAgICAgbmFtZTogXCJJbnNlcnQgcGl4ZWwgY2FsZW5kYXIgYmxvY2tcIixcclxuICAgICAgZWRpdG9yQ2FsbGJhY2s6IChlZGl0b3I6IEVkaXRvciwgX3ZpZXc6IE1hcmtkb3duVmlldykgPT4ge1xyXG4gICAgICAgIGVkaXRvci5yZXBsYWNlU2VsZWN0aW9uKFwiYGBgcGl4ZWwtY2FsZW5kYXJcXG5gYGBcXG5cIik7XHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICB0aGlzLmFkZFNldHRpbmdUYWIobmV3IEZvbGRlclJvdXRpbmVzU2V0dGluZ1RhYih0aGlzLmFwcCwgdGhpcykpO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgbG9hZFNldHRpbmdzKCkge1xyXG4gICAgdGhpcy5zZXR0aW5ncyA9IE9iamVjdC5hc3NpZ24oe30sIERFRkFVTFRfU0VUVElOR1MsIGF3YWl0IHRoaXMubG9hZERhdGEoKSk7XHJcbiAgfVxyXG5cclxuICBhc3luYyBzYXZlU2V0dGluZ3MoKSB7XHJcbiAgICBhd2FpdCB0aGlzLnNhdmVEYXRhKHRoaXMuc2V0dGluZ3MpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSB0cmFja2luZ1Byb3BlcnR5TmFtZXMoKTogc3RyaW5nW10ge1xyXG4gICAgcmV0dXJuIFtcclxuICAgICAgdGhpcy5zZXR0aW5ncy5lbnRyaWVzUHJvcGVydHksXHJcbiAgICAgIHRoaXMuc2V0dGluZ3Muc3VidGFza0VudHJpZXNQcm9wZXJ0eSxcclxuICAgICAgdGhpcy5zZXR0aW5ncy5waXhlbENhbGVuZGFyUHJvcGVydHksXHJcbiAgICAgIHRoaXMuc2V0dGluZ3MucGl4ZWxDYWxlbmRhclRhc2tzUHJvcGVydHksXHJcbiAgICAgIHRoaXMuc2V0dGluZ3MucGl4ZWxDYWxlbmRhclRpbWVzUHJvcGVydHksXHJcbiAgICBdLmZpbHRlcigobmFtZSwgaW5kZXgsIG5hbWVzKSA9PiBuYW1lLmxlbmd0aCA+IDAgJiYgbmFtZXMuaW5kZXhPZihuYW1lKSA9PT0gaW5kZXgpO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgcmVzZXRUcmFja2luZ0RhdGEoKTogUHJvbWlzZTxUcmFja2luZ1Jlc2V0UmVzdWx0PiB7XHJcbiAgICBjb25zdCBwcm9wZXJ0aWVzID0gdGhpcy50cmFja2luZ1Byb3BlcnR5TmFtZXMoKTtcclxuICAgIGNvbnN0IGZpbGVzID0gdGhpcy5hcHAudmF1bHQuZ2V0TWFya2Rvd25GaWxlcygpLmZpbHRlcigoZmlsZSkgPT4ge1xyXG4gICAgICBjb25zdCBmcm9udG1hdHRlciA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpPy5mcm9udG1hdHRlcjtcclxuICAgICAgcmV0dXJuIChcclxuICAgICAgICBmcm9udG1hdHRlciAhPSBudWxsICYmXHJcbiAgICAgICAgcHJvcGVydGllcy5zb21lKChwcm9wZXJ0eSkgPT5cclxuICAgICAgICAgIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChmcm9udG1hdHRlciwgcHJvcGVydHkpXHJcbiAgICAgICAgKVxyXG4gICAgICApO1xyXG4gICAgfSk7XHJcblxyXG4gICAgbGV0IGZpbGVzQ2xlYXJlZCA9IDA7XHJcbiAgICBsZXQgcHJvcGVydGllc0NsZWFyZWQgPSAwO1xyXG4gICAgY29uc3QgZmFpbGVkRmlsZXM6IHN0cmluZ1tdID0gW107XHJcblxyXG4gICAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XHJcbiAgICAgIGxldCByZW1vdmVkRnJvbUZpbGUgPSAwO1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGF3YWl0IHRoaXMuYXBwLmZpbGVNYW5hZ2VyLnByb2Nlc3NGcm9udE1hdHRlcihmaWxlLCAoZnJvbnRtYXR0ZXIpID0+IHtcclxuICAgICAgICAgIGZvciAoY29uc3QgcHJvcGVydHkgb2YgcHJvcGVydGllcykge1xyXG4gICAgICAgICAgICBpZiAoIU9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChmcm9udG1hdHRlciwgcHJvcGVydHkpKVxyXG4gICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICBkZWxldGUgZnJvbnRtYXR0ZXJbcHJvcGVydHldO1xyXG4gICAgICAgICAgICByZW1vdmVkRnJvbUZpbGUgKz0gMTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgICAgICBpZiAocmVtb3ZlZEZyb21GaWxlID4gMCkge1xyXG4gICAgICAgICAgZmlsZXNDbGVhcmVkICs9IDE7XHJcbiAgICAgICAgICBwcm9wZXJ0aWVzQ2xlYXJlZCArPSByZW1vdmVkRnJvbUZpbGU7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGZhaWxlZEZpbGVzLnB1c2goZmlsZS5wYXRoKTtcclxuICAgICAgICBjb25zb2xlLmVycm9yKFxyXG4gICAgICAgICAgYEZvbGRlciBSb3V0aW5lczogZmFpbGVkIHRvIHJlc2V0IHRyYWNraW5nIGRhdGEgaW4gJHtmaWxlLnBhdGh9YCxcclxuICAgICAgICAgIGVycm9yXHJcbiAgICAgICAgKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiB7IGZpbGVzQ2xlYXJlZCwgcHJvcGVydGllc0NsZWFyZWQsIGZhaWxlZEZpbGVzIH07XHJcbiAgfVxyXG5cclxuICAvKiBGaXJzdCBtaW51dGUgdGhlIGNhbGVuZGFyIHNob3dzLCBzbmFwcGVkIGRvd24gdG8gYSBzbG90IGJvdW5kYXJ5LiBBblxyXG4gICAgIHVucmVhZGFibGUgc2V0dGluZyBmYWxscyBiYWNrIHRvIG1pZG5pZ2h0LiAqL1xyXG4gIGNhbGVuZGFyU3RhcnRNaW51dGVzKCk6IG51bWJlciB7XHJcbiAgICByZXR1cm4gc25hcFRvU2xvdChwYXJzZUhNKHRoaXMuc2V0dGluZ3MuY2FsZW5kYXJTdGFydFRpbWUpID8/IDApO1xyXG4gIH1cclxuXHJcbiAgLyogVGhlIGNvbmZpZ3VyZWQgcm91dGluZXMgZm9sZGVyLCBvciBudWxsIHdoZW4gaXQgbm8gbG9uZ2VyIGV4aXN0cy4gVGhlXHJcbiAgICAgcGlja2VyIHN0b3JlcyB0aGUgdmF1bHQgcm9vdCBhcyBcIi9cIiwgd2hpY2ggaXMgbm90IGEgbm9ybWFsIGZvbGRlciBwYXRoLiAqL1xyXG4gIHJvdXRpbmVzUm9vdCgpOiBURm9sZGVyIHwgbnVsbCB7XHJcbiAgICBjb25zdCBwYXRoID0gdGhpcy5zZXR0aW5ncy5yb3V0aW5lc0ZvbGRlcjtcclxuICAgIGNvbnN0IHZhdWx0Um9vdCA9IHRoaXMuYXBwLnZhdWx0LmdldFJvb3QoKTtcclxuICAgIGlmIChwYXRoID09PSBcIi9cIiB8fCBwYXRoID09PSB2YXVsdFJvb3QucGF0aCkgcmV0dXJuIHZhdWx0Um9vdDtcclxuICAgIGNvbnN0IGZvbGRlciA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChwYXRoKTtcclxuICAgIHJldHVybiBmb2xkZXIgaW5zdGFuY2VvZiBURm9sZGVyID8gZm9sZGVyIDogbnVsbDtcclxuICB9XHJcblxyXG4gIC8qIEV2ZXJ5IGZvbGRlciBpbiB0aGUgdmF1bHQsIGVhY2ggcGFyZW50IGxpc3RlZCBiZWZvcmUgaXRzIGNoaWxkcmVuLCBzbyB0aGVcclxuICAgICBzZXR0aW5ncyBwaWNrZXIgcmVhZHMgbGlrZSB0aGUgZmlsZSBleHBsb3Jlci4gKi9cclxuICBhbGxGb2xkZXJQYXRocygpOiBzdHJpbmdbXSB7XHJcbiAgICBjb25zdCBvdXQ6IHN0cmluZ1tdID0gW107XHJcbiAgICBjb25zdCB3YWxrID0gKGZvbGRlcjogVEZvbGRlcikgPT4ge1xyXG4gICAgICBvdXQucHVzaChmb2xkZXIucGF0aCk7XHJcbiAgICAgIGNvbnN0IHN1YnMgPSBmb2xkZXIuY2hpbGRyZW5cclxuICAgICAgICAuZmlsdGVyKChjKTogYyBpcyBURm9sZGVyID0+IGMgaW5zdGFuY2VvZiBURm9sZGVyKVxyXG4gICAgICAgIC5zb3J0KChhLCBiKSA9PiBhLm5hbWUubG9jYWxlQ29tcGFyZShiLm5hbWUpKTtcclxuICAgICAgZm9yIChjb25zdCBzdWIgb2Ygc3Vicykgd2FsayhzdWIpO1xyXG4gICAgfTtcclxuICAgIHdhbGsodGhpcy5hcHAudmF1bHQuZ2V0Um9vdCgpKTtcclxuICAgIHJldHVybiBvdXQ7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGRpc3BsYXlOYW1lKG5hbWU6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgICBpZiAoIXRoaXMuc2V0dGluZ3MuaGlkZVJvdXRpbmVOdW1iZXJpbmcpIHJldHVybiBuYW1lO1xyXG4gICAgY29uc3Qgd2l0aG91dE51bWJlcmluZyA9IG5hbWUucmVwbGFjZSgvXlxccypcXGQrWy4pXVxccysvLCBcIlwiKTtcclxuICAgIHJldHVybiB3aXRob3V0TnVtYmVyaW5nIHx8IG5hbWU7XHJcbiAgfVxyXG5cclxuICAvKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuICAgICBMaXZlIHN5bmMgYmV0d2VlbiBibG9ja3NcclxuICAgICA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi9cclxuXHJcbiAgcHJpdmF0ZSBjaGFuZ2VMaXN0ZW5lcnMgPSBuZXcgU2V0PChlOiBSb3V0aW5lQ2hhbmdlRXZlbnQpID0+IHZvaWQ+KCk7XHJcbiAgcHJpdmF0ZSBibG9ja1NlcSA9IDA7XHJcblxyXG4gIHByaXZhdGUgbmV4dEJsb2NrSWQoKTogc3RyaW5nIHtcclxuICAgIHRoaXMuYmxvY2tTZXEgKz0gMTtcclxuICAgIHJldHVybiBgZnItYmxvY2stJHt0aGlzLmJsb2NrU2VxfWA7XHJcbiAgfVxyXG5cclxuICAvKiBSZWdpc3RlciBhIGxpc3RlbmVyIGJvdW5kIHRvIGEgcmVuZGVyZWQgY29kZSBibG9jazogaXQgaXMgZHJvcHBlZCBhcyBzb29uXHJcbiAgICAgYXMgT2JzaWRpYW4gdW5sb2FkcyB0aGF0IGJsb2NrJ3MgZWxlbWVudC4gKi9cclxuICBwcml2YXRlIHJlZ2lzdGVyQmxvY2tMaXN0ZW5lcihcclxuICAgIGVsOiBIVE1MRWxlbWVudCxcclxuICAgIGN0eDogTWFya2Rvd25Qb3N0UHJvY2Vzc29yQ29udGV4dCxcclxuICAgIGxpc3RlbmVyOiAoZTogUm91dGluZUNoYW5nZUV2ZW50KSA9PiB2b2lkXHJcbiAgKSB7XHJcbiAgICB0aGlzLmNoYW5nZUxpc3RlbmVycy5hZGQobGlzdGVuZXIpO1xyXG4gICAgY29uc3QgY2hpbGQgPSBuZXcgTWFya2Rvd25SZW5kZXJDaGlsZChlbCk7XHJcbiAgICBjaGlsZC5yZWdpc3RlcigoKSA9PiB0aGlzLmNoYW5nZUxpc3RlbmVycy5kZWxldGUobGlzdGVuZXIpKTtcclxuICAgIGN0eC5hZGRDaGlsZChjaGlsZCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGVtaXRSb3V0aW5lQ2hhbmdlKGU6IFJvdXRpbmVDaGFuZ2VFdmVudCkge1xyXG4gICAgZm9yIChjb25zdCBsaXN0ZW5lciBvZiBbLi4udGhpcy5jaGFuZ2VMaXN0ZW5lcnNdKSB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgbGlzdGVuZXIoZSk7XHJcbiAgICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoXCJGb2xkZXIgUm91dGluZXM6IHN5bmMgbGlzdGVuZXIgZmFpbGVkXCIsIGVycik7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgbm9ybWFsaXplRW50cmllcyh2YWw6IHVua25vd24pOiBzdHJpbmdbXSB7XHJcbiAgICBpZiAodmFsID09IG51bGwpIHJldHVybiBbXTtcclxuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbCkpIHJldHVybiB2YWwubWFwKCh2KSA9PiBTdHJpbmcodikpO1xyXG4gICAgcmV0dXJuIFtTdHJpbmcodmFsKV07XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGdldE5vdGVEYXRlKHNvdXJjZVBhdGg6IHN0cmluZyk6IFJldHVyblR5cGU8dHlwZW9mIG1vbWVudD4gfCBudWxsIHtcclxuICAgIGNvbnN0IGJhc2UgPSAoc291cmNlUGF0aC5zcGxpdChcIi9cIikucG9wKCkgPz8gXCJcIikucmVwbGFjZSgvXFwubWQkLywgXCJcIik7XHJcbiAgICBjb25zdCBmbXQgPSBnZXREYWlseU5vdGVGb3JtYXQodGhpcy5hcHApO1xyXG4gICAgY29uc3QgbSA9IG1vbWVudChiYXNlLCBmbXQsIHRydWUpO1xyXG4gICAgcmV0dXJuIG0uaXNWYWxpZCgpID8gbSA6IG51bGw7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGlzQ2hlY2tlZChmaWxlOiBURmlsZSwgZGF0ZVN0cjogc3RyaW5nKTogYm9vbGVhbiB7XHJcbiAgICBjb25zdCBmbSA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpPy5mcm9udG1hdHRlcjtcclxuICAgIGNvbnN0IGVudHJpZXMgPSB0aGlzLm5vcm1hbGl6ZUVudHJpZXMoZm0/Llt0aGlzLnNldHRpbmdzLmVudHJpZXNQcm9wZXJ0eV0pO1xyXG4gICAgcmV0dXJuIGVudHJpZXMuaW5jbHVkZXMoZGF0ZVN0cik7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGdldFN1YnRhc2tzKGZpbGU6IFRGaWxlKTogc3RyaW5nW10ge1xyXG4gICAgY29uc3QgZm0gPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShmaWxlKT8uZnJvbnRtYXR0ZXI7XHJcbiAgICByZXR1cm4gdGhpcy5ub3JtYWxpemVFbnRyaWVzKGZtPy5bdGhpcy5zZXR0aW5ncy5zdWJ0YXNrc1Byb3BlcnR5XSlcclxuICAgICAgLm1hcCgocykgPT4gcy50cmltKCkpXHJcbiAgICAgIC5maWx0ZXIoKHMpID0+IHMubGVuZ3RoID4gMCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIG5vcm1hbGl6ZVN1YnRhc2tFbnRyaWVzKHZhbDogdW5rbm93bik6IFJlY29yZDxzdHJpbmcsIHN0cmluZ1tdPiB7XHJcbiAgICBjb25zdCBvdXQ6IFJlY29yZDxzdHJpbmcsIHN0cmluZ1tdPiA9IHt9O1xyXG4gICAgaWYgKHZhbCA9PSBudWxsIHx8IHR5cGVvZiB2YWwgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWwpKSByZXR1cm4gb3V0O1xyXG4gICAgZm9yIChjb25zdCBba2V5LCB2XSBvZiBPYmplY3QuZW50cmllcyh2YWwgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pKSB7XHJcbiAgICAgIG91dFtrZXldID0gdGhpcy5ub3JtYWxpemVFbnRyaWVzKHYpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIG91dDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgaXNTdWJ0YXNrQ2hlY2tlZChmaWxlOiBURmlsZSwgbmFtZTogc3RyaW5nLCBkYXRlU3RyOiBzdHJpbmcpOiBib29sZWFuIHtcclxuICAgIGNvbnN0IGZtID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoZmlsZSk/LmZyb250bWF0dGVyO1xyXG4gICAgY29uc3QgbWFwID0gdGhpcy5ub3JtYWxpemVTdWJ0YXNrRW50cmllcyhmbT8uW3RoaXMuc2V0dGluZ3Muc3VidGFza0VudHJpZXNQcm9wZXJ0eV0pO1xyXG4gICAgcmV0dXJuIChtYXBbbmFtZV0gPz8gW10pLmluY2x1ZGVzKGRhdGVTdHIpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyByZWNvbmNpbGVTdWJ0YXNrRW50cmllcyhcclxuICAgIGZpbGU6IFRGaWxlLFxyXG4gICAgc3VidGFza3M6IHN0cmluZ1tdXHJcbiAgKTogUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT4+IHtcclxuICAgIGNvbnN0IGVudHJpZXNQcm9wID0gdGhpcy5zZXR0aW5ncy5lbnRyaWVzUHJvcGVydHk7XHJcbiAgICBjb25zdCBzdWJQcm9wID0gdGhpcy5zZXR0aW5ncy5zdWJ0YXNrRW50cmllc1Byb3BlcnR5O1xyXG5cclxuICAgIGNvbnN0IGZtID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoZmlsZSk/LmZyb250bWF0dGVyO1xyXG4gICAgY29uc3QgcGFyZW50RGF0ZXMgPSB0aGlzLm5vcm1hbGl6ZUVudHJpZXMoZm0/LltlbnRyaWVzUHJvcF0pO1xyXG4gICAgY29uc3QgY3VycmVudCA9IHRoaXMubm9ybWFsaXplU3VidGFza0VudHJpZXMoZm0/LltzdWJQcm9wXSk7XHJcblxyXG4gICAgY29uc3QgcmVzb2x2ZWQ6IFJlY29yZDxzdHJpbmcsIHN0cmluZ1tdPiA9IHt9O1xyXG4gICAgbGV0IGNoYW5nZWQgPSBmYWxzZTtcclxuICAgIGZvciAoY29uc3QgbmFtZSBvZiBzdWJ0YXNrcykge1xyXG4gICAgICBjb25zdCBzZXQgPSBuZXcgU2V0KGN1cnJlbnRbbmFtZV0gPz8gW10pO1xyXG4gICAgICBjb25zdCBiZWZvcmUgPSBzZXQuc2l6ZTtcclxuICAgICAgZm9yIChjb25zdCBkIG9mIHBhcmVudERhdGVzKSBzZXQuYWRkKGQpO1xyXG4gICAgICBpZiAoc2V0LnNpemUgIT09IGJlZm9yZSkgY2hhbmdlZCA9IHRydWU7XHJcbiAgICAgIHJlc29sdmVkW25hbWVdID0gWy4uLnNldF0uc29ydCgpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChjaGFuZ2VkKSB7XHJcbiAgICAgIGF3YWl0IHRoaXMuYXBwLmZpbGVNYW5hZ2VyLnByb2Nlc3NGcm9udE1hdHRlcihmaWxlLCAoZm13KSA9PiB7XHJcbiAgICAgICAgY29uc3QgcERhdGVzID0gdGhpcy5ub3JtYWxpemVFbnRyaWVzKGZtd1tlbnRyaWVzUHJvcF0pO1xyXG4gICAgICAgIGNvbnN0IG1hcCA9IHRoaXMubm9ybWFsaXplU3VidGFza0VudHJpZXMoZm13W3N1YlByb3BdKTtcclxuICAgICAgICBmb3IgKGNvbnN0IG5hbWUgb2Ygc3VidGFza3MpIHtcclxuICAgICAgICAgIGNvbnN0IHNldCA9IG5ldyBTZXQobWFwW25hbWVdID8/IFtdKTtcclxuICAgICAgICAgIGZvciAoY29uc3QgZCBvZiBwRGF0ZXMpIHNldC5hZGQoZCk7XHJcbiAgICAgICAgICBtYXBbbmFtZV0gPSBbLi4uc2V0XS5zb3J0KCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGZtd1tzdWJQcm9wXSA9IG1hcDtcclxuICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHJlc29sdmVkO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBzZXRFbnRyeShmaWxlOiBURmlsZSwgZGF0ZVN0cjogc3RyaW5nLCBjaGVja2VkOiBib29sZWFuKSB7XHJcbiAgICBjb25zdCBwcm9wID0gdGhpcy5zZXR0aW5ncy5lbnRyaWVzUHJvcGVydHk7XHJcbiAgICBhd2FpdCB0aGlzLmFwcC5maWxlTWFuYWdlci5wcm9jZXNzRnJvbnRNYXR0ZXIoZmlsZSwgKGZtKSA9PiB7XHJcbiAgICAgIGxldCBlbnRyaWVzID0gdGhpcy5ub3JtYWxpemVFbnRyaWVzKGZtW3Byb3BdKTtcclxuICAgICAgaWYgKGNoZWNrZWQpIHtcclxuICAgICAgICBpZiAoIWVudHJpZXMuaW5jbHVkZXMoZGF0ZVN0cikpIGVudHJpZXMucHVzaChkYXRlU3RyKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBlbnRyaWVzID0gZW50cmllcy5maWx0ZXIoKGUpID0+IGUgIT09IGRhdGVTdHIpO1xyXG4gICAgICB9XHJcbiAgICAgIGVudHJpZXMuc29ydCgpO1xyXG4gICAgICBmbVtwcm9wXSA9IGVudHJpZXM7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgc2V0U3VidGFza0VudHJ5KFxyXG4gICAgZmlsZTogVEZpbGUsXHJcbiAgICBuYW1lOiBzdHJpbmcsXHJcbiAgICBkYXRlU3RyOiBzdHJpbmcsXHJcbiAgICBjaGVja2VkOiBib29sZWFuLFxyXG4gICAgYWxsU3VidGFza3M6IHN0cmluZ1tdXHJcbiAgKTogUHJvbWlzZTxib29sZWFuPiB7XHJcbiAgICBjb25zdCBlbnRyaWVzUHJvcCA9IHRoaXMuc2V0dGluZ3MuZW50cmllc1Byb3BlcnR5O1xyXG4gICAgY29uc3Qgc3ViUHJvcCA9IHRoaXMuc2V0dGluZ3Muc3VidGFza0VudHJpZXNQcm9wZXJ0eTtcclxuICAgIGxldCBwYXJlbnRDaGVja2VkID0gZmFsc2U7XHJcbiAgICBhd2FpdCB0aGlzLmFwcC5maWxlTWFuYWdlci5wcm9jZXNzRnJvbnRNYXR0ZXIoZmlsZSwgKGZtKSA9PiB7XHJcbiAgICAgIGNvbnN0IG1hcCA9IHRoaXMubm9ybWFsaXplU3VidGFza0VudHJpZXMoZm1bc3ViUHJvcF0pO1xyXG4gICAgICBsZXQgZGF0ZXMgPSBtYXBbbmFtZV0gPz8gW107XHJcbiAgICAgIGlmIChjaGVja2VkKSB7XHJcbiAgICAgICAgaWYgKCFkYXRlcy5pbmNsdWRlcyhkYXRlU3RyKSkgZGF0ZXMucHVzaChkYXRlU3RyKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBkYXRlcyA9IGRhdGVzLmZpbHRlcigoZCkgPT4gZCAhPT0gZGF0ZVN0cik7XHJcbiAgICAgIH1cclxuICAgICAgZGF0ZXMuc29ydCgpO1xyXG4gICAgICBtYXBbbmFtZV0gPSBkYXRlcztcclxuXHJcbiAgICAgIGNvbnN0IGFsbERvbmUgPSBhbGxTdWJ0YXNrcy5ldmVyeSgocykgPT4gKG1hcFtzXSA/PyBbXSkuaW5jbHVkZXMoZGF0ZVN0cikpO1xyXG4gICAgICBwYXJlbnRDaGVja2VkID0gYWxsRG9uZTtcclxuICAgICAgbGV0IGVudHJpZXMgPSB0aGlzLm5vcm1hbGl6ZUVudHJpZXMoZm1bZW50cmllc1Byb3BdKTtcclxuICAgICAgaWYgKGFsbERvbmUpIHtcclxuICAgICAgICBpZiAoIWVudHJpZXMuaW5jbHVkZXMoZGF0ZVN0cikpIGVudHJpZXMucHVzaChkYXRlU3RyKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBlbnRyaWVzID0gZW50cmllcy5maWx0ZXIoKGUpID0+IGUgIT09IGRhdGVTdHIpO1xyXG4gICAgICB9XHJcbiAgICAgIGVudHJpZXMuc29ydCgpO1xyXG4gICAgICBmbVtlbnRyaWVzUHJvcF0gPSBlbnRyaWVzO1xyXG5cclxuICAgICAgaWYgKE9iamVjdC5rZXlzKG1hcCkubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgZGVsZXRlIGZtW3N1YlByb3BdO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGZtW3N1YlByb3BdID0gbWFwO1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuICAgIHJldHVybiBwYXJlbnRDaGVja2VkO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBzZXRQYXJlbnRUb2dnbGVBbGwoXHJcbiAgICBmaWxlOiBURmlsZSxcclxuICAgIGRhdGVTdHI6IHN0cmluZyxcclxuICAgIGNoZWNrZWQ6IGJvb2xlYW4sXHJcbiAgICBhbGxTdWJ0YXNrczogc3RyaW5nW11cclxuICApIHtcclxuICAgIGNvbnN0IGVudHJpZXNQcm9wID0gdGhpcy5zZXR0aW5ncy5lbnRyaWVzUHJvcGVydHk7XHJcbiAgICBjb25zdCBzdWJQcm9wID0gdGhpcy5zZXR0aW5ncy5zdWJ0YXNrRW50cmllc1Byb3BlcnR5O1xyXG4gICAgYXdhaXQgdGhpcy5hcHAuZmlsZU1hbmFnZXIucHJvY2Vzc0Zyb250TWF0dGVyKGZpbGUsIChmbSkgPT4ge1xyXG4gICAgICBjb25zdCBtYXAgPSB0aGlzLm5vcm1hbGl6ZVN1YnRhc2tFbnRyaWVzKGZtW3N1YlByb3BdKTtcclxuICAgICAgZm9yIChjb25zdCBuYW1lIG9mIGFsbFN1YnRhc2tzKSB7XHJcbiAgICAgICAgbGV0IGRhdGVzID0gbWFwW25hbWVdID8/IFtdO1xyXG4gICAgICAgIGlmIChjaGVja2VkKSB7XHJcbiAgICAgICAgICBpZiAoIWRhdGVzLmluY2x1ZGVzKGRhdGVTdHIpKSBkYXRlcy5wdXNoKGRhdGVTdHIpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICBkYXRlcyA9IGRhdGVzLmZpbHRlcigoZCkgPT4gZCAhPT0gZGF0ZVN0cik7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGRhdGVzLnNvcnQoKTtcclxuICAgICAgICBtYXBbbmFtZV0gPSBkYXRlcztcclxuICAgICAgfVxyXG5cclxuICAgICAgbGV0IGVudHJpZXMgPSB0aGlzLm5vcm1hbGl6ZUVudHJpZXMoZm1bZW50cmllc1Byb3BdKTtcclxuICAgICAgaWYgKGNoZWNrZWQpIHtcclxuICAgICAgICBpZiAoIWVudHJpZXMuaW5jbHVkZXMoZGF0ZVN0cikpIGVudHJpZXMucHVzaChkYXRlU3RyKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBlbnRyaWVzID0gZW50cmllcy5maWx0ZXIoKGUpID0+IGUgIT09IGRhdGVTdHIpO1xyXG4gICAgICB9XHJcbiAgICAgIGVudHJpZXMuc29ydCgpO1xyXG4gICAgICBmbVtlbnRyaWVzUHJvcF0gPSBlbnRyaWVzO1xyXG5cclxuICAgICAgaWYgKE9iamVjdC5rZXlzKG1hcCkubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgZGVsZXRlIGZtW3N1YlByb3BdO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGZtW3N1YlByb3BdID0gbWFwO1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgcmVuZGVyUm91dGluZXMoZWw6IEhUTUxFbGVtZW50LCBjdHg6IE1hcmtkb3duUG9zdFByb2Nlc3NvckNvbnRleHQpIHtcclxuICAgIGVsLmVtcHR5KCk7XHJcblxyXG4gICAgY29uc3Qgcm9vdCA9IHRoaXMucm91dGluZXNSb290KCk7XHJcbiAgICBpZiAoIXJvb3QpIHtcclxuICAgICAgZWwuY3JlYXRlRGl2KHtcclxuICAgICAgICBjbHM6IFwiZm9sZGVyLXJvdXRpbmVzLWVycm9yXCIsXHJcbiAgICAgICAgdGV4dDogYEZvbGRlciBSb3V0aW5lczogZm9sZGVyIFwiJHt0aGlzLnNldHRpbmdzLnJvdXRpbmVzRm9sZGVyfVwiIG5vdCBmb3VuZC4gU2V0IGl0IGluIHBsdWdpbiBzZXR0aW5ncy5gLFxyXG4gICAgICB9KTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGRhdGUgPSB0aGlzLmdldE5vdGVEYXRlKGN0eC5zb3VyY2VQYXRoKTtcclxuICAgIGlmICghZGF0ZSkge1xyXG4gICAgICBlbC5jcmVhdGVEaXYoe1xyXG4gICAgICAgIGNsczogXCJmb2xkZXItcm91dGluZXMtZXJyb3JcIixcclxuICAgICAgICB0ZXh0OiBcIkZvbGRlciBSb3V0aW5lczogY291bGQgbm90IHBhcnNlIGEgZGF0ZSBmcm9tIHRoaXMgbm90ZSdzIGZpbGVuYW1lIChleHBlY3RlZCBhIGRhaWx5IG5vdGUpLlwiLFxyXG4gICAgICB9KTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGRhdGVTdHIgPSBkYXRlLmZvcm1hdCh0aGlzLnNldHRpbmdzLnN0b3JlRGF0ZUZvcm1hdCB8fCBcIllZWVktTU0tRERcIik7XHJcbiAgICBjb25zdCBjb250YWluZXIgPSBlbC5jcmVhdGVEaXYoeyBjbHM6IFwiZm9sZGVyLXJvdXRpbmVzXCIgfSk7XHJcblxyXG4gICAgY29uc3Qgc2VjdGlvbiA9IGNvbnRhaW5lci5jcmVhdGVEaXYoe1xyXG4gICAgICBjbHM6IFwiZm9sZGVyLXJvdXRpbmVzLXNlY3Rpb24gZm9sZGVyLXJvdXRpbmVzLXJvb3RcIixcclxuICAgIH0pO1xyXG4gICAgY29uc3QgaGVhZGVyID0gc2VjdGlvbi5jcmVhdGVFbChcImgyXCIsIHsgY2xzOiBcImZvbGRlci1yb3V0aW5lcy1oZWFkaW5nXCIgfSk7XHJcbiAgICBoZWFkZXIuY3JlYXRlU3Bhbih7IGNsczogXCJmb2xkZXItcm91dGluZXMtaGVhZGluZy10aXRsZVwiLCB0ZXh0OiBcIkhhYml0c1wiIH0pO1xyXG4gICAgdGhpcy5jcmVhdGVQcm9ncmVzcyhoZWFkZXIpO1xyXG5cclxuICAgIGNvbnN0IGJvZHkgPSBzZWN0aW9uLmNyZWF0ZURpdih7IGNsczogXCJmb2xkZXItcm91dGluZXMtYm9keVwiIH0pO1xyXG4gICAgY29uc3Qgc3luYzogQmxvY2tTeW5jID0geyBpZDogdGhpcy5uZXh0QmxvY2tJZCgpLCBzZXR0ZXJzOiBuZXcgTWFwKCkgfTtcclxuICAgIGF3YWl0IHRoaXMucmVuZGVyRm9sZGVyKHJvb3QsIGJvZHksIGRhdGVTdHIsIDMsIHN5bmMpO1xyXG4gICAgdGhpcy51cGRhdGVTZWN0aW9uUHJvZ3Jlc3Moc2VjdGlvbik7XHJcblxyXG4gICAgdGhpcy5yZWdpc3RlckJsb2NrTGlzdGVuZXIoZWwsIGN0eCwgKGV2KSA9PiB7XHJcbiAgICAgIGlmIChldi5vcmlnaW5JZCA9PT0gc3luYy5pZCB8fCBldi5kYXRlU3RyICE9PSBkYXRlU3RyKSByZXR1cm47XHJcbiAgICAgIHN5bmMuc2V0dGVycy5nZXQobWFrZVJlZihldi5wYXRoLCBldi5zdWJ0YXNrKSk/Lihldi5jaGVja2VkKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGhlYWRlci5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICBzZWN0aW9uLnRvZ2dsZUNsYXNzKFwiaXMtY29sbGFwc2VkXCIsICFzZWN0aW9uLmhhc0NsYXNzKFwiaXMtY29sbGFwc2VkXCIpKTtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyByZW5kZXJGb2xkZXIoXHJcbiAgICBmb2xkZXI6IFRGb2xkZXIsXHJcbiAgICBjb250YWluZXI6IEhUTUxFbGVtZW50LFxyXG4gICAgZGF0ZVN0cjogc3RyaW5nLFxyXG4gICAgZGVwdGg6IG51bWJlcixcclxuICAgIHN5bmM6IEJsb2NrU3luY1xyXG4gICkge1xyXG4gICAgY29uc3QgY2hpbGRyZW4gPSBbLi4uZm9sZGVyLmNoaWxkcmVuXS5zb3J0KChhLCBiKSA9PlxyXG4gICAgICBhLm5hbWUubG9jYWxlQ29tcGFyZShiLm5hbWUpXHJcbiAgICApO1xyXG4gICAgY29uc3QgZmlsZXMgPSBjaGlsZHJlbi5maWx0ZXIoXHJcbiAgICAgIChjKTogYyBpcyBURmlsZSA9PiBjIGluc3RhbmNlb2YgVEZpbGUgJiYgYy5leHRlbnNpb24gPT09IFwibWRcIlxyXG4gICAgKTtcclxuICAgIGNvbnN0IHN1YmZvbGRlcnMgPSBjaGlsZHJlbi5maWx0ZXIoXHJcbiAgICAgIChjKTogYyBpcyBURm9sZGVyID0+IGMgaW5zdGFuY2VvZiBURm9sZGVyXHJcbiAgICApO1xyXG5cclxuICAgIGxldCBpbmRleCA9IDA7XHJcbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgZmlsZXMpIHtcclxuICAgICAgaW5kZXgrKztcclxuICAgICAgYXdhaXQgdGhpcy5yZW5kZXJJdGVtKGZpbGUsIGNvbnRhaW5lciwgZGF0ZVN0ciwgaW5kZXgsIHN5bmMpO1xyXG4gICAgfVxyXG5cclxuICAgIGZvciAobGV0IHNlY3Rpb25JbmRleCA9IDA7IHNlY3Rpb25JbmRleCA8IHN1YmZvbGRlcnMubGVuZ3RoOyBzZWN0aW9uSW5kZXgrKykge1xyXG4gICAgICBjb25zdCBzdWIgPSBzdWJmb2xkZXJzW3NlY3Rpb25JbmRleF07XHJcbiAgICAgIGNvbnN0IHNlY3Rpb24gPSBjb250YWluZXIuY3JlYXRlRGl2KHsgY2xzOiBcImZvbGRlci1yb3V0aW5lcy1zZWN0aW9uXCIgfSk7XHJcbiAgICAgIGNvbnN0IGNvbG9ySW5kZXggPSBzZWN0aW9uSW5kZXggJSBGb2xkZXJSb3V0aW5lc1BsdWdpbi5TRUNUSU9OX0NPTE9SUztcclxuICAgICAgc2VjdGlvbi5hZGRDbGFzcyhgZm9sZGVyLXJvdXRpbmVzLWNvbG9yLSR7Y29sb3JJbmRleCArIDF9YCk7XHJcbiAgICAgIGNvbnN0IHRhZyA9IChcImhcIiArIE1hdGgubWluKGRlcHRoLCA2KSkgYXMga2V5b2YgSFRNTEVsZW1lbnRUYWdOYW1lTWFwO1xyXG4gICAgICBjb25zdCBoZWFkZXIgPSBzZWN0aW9uLmNyZWF0ZUVsKHRhZywgeyBjbHM6IFwiZm9sZGVyLXJvdXRpbmVzLWhlYWRpbmdcIiB9KTtcclxuICAgICAgaGVhZGVyLmNyZWF0ZVNwYW4oe1xyXG4gICAgICAgIGNsczogXCJmb2xkZXItcm91dGluZXMtaGVhZGluZy10aXRsZVwiLFxyXG4gICAgICAgIHRleHQ6IHRoaXMuZGlzcGxheU5hbWUoc3ViLm5hbWUpLFxyXG4gICAgICB9KTtcclxuICAgICAgdGhpcy5jcmVhdGVQcm9ncmVzcyhoZWFkZXIpO1xyXG5cclxuICAgICAgY29uc3QgYm9keSA9IHNlY3Rpb24uY3JlYXRlRGl2KHsgY2xzOiBcImZvbGRlci1yb3V0aW5lcy1ib2R5XCIgfSk7XHJcbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyRm9sZGVyKHN1YiwgYm9keSwgZGF0ZVN0ciwgZGVwdGggKyAxLCBzeW5jKTtcclxuICAgICAgdGhpcy51cGRhdGVTZWN0aW9uUHJvZ3Jlc3Moc2VjdGlvbik7XHJcblxyXG4gICAgICBoZWFkZXIuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcclxuICAgICAgICBzZWN0aW9uLnRvZ2dsZUNsYXNzKFwiaXMtY29sbGFwc2VkXCIsICFzZWN0aW9uLmhhc0NsYXNzKFwiaXMtY29sbGFwc2VkXCIpKTtcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHN0YXRpYyByZWFkb25seSBTRUNUSU9OX0NPTE9SUyA9IDQ7XHJcblxyXG4gIHByaXZhdGUgY3JlYXRlUHJvZ3Jlc3MoaGVhZGVyOiBIVE1MRWxlbWVudCkge1xyXG4gICAgY29uc3QgcHJvZ3Jlc3MgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImZvbGRlci1yb3V0aW5lcy1wcm9ncmVzc1wiIH0pO1xyXG4gICAgY29uc3QgYmFkZ2UgPSBwcm9ncmVzcy5jcmVhdGVEaXYoeyBjbHM6IFwiZm9sZGVyLXJvdXRpbmVzLXByb2dyZXNzLWJhZGdlXCIgfSk7XHJcbiAgICBiYWRnZS5jcmVhdGVTcGFuKHsgY2xzOiBcImZvbGRlci1yb3V0aW5lcy1wcm9ncmVzcy1sYWJlbFwiLCB0ZXh0OiBcIlFVRVNUU1wiIH0pO1xyXG4gICAgYmFkZ2UuY3JlYXRlU3Bhbih7IGNsczogXCJmb2xkZXItcm91dGluZXMtcHJvZ3Jlc3MtY291bnRcIiwgdGV4dDogXCIwLzBcIiB9KTtcclxuICAgIGNvbnN0IGJhciA9IHByb2dyZXNzLmNyZWF0ZURpdih7IGNsczogXCJmb2xkZXItcm91dGluZXMtcHJvZ3Jlc3MtYmFyXCIgfSk7XHJcbiAgICBiYXIuY3JlYXRlRGl2KHsgY2xzOiBcImZvbGRlci1yb3V0aW5lcy1wcm9ncmVzcy1maWxsXCIgfSk7XHJcbiAgfVxyXG4gIHByaXZhdGUgb25BbmltYXRpb25Db21wbGV0ZShcclxuICAgIGVsZW1lbnQ6IEhUTUxFbGVtZW50LFxyXG4gICAgYW5pbWF0aW9uTmFtZTogc3RyaW5nLFxyXG4gICAgY29tcGxldGU6ICgpID0+IHZvaWRcclxuICApIHtcclxuICAgIGxldCBjb21wbGV0ZWQgPSBmYWxzZTtcclxuICAgIGNvbnN0IGZpbmlzaCA9IChldmVudD86IEFuaW1hdGlvbkV2ZW50KSA9PiB7XHJcbiAgICAgIGlmIChcclxuICAgICAgICBldmVudCAmJlxyXG4gICAgICAgIChldmVudC50YXJnZXQgIT09IGVsZW1lbnQgfHwgZXZlbnQuYW5pbWF0aW9uTmFtZSAhPT0gYW5pbWF0aW9uTmFtZSlcclxuICAgICAgKVxyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgaWYgKGNvbXBsZXRlZCkgcmV0dXJuO1xyXG4gICAgICBjb21wbGV0ZWQgPSB0cnVlO1xyXG4gICAgICBlbGVtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJhbmltYXRpb25lbmRcIiwgZmluaXNoKTtcclxuICAgICAgZWxlbWVudC5yZW1vdmVFdmVudExpc3RlbmVyKFwiYW5pbWF0aW9uY2FuY2VsXCIsIGZpbmlzaCk7XHJcbiAgICAgIGNvbXBsZXRlKCk7XHJcbiAgICB9O1xyXG5cclxuICAgIGVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihcImFuaW1hdGlvbmVuZFwiLCBmaW5pc2gpO1xyXG4gICAgZWxlbWVudC5hZGRFdmVudExpc3RlbmVyKFwiYW5pbWF0aW9uY2FuY2VsXCIsIGZpbmlzaCk7XHJcbiAgICBjb25zdCBhY3RpdmVBbmltYXRpb25zID0gd2luZG93XHJcbiAgICAgIC5nZXRDb21wdXRlZFN0eWxlKGVsZW1lbnQpXHJcbiAgICAgIC5hbmltYXRpb25OYW1lLnNwbGl0KFwiLFwiKVxyXG4gICAgICAubWFwKChuYW1lKSA9PiBuYW1lLnRyaW0oKSk7XHJcbiAgICBpZiAoIWFjdGl2ZUFuaW1hdGlvbnMuaW5jbHVkZXMoYW5pbWF0aW9uTmFtZSkpIGZpbmlzaCgpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSB1cGRhdGVTZWN0aW9uUHJvZ3Jlc3Moc2VjdGlvbjogSFRNTEVsZW1lbnQpIHtcclxuICAgIGNvbnN0IGNoZWNrYm94ZXMgPSBBcnJheS5mcm9tKFxyXG4gICAgICBzZWN0aW9uLnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTElucHV0RWxlbWVudD4oXCIuZm9sZGVyLXJvdXRpbmVzLXByb2dyZXNzLWNoZWNrYm94XCIpXHJcbiAgICApO1xyXG4gICAgY29uc3QgdG90YWwgPSBjaGVja2JveGVzLmxlbmd0aDtcclxuICAgIGNvbnN0IGRvbmUgPSBjaGVja2JveGVzLmZpbHRlcigoY2hlY2tib3gpID0+IGNoZWNrYm94LmNoZWNrZWQpLmxlbmd0aDtcclxuICAgIGNvbnN0IHByb2dyZXNzID0gc2VjdGlvbi5xdWVyeVNlbGVjdG9yPEhUTUxFbGVtZW50PihcclxuICAgICAgXCI6c2NvcGUgPiAuZm9sZGVyLXJvdXRpbmVzLWhlYWRpbmcgLmZvbGRlci1yb3V0aW5lcy1wcm9ncmVzc1wiXHJcbiAgICApO1xyXG4gICAgaWYgKCFwcm9ncmVzcykgcmV0dXJuO1xyXG5cclxuICAgIGNvbnN0IGNvdW50ID0gcHJvZ3Jlc3MucXVlcnlTZWxlY3RvcjxIVE1MRWxlbWVudD4oXCIuZm9sZGVyLXJvdXRpbmVzLXByb2dyZXNzLWNvdW50XCIpO1xyXG4gICAgaWYgKGNvdW50KSBjb3VudC5zZXRUZXh0KGAke2RvbmV9LyR7dG90YWx9YCk7XHJcblxyXG4gICAgY29uc3QgZmlsbCA9IHByb2dyZXNzLnF1ZXJ5U2VsZWN0b3I8SFRNTEVsZW1lbnQ+KFwiLmZvbGRlci1yb3V0aW5lcy1wcm9ncmVzcy1maWxsXCIpO1xyXG4gICAgY29uc3QgcmF0aW8gPSB0b3RhbCA9PT0gMCA/IDAgOiBkb25lIC8gdG90YWw7XHJcbiAgICBpZiAoZmlsbCkgZmlsbC5zdHlsZS5zZXRQcm9wZXJ0eShcIi0tZnItcHJvZ3Jlc3NcIiwgYCR7cmF0aW8gKiAxMDB9JWApO1xyXG5cclxuICAgIGNvbnN0IHdhc0NvbXBsZXRlID0gc2VjdGlvbi5oYXNDbGFzcyhcImlzLWNvbXBsZXRlXCIpO1xyXG4gICAgY29uc3QgaXNDb21wbGV0ZSA9IHRvdGFsID4gMCAmJiBkb25lID09PSB0b3RhbDtcclxuICAgIHNlY3Rpb24udG9nZ2xlQ2xhc3MoXCJpcy1jb21wbGV0ZVwiLCBpc0NvbXBsZXRlKTtcclxuICAgIGlmIChpc0NvbXBsZXRlICYmICF3YXNDb21wbGV0ZSkge1xyXG4gICAgICBzZWN0aW9uLmFkZENsYXNzKFwiaXMtanVzdC1jb21wbGV0ZWRcIik7XHJcbiAgICAgIGNvbnN0IGhlYWRlciA9IHNlY3Rpb24ucXVlcnlTZWxlY3RvcjxIVE1MRWxlbWVudD4oXHJcbiAgICAgICAgXCI6c2NvcGUgPiAuZm9sZGVyLXJvdXRpbmVzLWhlYWRpbmdcIlxyXG4gICAgICApO1xyXG4gICAgICBpZiAoaGVhZGVyKSB7XHJcbiAgICAgICAgdGhpcy5vbkFuaW1hdGlvbkNvbXBsZXRlKGhlYWRlciwgXCJmci1zZWN0aW9uLWZsYXNoXCIsICgpID0+XHJcbiAgICAgICAgICBzZWN0aW9uLnJlbW92ZUNsYXNzKFwiaXMtanVzdC1jb21wbGV0ZWRcIilcclxuICAgICAgICApO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIHNlY3Rpb24ucmVtb3ZlQ2xhc3MoXCJpcy1qdXN0LWNvbXBsZXRlZFwiKTtcclxuICAgICAgfVxyXG4gICAgICB0aGlzLnNob3dRdWVzdEJhbm5lcihzZWN0aW9uKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgc2hvd1F1ZXN0QmFubmVyKHNlY3Rpb246IEhUTUxFbGVtZW50KSB7XHJcbiAgICBjb25zdCBoZWFkZXIgPSBzZWN0aW9uLnF1ZXJ5U2VsZWN0b3I8SFRNTEVsZW1lbnQ+KFxyXG4gICAgICBcIjpzY29wZSA+IC5mb2xkZXItcm91dGluZXMtaGVhZGluZ1wiXHJcbiAgICApO1xyXG4gICAgaWYgKCFoZWFkZXIpIHJldHVybjtcclxuICAgIGNvbnN0IGJhbm5lciA9IGhlYWRlci5jcmVhdGVEaXYoe1xyXG4gICAgICBjbHM6IFwiZm9sZGVyLXJvdXRpbmVzLXF1ZXN0LWJhbm5lclwiLFxyXG4gICAgICB0ZXh0OiBcIlx1MjYwNSBRVUVTVCBDT01QTEVURSBcdTI2MDVcIixcclxuICAgIH0pO1xyXG4gICAgdGhpcy5vbkFuaW1hdGlvbkNvbXBsZXRlKGJhbm5lciwgXCJmci1iYW5uZXJcIiwgKCkgPT4gYmFubmVyLnJlbW92ZSgpKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc2hvd1hwUG9wdXAoaG9zdDogSFRNTEVsZW1lbnQpIHtcclxuICAgIGNvbnN0IHBvcHVwID0gaG9zdC5jcmVhdGVTcGFuKHtcclxuICAgICAgY2xzOiBcImZvbGRlci1yb3V0aW5lcy14cC1wb3B1cFwiLFxyXG4gICAgICB0ZXh0OiBcIis1IFhQXCIsXHJcbiAgICB9KTtcclxuICAgIHRoaXMub25BbmltYXRpb25Db21wbGV0ZShwb3B1cCwgXCJmci14cFwiLCAoKSA9PiBwb3B1cC5yZW1vdmUoKSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGdldENhdGVnb3J5SWNvbihfbmFtZTogc3RyaW5nKTogc3RyaW5nIHtcclxuICAgIC8vIFNpbmdsZSByZXRybyBkZWZhdWx0IGljb24gZm9yIGV2ZXJ5IHNlY3Rpb24uXHJcbiAgICByZXR1cm4gXCJcdTI1QzZcIjtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgdXBkYXRlQW5jZXN0b3JQcm9ncmVzcyhmcm9tOiBIVE1MRWxlbWVudCkge1xyXG4gICAgbGV0IHNlY3Rpb24gPSBmcm9tLmNsb3Nlc3Q8SFRNTEVsZW1lbnQ+KFwiLmZvbGRlci1yb3V0aW5lcy1zZWN0aW9uXCIpO1xyXG4gICAgd2hpbGUgKHNlY3Rpb24pIHtcclxuICAgICAgdGhpcy51cGRhdGVTZWN0aW9uUHJvZ3Jlc3Moc2VjdGlvbik7XHJcbiAgICAgIHNlY3Rpb24gPSBzZWN0aW9uLnBhcmVudEVsZW1lbnQ/LmNsb3Nlc3Q8SFRNTEVsZW1lbnQ+KFwiLmZvbGRlci1yb3V0aW5lcy1zZWN0aW9uXCIpID8/IG51bGw7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHdpcmVTZWxlY3Rpb24oaXRlbUVsOiBIVE1MRWxlbWVudCkge1xyXG4gICAgY29uc3Qgc2VsZWN0ID0gKCkgPT4ge1xyXG4gICAgICBjb25zdCByb290ID0gaXRlbUVsLmNsb3Nlc3Q8SFRNTEVsZW1lbnQ+KFwiLmZvbGRlci1yb3V0aW5lc1wiKTtcclxuICAgICAgcm9vdFxyXG4gICAgICAgID8ucXVlcnlTZWxlY3RvckFsbChcIi5pcy1zZWxlY3RlZFwiKVxyXG4gICAgICAgIC5mb3JFYWNoKChuKSA9PiBuLnJlbW92ZUNsYXNzKFwiaXMtc2VsZWN0ZWRcIikpO1xyXG4gICAgICBpdGVtRWwuYWRkQ2xhc3MoXCJpcy1zZWxlY3RlZFwiKTtcclxuICAgIH07XHJcbiAgICBpdGVtRWwuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJkb3duXCIsIHNlbGVjdCk7XHJcbiAgICBpdGVtRWwuYWRkRXZlbnRMaXN0ZW5lcihcImZvY3VzaW5cIiwgc2VsZWN0KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgcmVuZGVySXRlbShcclxuICAgIGZpbGU6IFRGaWxlLFxyXG4gICAgY29udGFpbmVyOiBIVE1MRWxlbWVudCxcclxuICAgIGRhdGVTdHI6IHN0cmluZyxcclxuICAgIGluZGV4ID0gMCxcclxuICAgIHN5bmM/OiBCbG9ja1N5bmNcclxuICApIHtcclxuICAgIGNvbnN0IHN1YnRhc2tzID0gdGhpcy5nZXRTdWJ0YXNrcyhmaWxlKTtcclxuICAgIGNvbnN0IGl0ZW1FbCA9IGNvbnRhaW5lci5jcmVhdGVEaXYoeyBjbHM6IFwiZm9sZGVyLXJvdXRpbmVzLWl0ZW1cIiB9KTtcclxuICAgIGl0ZW1FbC50YWJJbmRleCA9IDA7XHJcbiAgICB0aGlzLndpcmVTZWxlY3Rpb24oaXRlbUVsKTtcclxuICAgIGNvbnN0IGxhYmVsID0gaXRlbUVsLmNyZWF0ZUVsKFwibGFiZWxcIiwgeyBjbHM6IFwiZm9sZGVyLXJvdXRpbmVzLWxhYmVsXCIgfSk7XHJcbiAgICBpZiAoaW5kZXggPiAwICYmICF0aGlzLnNldHRpbmdzLmhpZGVSb3V0aW5lTnVtYmVyaW5nKSB7XHJcbiAgICAgIGxhYmVsLmNyZWF0ZVNwYW4oe1xyXG4gICAgICAgIGNsczogXCJmb2xkZXItcm91dGluZXMtaW5kZXhcIixcclxuICAgICAgICB0ZXh0OiBTdHJpbmcoaW5kZXgpLnBhZFN0YXJ0KDIsIFwiMFwiKSxcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICBjb25zdCBjaGVja2JveCA9IGxhYmVsLmNyZWF0ZUVsKFwiaW5wdXRcIiwge1xyXG4gICAgICB0eXBlOiBcImNoZWNrYm94XCIsXHJcbiAgICB9KSBhcyBIVE1MSW5wdXRFbGVtZW50O1xyXG4gICAgY2hlY2tib3guY2xhc3NMaXN0LmFkZChcImZvbGRlci1yb3V0aW5lcy1jaGVja2JveFwiKTtcclxuICAgIGxhYmVsLmNyZWF0ZVNwYW4oe1xyXG4gICAgICB0ZXh0OiB0aGlzLmRpc3BsYXlOYW1lKGZpbGUuYmFzZW5hbWUpLFxyXG4gICAgICBjbHM6IFwiZm9sZGVyLXJvdXRpbmVzLXRleHRcIixcclxuICAgIH0pO1xyXG5cclxuICAgIGlmIChzdWJ0YXNrcy5sZW5ndGggPT09IDApIHtcclxuICAgICAgY2hlY2tib3guY2xhc3NMaXN0LmFkZChcImZvbGRlci1yb3V0aW5lcy1wcm9ncmVzcy1jaGVja2JveFwiKTtcclxuICAgICAgY2hlY2tib3guY2hlY2tlZCA9IHRoaXMuaXNDaGVja2VkKGZpbGUsIGRhdGVTdHIpO1xyXG4gICAgICBpdGVtRWwudG9nZ2xlQ2xhc3MoXCJpcy1jaGVja2VkXCIsIGNoZWNrYm94LmNoZWNrZWQpO1xyXG5cclxuICAgICAgc3luYz8uc2V0dGVycy5zZXQoZmlsZS5wYXRoLCAoY2hlY2tlZCkgPT4ge1xyXG4gICAgICAgIGlmIChjaGVja2JveC5jaGVja2VkID09PSBjaGVja2VkKSByZXR1cm47XHJcbiAgICAgICAgY2hlY2tib3guY2hlY2tlZCA9IGNoZWNrZWQ7XHJcbiAgICAgICAgaXRlbUVsLnRvZ2dsZUNsYXNzKFwiaXMtY2hlY2tlZFwiLCBjaGVja2VkKTtcclxuICAgICAgICB0aGlzLnVwZGF0ZUFuY2VzdG9yUHJvZ3Jlc3MoaXRlbUVsKTtcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjaGVja2JveC5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlXCIsIGFzeW5jICgpID0+IHtcclxuICAgICAgICBjb25zdCB0YXJnZXQgPSBjaGVja2JveC5jaGVja2VkO1xyXG4gICAgICAgIGNoZWNrYm94LmRpc2FibGVkID0gdHJ1ZTtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgYXdhaXQgdGhpcy5zZXRFbnRyeShmaWxlLCBkYXRlU3RyLCB0YXJnZXQpO1xyXG4gICAgICAgICAgaXRlbUVsLnRvZ2dsZUNsYXNzKFwiaXMtY2hlY2tlZFwiLCB0YXJnZXQpO1xyXG4gICAgICAgICAgaWYgKHRhcmdldCkgdGhpcy5zaG93WHBQb3B1cChpdGVtRWwpO1xyXG4gICAgICAgICAgdGhpcy5lbWl0Um91dGluZUNoYW5nZSh7XHJcbiAgICAgICAgICAgIGRhdGVTdHIsXHJcbiAgICAgICAgICAgIHBhdGg6IGZpbGUucGF0aCxcclxuICAgICAgICAgICAgc3VidGFzazogbnVsbCxcclxuICAgICAgICAgICAgY2hlY2tlZDogdGFyZ2V0LFxyXG4gICAgICAgICAgICBwYXJlbnRDaGVja2VkOiB0YXJnZXQsXHJcbiAgICAgICAgICAgIHN1YnRhc2tzOiBbXSxcclxuICAgICAgICAgICAgb3JpZ2luSWQ6IHN5bmM/LmlkID8/IFwiXCIsXHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmVycm9yKFwiRm9sZGVyIFJvdXRpbmVzOiBmYWlsZWQgdG8gdXBkYXRlIGZyb250bWF0dGVyXCIsIGUpO1xyXG4gICAgICAgICAgbmV3IE5vdGljZShgRm9sZGVyIFJvdXRpbmVzOiBmYWlsZWQgdG8gdXBkYXRlICR7ZmlsZS5iYXNlbmFtZX1gKTtcclxuICAgICAgICAgIGNoZWNrYm94LmNoZWNrZWQgPSAhdGFyZ2V0O1xyXG4gICAgICAgIH0gZmluYWxseSB7XHJcbiAgICAgICAgICBjaGVja2JveC5kaXNhYmxlZCA9IGZhbHNlO1xyXG4gICAgICAgICAgdGhpcy51cGRhdGVBbmNlc3RvclByb2dyZXNzKGl0ZW1FbCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9KTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGNoZWNrYm94LmNsYXNzTGlzdC5hZGQoXCJmb2xkZXItcm91dGluZXMtcGFyZW50LWNoZWNrYm94XCIpO1xyXG5cclxuICAgIGNvbnN0IHN1YkNvbnRhaW5lciA9IGNvbnRhaW5lci5jcmVhdGVEaXYoeyBjbHM6IFwiZm9sZGVyLXJvdXRpbmVzLXN1YnRhc2tzXCIgfSk7XHJcbiAgICBjb25zdCBzdWJFbHM6IHsgbmFtZTogc3RyaW5nOyBlbDogSFRNTEVsZW1lbnQ7IGNoZWNrYm94OiBIVE1MSW5wdXRFbGVtZW50IH1bXSA9IFtdO1xyXG5cclxuICAgIGNvbnN0IHJlZnJlc2hQYXJlbnQgPSAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGFsbENoZWNrZWQgPSBzdWJFbHMuZXZlcnkoKHMpID0+IHMuY2hlY2tib3guY2hlY2tlZCk7XHJcbiAgICAgIGNoZWNrYm94LmNoZWNrZWQgPSBhbGxDaGVja2VkO1xyXG4gICAgICBpdGVtRWwudG9nZ2xlQ2xhc3MoXCJpcy1jaGVja2VkXCIsIGFsbENoZWNrZWQpO1xyXG4gICAgfTtcclxuXHJcbiAgICBjb25zdCBzZXRBbGxEaXNhYmxlZCA9IChkaXNhYmxlZDogYm9vbGVhbikgPT4ge1xyXG4gICAgICBjaGVja2JveC5kaXNhYmxlZCA9IGRpc2FibGVkO1xyXG4gICAgICBmb3IgKGNvbnN0IHMgb2Ygc3ViRWxzKSBzLmNoZWNrYm94LmRpc2FibGVkID0gZGlzYWJsZWQ7XHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IHJlc29sdmVkID0gYXdhaXQgdGhpcy5yZWNvbmNpbGVTdWJ0YXNrRW50cmllcyhmaWxlLCBzdWJ0YXNrcyk7XHJcblxyXG4gICAgc3VidGFza3MuZm9yRWFjaCgobmFtZSwgc3ViSW5kZXgpID0+IHtcclxuICAgICAgY29uc3Qgc3ViSXRlbSA9IHN1YkNvbnRhaW5lci5jcmVhdGVEaXYoeyBjbHM6IFwiZm9sZGVyLXJvdXRpbmVzLXN1YnRhc2tcIiB9KTtcclxuICAgICAgc3ViSXRlbS50YWJJbmRleCA9IDA7XHJcbiAgICAgIHRoaXMud2lyZVNlbGVjdGlvbihzdWJJdGVtKTtcclxuICAgICAgaWYgKHN1YkluZGV4ID09PSBzdWJ0YXNrcy5sZW5ndGggLSAxKSBzdWJJdGVtLmFkZENsYXNzKFwiaXMtbGFzdFwiKTtcclxuICAgICAgY29uc3Qgc3ViTGFiZWwgPSBzdWJJdGVtLmNyZWF0ZUVsKFwibGFiZWxcIiwgeyBjbHM6IFwiZm9sZGVyLXJvdXRpbmVzLWxhYmVsXCIgfSk7XHJcbiAgICAgIHN1YkxhYmVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZm9sZGVyLXJvdXRpbmVzLXRyZWVcIiwgdGV4dDogXCJcIiB9KTtcclxuICAgICAgY29uc3Qgc3ViQ2hlY2tib3ggPSBzdWJMYWJlbC5jcmVhdGVFbChcImlucHV0XCIsIHtcclxuICAgICAgICB0eXBlOiBcImNoZWNrYm94XCIsXHJcbiAgICAgIH0pIGFzIEhUTUxJbnB1dEVsZW1lbnQ7XHJcbiAgICAgIHN1YkNoZWNrYm94LmNsYXNzTGlzdC5hZGQoXCJmb2xkZXItcm91dGluZXMtY2hlY2tib3hcIiwgXCJmb2xkZXItcm91dGluZXMtcHJvZ3Jlc3MtY2hlY2tib3hcIik7XHJcbiAgICAgIHN1YkNoZWNrYm94LmNoZWNrZWQgPSAocmVzb2x2ZWRbbmFtZV0gPz8gW10pLmluY2x1ZGVzKGRhdGVTdHIpO1xyXG4gICAgICBzdWJMYWJlbC5jcmVhdGVTcGFuKHsgdGV4dDogbmFtZSwgY2xzOiBcImZvbGRlci1yb3V0aW5lcy10ZXh0XCIgfSk7XHJcbiAgICAgIHN1Ykl0ZW0udG9nZ2xlQ2xhc3MoXCJpcy1jaGVja2VkXCIsIHN1YkNoZWNrYm94LmNoZWNrZWQpO1xyXG4gICAgICBzdWJFbHMucHVzaCh7IG5hbWUsIGVsOiBzdWJJdGVtLCBjaGVja2JveDogc3ViQ2hlY2tib3ggfSk7XHJcblxyXG4gICAgICBzeW5jPy5zZXR0ZXJzLnNldChtYWtlUmVmKGZpbGUucGF0aCwgbmFtZSksIChjaGVja2VkKSA9PiB7XHJcbiAgICAgICAgaWYgKHN1YkNoZWNrYm94LmNoZWNrZWQgPT09IGNoZWNrZWQpIHJldHVybjtcclxuICAgICAgICBzdWJDaGVja2JveC5jaGVja2VkID0gY2hlY2tlZDtcclxuICAgICAgICBzdWJJdGVtLnRvZ2dsZUNsYXNzKFwiaXMtY2hlY2tlZFwiLCBjaGVja2VkKTtcclxuICAgICAgICByZWZyZXNoUGFyZW50KCk7XHJcbiAgICAgICAgdGhpcy51cGRhdGVBbmNlc3RvclByb2dyZXNzKHN1Ykl0ZW0pO1xyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIHN1YkNoZWNrYm94LmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IHRhcmdldCA9IHN1YkNoZWNrYm94LmNoZWNrZWQ7XHJcbiAgICAgICAgc2V0QWxsRGlzYWJsZWQodHJ1ZSk7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgIGNvbnN0IHBhcmVudENoZWNrZWQgPSBhd2FpdCB0aGlzLnNldFN1YnRhc2tFbnRyeShcclxuICAgICAgICAgICAgZmlsZSxcclxuICAgICAgICAgICAgbmFtZSxcclxuICAgICAgICAgICAgZGF0ZVN0cixcclxuICAgICAgICAgICAgdGFyZ2V0LFxyXG4gICAgICAgICAgICBzdWJ0YXNrc1xyXG4gICAgICAgICAgKTtcclxuICAgICAgICAgIHN1Ykl0ZW0udG9nZ2xlQ2xhc3MoXCJpcy1jaGVja2VkXCIsIHRhcmdldCk7XHJcbiAgICAgICAgICBpZiAodGFyZ2V0KSB0aGlzLnNob3dYcFBvcHVwKHN1Ykl0ZW0pO1xyXG4gICAgICAgICAgcmVmcmVzaFBhcmVudCgpO1xyXG4gICAgICAgICAgdGhpcy5lbWl0Um91dGluZUNoYW5nZSh7XHJcbiAgICAgICAgICAgIGRhdGVTdHIsXHJcbiAgICAgICAgICAgIHBhdGg6IGZpbGUucGF0aCxcclxuICAgICAgICAgICAgc3VidGFzazogbmFtZSxcclxuICAgICAgICAgICAgY2hlY2tlZDogdGFyZ2V0LFxyXG4gICAgICAgICAgICBwYXJlbnRDaGVja2VkLFxyXG4gICAgICAgICAgICBzdWJ0YXNrcyxcclxuICAgICAgICAgICAgb3JpZ2luSWQ6IHN5bmM/LmlkID8/IFwiXCIsXHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmVycm9yKFwiRm9sZGVyIFJvdXRpbmVzOiBmYWlsZWQgdG8gdXBkYXRlIGZyb250bWF0dGVyXCIsIGUpO1xyXG4gICAgICAgICAgbmV3IE5vdGljZShgRm9sZGVyIFJvdXRpbmVzOiBmYWlsZWQgdG8gdXBkYXRlICR7ZmlsZS5iYXNlbmFtZX1gKTtcclxuICAgICAgICAgIHN1YkNoZWNrYm94LmNoZWNrZWQgPSAhdGFyZ2V0O1xyXG4gICAgICAgIH0gZmluYWxseSB7XHJcbiAgICAgICAgICBzZXRBbGxEaXNhYmxlZChmYWxzZSk7XHJcbiAgICAgICAgICB0aGlzLnVwZGF0ZUFuY2VzdG9yUHJvZ3Jlc3Moc3ViSXRlbSk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG5cclxuICAgIHJlZnJlc2hQYXJlbnQoKTtcclxuXHJcbiAgICBzeW5jPy5zZXR0ZXJzLnNldChmaWxlLnBhdGgsIChjaGVja2VkKSA9PiB7XHJcbiAgICAgIGNoZWNrYm94LmNoZWNrZWQgPSBjaGVja2VkO1xyXG4gICAgICBpdGVtRWwudG9nZ2xlQ2xhc3MoXCJpcy1jaGVja2VkXCIsIGNoZWNrZWQpO1xyXG4gICAgICBmb3IgKGNvbnN0IHMgb2Ygc3ViRWxzKSB7XHJcbiAgICAgICAgcy5jaGVja2JveC5jaGVja2VkID0gY2hlY2tlZDtcclxuICAgICAgICBzLmVsLnRvZ2dsZUNsYXNzKFwiaXMtY2hlY2tlZFwiLCBjaGVja2VkKTtcclxuICAgICAgfVxyXG4gICAgICB0aGlzLnVwZGF0ZUFuY2VzdG9yUHJvZ3Jlc3MoaXRlbUVsKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGNoZWNrYm94LmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCB0YXJnZXQgPSBjaGVja2JveC5jaGVja2VkO1xyXG4gICAgICBzZXRBbGxEaXNhYmxlZCh0cnVlKTtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBhd2FpdCB0aGlzLnNldFBhcmVudFRvZ2dsZUFsbChmaWxlLCBkYXRlU3RyLCB0YXJnZXQsIHN1YnRhc2tzKTtcclxuICAgICAgICBpdGVtRWwudG9nZ2xlQ2xhc3MoXCJpcy1jaGVja2VkXCIsIHRhcmdldCk7XHJcbiAgICAgICAgZm9yIChjb25zdCBzIG9mIHN1YkVscykge1xyXG4gICAgICAgICAgcy5jaGVja2JveC5jaGVja2VkID0gdGFyZ2V0O1xyXG4gICAgICAgICAgcy5lbC50b2dnbGVDbGFzcyhcImlzLWNoZWNrZWRcIiwgdGFyZ2V0KTtcclxuICAgICAgICB9XHJcbiAgICAgICAgdGhpcy5lbWl0Um91dGluZUNoYW5nZSh7XHJcbiAgICAgICAgICBkYXRlU3RyLFxyXG4gICAgICAgICAgcGF0aDogZmlsZS5wYXRoLFxyXG4gICAgICAgICAgc3VidGFzazogbnVsbCxcclxuICAgICAgICAgIGNoZWNrZWQ6IHRhcmdldCxcclxuICAgICAgICAgIHBhcmVudENoZWNrZWQ6IHRhcmdldCxcclxuICAgICAgICAgIHN1YnRhc2tzLFxyXG4gICAgICAgICAgb3JpZ2luSWQ6IHN5bmM/LmlkID8/IFwiXCIsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKFwiRm9sZGVyIFJvdXRpbmVzOiBmYWlsZWQgdG8gdXBkYXRlIGZyb250bWF0dGVyXCIsIGUpO1xyXG4gICAgICAgIG5ldyBOb3RpY2UoYEZvbGRlciBSb3V0aW5lczogZmFpbGVkIHRvIHVwZGF0ZSAke2ZpbGUuYmFzZW5hbWV9YCk7XHJcbiAgICAgICAgY2hlY2tib3guY2hlY2tlZCA9ICF0YXJnZXQ7XHJcbiAgICAgIH0gZmluYWxseSB7XHJcbiAgICAgICAgc2V0QWxsRGlzYWJsZWQoZmFsc2UpO1xyXG4gICAgICAgIHRoaXMudXBkYXRlQW5jZXN0b3JQcm9ncmVzcyhpdGVtRWwpO1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIC8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4gICAgIFBpeGVsIGNhbGVuZGFyIChgYGBwaXhlbC1jYWxlbmRhcmBgYClcclxuICAgICA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi9cclxuXHJcbiAgcHJpdmF0ZSBsb2FkUGxhbihmaWxlOiBURmlsZSk6IFBsYW5NYXAge1xyXG4gICAgY29uc3QgZm0gPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShmaWxlKT8uZnJvbnRtYXR0ZXI7XHJcbiAgICBjb25zdCByYXcgPSBmbT8uW3RoaXMuc2V0dGluZ3MucGl4ZWxDYWxlbmRhclByb3BlcnR5XTtcclxuICAgIGNvbnN0IG91dDogUGxhbk1hcCA9IHt9O1xyXG4gICAgaWYgKHJhdyAmJiB0eXBlb2YgcmF3ID09PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KHJhdykpIHtcclxuICAgICAgZm9yIChjb25zdCBbaywgdl0gb2YgT2JqZWN0LmVudHJpZXMocmF3IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KSkge1xyXG4gICAgICAgIG91dFtrXSA9IHRoaXMubm9ybWFsaXplRW50cmllcyh2KTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIG91dDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgc2F2ZVBsYW5TdGF0ZShcclxuICAgIGZpbGU6IFRGaWxlLFxyXG4gICAgcGxhbjogUGxhbk1hcCxcclxuICAgIHRhc2tzOiBDdXN0b21UYXNrTWFwLFxyXG4gICAgc3BhbnM6IFRpbWVTcGFuTWFwXHJcbiAgKSB7XHJcbiAgICBjb25zdCBwbGFuUHJvcCA9IHRoaXMuc2V0dGluZ3MucGl4ZWxDYWxlbmRhclByb3BlcnR5O1xyXG4gICAgY29uc3QgdGFza1Byb3AgPSB0aGlzLnNldHRpbmdzLnBpeGVsQ2FsZW5kYXJUYXNrc1Byb3BlcnR5O1xyXG4gICAgY29uc3QgdGltZVByb3AgPSB0aGlzLnNldHRpbmdzLnBpeGVsQ2FsZW5kYXJUaW1lc1Byb3BlcnR5O1xyXG4gICAgY29uc3Qgc2NoZWR1bGVkID0gbmV3IFNldDxzdHJpbmc+KCk7XHJcbiAgICBhd2FpdCB0aGlzLmFwcC5maWxlTWFuYWdlci5wcm9jZXNzRnJvbnRNYXR0ZXIoZmlsZSwgKGZtKSA9PiB7XHJcbiAgICAgIGNvbnN0IGNsZWFuUGxhbjogUGxhbk1hcCA9IHt9O1xyXG4gICAgICBmb3IgKGNvbnN0IFtrLCB2XSBvZiBPYmplY3QuZW50cmllcyhwbGFuKSkge1xyXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KHYpICYmIHYubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgY2xlYW5QbGFuW2tdID0gWy4uLnZdO1xyXG4gICAgICAgICAgZm9yIChjb25zdCByZWYgb2Ygdikgc2NoZWR1bGVkLmFkZChyZWYpO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgICBpZiAoT2JqZWN0LmtleXMoY2xlYW5QbGFuKS5sZW5ndGggPT09IDApIHtcclxuICAgICAgICBkZWxldGUgZm1bcGxhblByb3BdO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGZtW3BsYW5Qcm9wXSA9IGNsZWFuUGxhbjtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3QgY2xlYW5UYXNrczogQ3VzdG9tVGFza01hcCA9IHt9O1xyXG4gICAgICBmb3IgKGNvbnN0IFtpZCwgdGFza10gb2YgT2JqZWN0LmVudHJpZXModGFza3MpKSB7XHJcbiAgICAgICAgaWYgKHRhc2sgJiYgdGFzay50aXRsZS50cmltKCkubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgY2xlYW5UYXNrc1tpZF0gPSB7IHRpdGxlOiB0YXNrLnRpdGxlLCBkb25lOiB0YXNrLmRvbmUgPT09IHRydWUgfTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgICAgaWYgKE9iamVjdC5rZXlzKGNsZWFuVGFza3MpLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgIGRlbGV0ZSBmbVt0YXNrUHJvcF07XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgZm1bdGFza1Byb3BdID0gY2xlYW5UYXNrcztcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gT25seSBwZXJzaXN0IHNwYW5zIHRoYXQgZGlmZmVyIGZyb20gdGhlIGRlZmF1bHQgc2luZ2xlIHNsb3QuXHJcbiAgICAgIGNvbnN0IGNsZWFuU3BhbnM6IFJlY29yZDxzdHJpbmcsIHsgc3RhcnQ6IHN0cmluZzsgZW5kOiBzdHJpbmcgfT4gPSB7fTtcclxuICAgICAgZm9yIChjb25zdCBbcmVmLCBzcGFuXSBvZiBPYmplY3QuZW50cmllcyhzcGFucykpIHtcclxuICAgICAgICBpZiAoIXNjaGVkdWxlZC5oYXMocmVmKSB8fCAhc3BhbikgY29udGludWU7XHJcbiAgICAgICAgY29uc3QgaXNEZWZhdWx0ID1cclxuICAgICAgICAgIHNwYW4uc3RhcnQgJSBTTE9UX01JTlVURVMgPT09IDAgJiZcclxuICAgICAgICAgIHNwYW4uZW5kIC0gc3Bhbi5zdGFydCA9PT0gU0xPVF9NSU5VVEVTO1xyXG4gICAgICAgIGlmIChpc0RlZmF1bHQpIGNvbnRpbnVlO1xyXG4gICAgICAgIGNsZWFuU3BhbnNbcmVmXSA9IHsgc3RhcnQ6IGZvcm1hdEhNKHNwYW4uc3RhcnQpLCBlbmQ6IGZvcm1hdEhNKHNwYW4uZW5kKSB9O1xyXG4gICAgICB9XHJcbiAgICAgIGlmIChPYmplY3Qua2V5cyhjbGVhblNwYW5zKS5sZW5ndGggPT09IDApIHtcclxuICAgICAgICBkZWxldGUgZm1bdGltZVByb3BdO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGZtW3RpbWVQcm9wXSA9IGNsZWFuU3BhbnM7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBsb2FkVGltZVNwYW5zKGZpbGU6IFRGaWxlKTogVGltZVNwYW5NYXAge1xyXG4gICAgY29uc3QgZm0gPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShmaWxlKT8uZnJvbnRtYXR0ZXI7XHJcbiAgICBjb25zdCByYXcgPSBmbT8uW3RoaXMuc2V0dGluZ3MucGl4ZWxDYWxlbmRhclRpbWVzUHJvcGVydHldO1xyXG4gICAgY29uc3Qgb3V0OiBUaW1lU3Bhbk1hcCA9IHt9O1xyXG4gICAgaWYgKCFyYXcgfHwgdHlwZW9mIHJhdyAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHJhdykpIHJldHVybiBvdXQ7XHJcbiAgICBmb3IgKGNvbnN0IFtyZWYsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhyYXcgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pKSB7XHJcbiAgICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSBjb250aW51ZTtcclxuICAgICAgY29uc3Qgb2JqID0gdmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XHJcbiAgICAgIGNvbnN0IHN0YXJ0ID0gcGFyc2VITShvYmouc3RhcnQpO1xyXG4gICAgICBjb25zdCBlbmQgPSBwYXJzZUhNKG9iai5lbmQpO1xyXG4gICAgICBpZiAoc3RhcnQgPT0gbnVsbCB8fCBlbmQgPT0gbnVsbCkgY29udGludWU7XHJcbiAgICAgIG91dFtyZWZdID0geyBzdGFydCwgZW5kOiBNYXRoLm1heChlbmQsIHN0YXJ0ICsgTUlOX0RVUkFUSU9OKSB9O1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIG91dDtcclxuICB9XHJcblxyXG4gIC8qIE9uZS1vZmYgdGFza3MgZm9yIGEgc2luZ2xlIGRheSwgc3RvcmVkIGFsb25nc2lkZSB0aGUgcGxhbiBvbiB0aGUgZGFpbHlcclxuICAgICBub3RlIHNvIHRoZXkgbmV2ZXIgdG91Y2ggdGhlIHJvdXRpbmUgZm9sZGVyLiAqL1xyXG4gIHByaXZhdGUgbG9hZEN1c3RvbVRhc2tzKGZpbGU6IFRGaWxlKTogQ3VzdG9tVGFza01hcCB7XHJcbiAgICBjb25zdCBmbSA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpPy5mcm9udG1hdHRlcjtcclxuICAgIGNvbnN0IHJhdyA9IGZtPy5bdGhpcy5zZXR0aW5ncy5waXhlbENhbGVuZGFyVGFza3NQcm9wZXJ0eV07XHJcbiAgICBjb25zdCBvdXQ6IEN1c3RvbVRhc2tNYXAgPSB7fTtcclxuICAgIGlmICghcmF3IHx8IHR5cGVvZiByYXcgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShyYXcpKSByZXR1cm4gb3V0O1xyXG4gICAgZm9yIChjb25zdCBbaWQsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhyYXcgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pKSB7XHJcbiAgICAgIGlmICh0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIpIHtcclxuICAgICAgICBpZiAodmFsdWUudHJpbSgpKSBvdXRbaWRdID0geyB0aXRsZTogdmFsdWUsIGRvbmU6IGZhbHNlIH07XHJcbiAgICAgIH0gZWxzZSBpZiAodmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KHZhbHVlKSkge1xyXG4gICAgICAgIGNvbnN0IG9iaiA9IHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xyXG4gICAgICAgIGNvbnN0IHRpdGxlID0gb2JqLnRpdGxlID09IG51bGwgPyBcIlwiIDogU3RyaW5nKG9iai50aXRsZSk7XHJcbiAgICAgICAgaWYgKHRpdGxlLnRyaW0oKSkgb3V0W2lkXSA9IHsgdGl0bGUsIGRvbmU6IG9iai5kb25lID09PSB0cnVlIH07XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIHJldHVybiBvdXQ7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGNvbGxlY3RIYWJpdEZpbGVzKGZvbGRlcjogVEZvbGRlciwgb3V0OiBURmlsZVtdKSB7XHJcbiAgICBjb25zdCBjaGlsZHJlbiA9IFsuLi5mb2xkZXIuY2hpbGRyZW5dLnNvcnQoKGEsIGIpID0+XHJcbiAgICAgIGEubmFtZS5sb2NhbGVDb21wYXJlKGIubmFtZSlcclxuICAgICk7XHJcbiAgICBmb3IgKGNvbnN0IGMgb2YgY2hpbGRyZW4pIHtcclxuICAgICAgaWYgKGMgaW5zdGFuY2VvZiBURmlsZSAmJiBjLmV4dGVuc2lvbiA9PT0gXCJtZFwiKSBvdXQucHVzaChjKTtcclxuICAgICAgZWxzZSBpZiAoYyBpbnN0YW5jZW9mIFRGb2xkZXIpIHRoaXMuY29sbGVjdEhhYml0RmlsZXMoYywgb3V0KTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgcmVuZGVyUGl4ZWxDYWxlbmRhcihcclxuICAgIGVsOiBIVE1MRWxlbWVudCxcclxuICAgIGN0eDogTWFya2Rvd25Qb3N0UHJvY2Vzc29yQ29udGV4dFxyXG4gICkge1xyXG4gICAgZWwuZW1wdHkoKTtcclxuXHJcbiAgICBjb25zdCByb290ID0gdGhpcy5yb3V0aW5lc1Jvb3QoKTtcclxuICAgIGlmICghcm9vdCkge1xyXG4gICAgICBlbC5jcmVhdGVEaXYoe1xyXG4gICAgICAgIGNsczogXCJmb2xkZXItcm91dGluZXMtZXJyb3JcIixcclxuICAgICAgICB0ZXh0OiBgRm9sZGVyIFJvdXRpbmVzOiBmb2xkZXIgXCIke3RoaXMuc2V0dGluZ3Mucm91dGluZXNGb2xkZXJ9XCIgbm90IGZvdW5kLiBTZXQgaXQgaW4gcGx1Z2luIHNldHRpbmdzLmAsXHJcbiAgICAgIH0pO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgZGF0ZSA9IHRoaXMuZ2V0Tm90ZURhdGUoY3R4LnNvdXJjZVBhdGgpO1xyXG4gICAgaWYgKCFkYXRlKSB7XHJcbiAgICAgIGVsLmNyZWF0ZURpdih7XHJcbiAgICAgICAgY2xzOiBcImZvbGRlci1yb3V0aW5lcy1lcnJvclwiLFxyXG4gICAgICAgIHRleHQ6IFwiRm9sZGVyIFJvdXRpbmVzOiBjb3VsZCBub3QgcGFyc2UgYSBkYXRlIGZyb20gdGhpcyBub3RlJ3MgZmlsZW5hbWUgKGV4cGVjdGVkIGEgZGFpbHkgbm90ZSkuXCIsXHJcbiAgICAgIH0pO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3Qgbm90ZUZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoY3R4LnNvdXJjZVBhdGgpO1xyXG4gICAgaWYgKCEobm90ZUZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHtcclxuICAgICAgZWwuY3JlYXRlRGl2KHtcclxuICAgICAgICBjbHM6IFwiZm9sZGVyLXJvdXRpbmVzLWVycm9yXCIsXHJcbiAgICAgICAgdGV4dDogXCJGb2xkZXIgUm91dGluZXM6IGNvdWxkIG5vdCByZXNvbHZlIHRoaXMgbm90ZSB0byBzYXZlIHRoZSBwbGFuLlwiLFxyXG4gICAgICB9KTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGRhdGVTdHIgPSBkYXRlLmZvcm1hdCh0aGlzLnNldHRpbmdzLnN0b3JlRGF0ZUZvcm1hdCB8fCBcIllZWVktTU0tRERcIik7XHJcbiAgICBjb25zdCBwbGFuID0gdGhpcy5sb2FkUGxhbihub3RlRmlsZSk7XHJcbiAgICBjb25zdCBjdXN0b21UYXNrcyA9IHRoaXMubG9hZEN1c3RvbVRhc2tzKG5vdGVGaWxlKTtcclxuICAgIGNvbnN0IHNwYW5zID0gdGhpcy5sb2FkVGltZVNwYW5zKG5vdGVGaWxlKTtcclxuICAgIGNvbnN0IGJsb2NrSWQgPSB0aGlzLm5leHRCbG9ja0lkKCk7XHJcblxyXG4gICAgY29uc3QgaGFiaXRGaWxlczogVEZpbGVbXSA9IFtdO1xyXG4gICAgdGhpcy5jb2xsZWN0SGFiaXRGaWxlcyhyb290LCBoYWJpdEZpbGVzKTtcclxuXHJcbiAgICAvLyBBc3NpZ24gZWFjaCBoYWJpdCB0aGUgc2FtZSBzZWN0aW9uIGNvbG9yIHRoZSBjaGVja2xpc3QgdXNlcyBzbyB0aGVcclxuICAgIC8vIGNhbGVuZGFyIGNoaXBzIG1hdGNoLiBTdWJmb2xkZXJzIGFyZSBjb2xvcmVkIGJ5IHNpYmxpbmcgcG9zaXRpb25cclxuICAgIC8vIChyZXN0YXJ0aW5nIHVuZGVyIGVhY2ggcGFyZW50KTsgYSBoYWJpdCBpbmhlcml0cyBpdHMgZGVlcGVzdCBmb2xkZXIncyBjb2xvci5cclxuICAgIGNvbnN0IGNvbG9yQnlQYXRoID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcj4oKTtcclxuICAgIGNvbnN0IGFzc2lnbkNvbG9ycyA9IChmb2xkZXI6IFRGb2xkZXIsIGluaGVyaXRlZDogbnVtYmVyKSA9PiB7XHJcbiAgICAgIGNvbnN0IGtpZHMgPSBbLi4uZm9sZGVyLmNoaWxkcmVuXS5zb3J0KChhLCBiKSA9PlxyXG4gICAgICAgIGEubmFtZS5sb2NhbGVDb21wYXJlKGIubmFtZSlcclxuICAgICAgKTtcclxuICAgICAgY29uc3QgZmlsZXMgPSBraWRzLmZpbHRlcihcclxuICAgICAgICAoYyk6IGMgaXMgVEZpbGUgPT4gYyBpbnN0YW5jZW9mIFRGaWxlICYmIGMuZXh0ZW5zaW9uID09PSBcIm1kXCJcclxuICAgICAgKTtcclxuICAgICAgY29uc3Qgc3VicyA9IGtpZHMuZmlsdGVyKChjKTogYyBpcyBURm9sZGVyID0+IGMgaW5zdGFuY2VvZiBURm9sZGVyKTtcclxuICAgICAgZm9yIChjb25zdCBmIG9mIGZpbGVzKSBpZiAoaW5oZXJpdGVkID4gMCkgY29sb3JCeVBhdGguc2V0KGYucGF0aCwgaW5oZXJpdGVkKTtcclxuICAgICAgc3Vicy5mb3JFYWNoKChzdWIsIGkpID0+XHJcbiAgICAgICAgYXNzaWduQ29sb3JzKHN1YiwgKGkgJSBGb2xkZXJSb3V0aW5lc1BsdWdpbi5TRUNUSU9OX0NPTE9SUykgKyAxKVxyXG4gICAgICApO1xyXG4gICAgfTtcclxuICAgIGFzc2lnbkNvbG9ycyhyb290LCAwKTtcclxuICAgIGNvbnN0IGFwcGx5Q29sb3IgPSAoZWxtOiBIVE1MRWxlbWVudCwgcGF0aDogc3RyaW5nKSA9PiB7XHJcbiAgICAgIC8vIEZhbGwgYmFjayB0byB0aGUgY2hlY2tsaXN0J3MgZGVmYXVsdCBzZWN0aW9uIGNvbG9yIGZvciByb290LWxldmVsXHJcbiAgICAgIC8vIGhhYml0cyBzbyBhIGNoaXAgaXMgbmV2ZXIgbGVmdCBvbiB0aGUgcmVzZXJ2ZWQgc2VsZWN0aW9uIGFjY2VudC5cclxuICAgICAgY29uc3QgYyA9IGNvbG9yQnlQYXRoLmdldChwYXRoKSA/PyAxO1xyXG4gICAgICBlbG0uYWRkQ2xhc3MoYGZvbGRlci1yb3V0aW5lcy1jb2xvci0ke2N9YCk7XHJcbiAgICB9O1xyXG5cclxuICAgIC8vIEJ1aWxkIGNvbXBsZXRpb24gc3RhdGUgZm9yIHRoaXMgZGF0ZSwgcmVjb25jaWxpbmcgc3VidGFza3MgdXAgZnJvbnQuXHJcbiAgICBjb25zdCBkb25lID0gbmV3IFNldDxzdHJpbmc+KCk7XHJcbiAgICBjb25zdCBzdWJ0YXNrc0J5UGF0aCA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmdbXT4oKTtcclxuICAgIGZvciAoY29uc3QgZiBvZiBoYWJpdEZpbGVzKSB7XHJcbiAgICAgIGNvbnN0IHN1YnMgPSB0aGlzLmdldFN1YnRhc2tzKGYpO1xyXG4gICAgICBzdWJ0YXNrc0J5UGF0aC5zZXQoZi5wYXRoLCBzdWJzKTtcclxuICAgICAgaWYgKHN1YnMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIGNvbnN0IHJlc29sdmVkID0gYXdhaXQgdGhpcy5yZWNvbmNpbGVTdWJ0YXNrRW50cmllcyhmLCBzdWJzKTtcclxuICAgICAgICBsZXQgYWxsRG9uZSA9IHRydWU7XHJcbiAgICAgICAgZm9yIChjb25zdCBzIG9mIHN1YnMpIHtcclxuICAgICAgICAgIGlmICgocmVzb2x2ZWRbc10gPz8gW10pLmluY2x1ZGVzKGRhdGVTdHIpKSBkb25lLmFkZChtYWtlUmVmKGYucGF0aCwgcykpO1xyXG4gICAgICAgICAgZWxzZSBhbGxEb25lID0gZmFsc2U7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChhbGxEb25lKSBkb25lLmFkZChmLnBhdGgpO1xyXG4gICAgICB9IGVsc2UgaWYgKHRoaXMuaXNDaGVja2VkKGYsIGRhdGVTdHIpKSB7XHJcbiAgICAgICAgZG9uZS5hZGQoZi5wYXRoKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qIFRoZSBncmlkIHN0YXJ0cyBhdCB0aGUgY29uZmlndXJlZCB0aW1lOyBlYXJsaWVyIHNsb3RzIGFyZSBsZWZ0IG91dFxyXG4gICAgICAgZW50aXJlbHksIGFuZCBldmVudHMgYmVmb3JlIGl0IGFyZSBjbGlwcGVkIHRvIHRoZSB0b3AgKG9yIGRyb3BwZWQgd2hlblxyXG4gICAgICAgdGhleSBmaW5pc2ggYmVmb3JlIHRoZSBkYXkgZXZlbiBiZWdpbnMpLiAqL1xyXG4gICAgY29uc3QgZGF5U3RhcnQgPSB0aGlzLmNhbGVuZGFyU3RhcnRNaW51dGVzKCk7XHJcbiAgICBjb25zdCBzdGFydFJvdyA9IGRheVN0YXJ0IC8gU0xPVF9NSU5VVEVTO1xyXG4gICAgY29uc3QgdmlzaWJsZVN0YXJ0ID0gKG1pbjogbnVtYmVyKSA9PiBNYXRoLm1heChtaW4sIGRheVN0YXJ0KTtcclxuICAgIGNvbnN0IHNsb3RLZXlzID0gYnVpbGRTbG90S2V5cyhkYXlTdGFydCk7XHJcbiAgICBjb25zdCBub3cgPSBtb21lbnQoKTtcclxuICAgIGNvbnN0IGlzVG9kYXkgPSBkYXRlLmlzU2FtZShub3csIFwiZGF5XCIpO1xyXG4gICAgY29uc3QgcGFkID0gKG46IG51bWJlcikgPT4gU3RyaW5nKG4pLnBhZFN0YXJ0KDIsIFwiMFwiKTtcclxuICAgIGNvbnN0IGN1cnJlbnRTbG90S2V5ID0gKG06IFJldHVyblR5cGU8dHlwZW9mIG1vbWVudD4pOiBzdHJpbmcgPT4ge1xyXG4gICAgICBjb25zdCB0b3RhbCA9XHJcbiAgICAgICAgbS5ob3VycygpICogNjAgKyBNYXRoLmZsb29yKG0ubWludXRlcygpIC8gU0xPVF9NSU5VVEVTKSAqIFNMT1RfTUlOVVRFUztcclxuICAgICAgcmV0dXJuIHBhZChNYXRoLmZsb29yKHRvdGFsIC8gNjApKSArIFwiOlwiICsgcGFkKHRvdGFsICUgNjApO1xyXG4gICAgfTtcclxuXHJcbiAgICBjb25zdCBmaWxlRm9yUGF0aCA9IChwOiBzdHJpbmcpOiBURmlsZSB8IG51bGwgPT4ge1xyXG4gICAgICBjb25zdCBmID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKHApO1xyXG4gICAgICByZXR1cm4gZiBpbnN0YW5jZW9mIFRGaWxlID8gZiA6IG51bGw7XHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IHNsb3RPZlJlZiA9IChyZWY6IHN0cmluZyk6IHN0cmluZyB8IG51bGwgPT4ge1xyXG4gICAgICBmb3IgKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMocGxhbikpIHtcclxuICAgICAgICBpZiAocGxhbltrXS5pbmNsdWRlcyhyZWYpKSByZXR1cm4gaztcclxuICAgICAgfVxyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH07XHJcblxyXG4gICAgY29uc3QgcmVtb3ZlUmVmRXZlcnl3aGVyZSA9IChyZWY6IHN0cmluZykgPT4ge1xyXG4gICAgICBmb3IgKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMocGxhbikpIHtcclxuICAgICAgICBwbGFuW2tdID0gcGxhbltrXS5maWx0ZXIoKHIpID0+IHIgIT09IHJlZik7XHJcbiAgICAgICAgaWYgKHBsYW5ba10ubGVuZ3RoID09PSAwKSBkZWxldGUgcGxhbltrXTtcclxuICAgICAgfVxyXG4gICAgfTtcclxuXHJcbiAgICAvKiBVbnNjaGVkdWxpbmcgYSBvbmUtb2ZmIHRhc2sgZGVsZXRlcyBpdDogaXQgZXhpc3RzIG9ubHkgb24gdGhlIGNhbGVuZGFyLiAqL1xyXG4gICAgY29uc3QgZGlzY2FyZFJlZiA9IChyZWY6IHN0cmluZykgPT4ge1xyXG4gICAgICByZW1vdmVSZWZFdmVyeXdoZXJlKHJlZik7XHJcbiAgICAgIGRlbGV0ZSBzcGFuc1tyZWZdO1xyXG4gICAgICBpZiAoaXNDdXN0b21SZWYocmVmKSkgZGVsZXRlIGN1c3RvbVRhc2tzW2N1c3RvbVJlZklkKHJlZildO1xyXG4gICAgfTtcclxuXHJcbiAgICBjb25zdCBwbGFjZVJlZiA9IChyZWY6IHN0cmluZywgc2xvdEtleTogc3RyaW5nKSA9PiB7XHJcbiAgICAgIHJlbW92ZVJlZkV2ZXJ5d2hlcmUocmVmKTtcclxuICAgICAgaWYgKCFwbGFuW3Nsb3RLZXldKSBwbGFuW3Nsb3RLZXldID0gW107XHJcbiAgICAgIGlmICghcGxhbltzbG90S2V5XS5pbmNsdWRlcyhyZWYpKSBwbGFuW3Nsb3RLZXldLnB1c2gocmVmKTtcclxuICAgIH07XHJcblxyXG4gICAgLyogRWZmZWN0aXZlIHN0YXJ0L2ZpbmlzaCBvZiBhIHNjaGVkdWxlZCByZWY6IGFuIGV4cGxpY2l0IHNwYW4gd2hlbiB0aGVcclxuICAgICAgIHVzZXIgc2V0IG9uZSwgb3RoZXJ3aXNlIHRoZSAzMC1taW51dGUgc2xvdCBpdCB3YXMgZHJvcHBlZCBpbi4gKi9cclxuICAgIGNvbnN0IHNwYW5PZiA9IChyZWY6IHN0cmluZywgc2xvdEtleTogc3RyaW5nKTogVGltZVNwYW4gPT4ge1xyXG4gICAgICBjb25zdCBleHBsaWNpdCA9IHNwYW5zW3JlZl07XHJcbiAgICAgIGlmIChleHBsaWNpdCkgcmV0dXJuIGV4cGxpY2l0O1xyXG4gICAgICBjb25zdCBzdGFydCA9IHBhcnNlSE0oc2xvdEtleSkgPz8gMDtcclxuICAgICAgcmV0dXJuIHsgc3RhcnQsIGVuZDogc3RhcnQgKyBTTE9UX01JTlVURVMgfTtcclxuICAgIH07XHJcblxyXG4gICAgY29uc3QgZHVyYXRpb25PZiA9IChyZWY6IHN0cmluZyk6IG51bWJlciA9PiB7XHJcbiAgICAgIGNvbnN0IHNsb3RLZXkgPSBzbG90T2ZSZWYocmVmKTtcclxuICAgICAgaWYgKCFzbG90S2V5KSByZXR1cm4gU0xPVF9NSU5VVEVTO1xyXG4gICAgICBjb25zdCBzID0gc3Bhbk9mKHJlZiwgc2xvdEtleSk7XHJcbiAgICAgIHJldHVybiBzLmVuZCAtIHMuc3RhcnQ7XHJcbiAgICB9O1xyXG5cclxuICAgIC8qIE1vdmUvcmVzaXplOiBrZWVwcyB0aGUgcGxhbiBzbG90IGluIHN5bmMgd2l0aCB0aGUgcHJlY2lzZSBzdGFydCB0aW1lLiAqL1xyXG4gICAgY29uc3Qgc2V0U3BhbiA9IChyZWY6IHN0cmluZywgc3RhcnRNaW46IG51bWJlciwgZW5kTWluOiBudW1iZXIpID0+IHtcclxuICAgICAgY29uc3Qgc3RhcnQgPSBjbGFtcE1pbnV0ZShNYXRoLm1pbihzdGFydE1pbiwgREFZX01JTlVURVMgLSBNSU5fRFVSQVRJT04pKTtcclxuICAgICAgY29uc3QgZW5kID0gY2xhbXBNaW51dGUoTWF0aC5tYXgoZW5kTWluLCBzdGFydCArIE1JTl9EVVJBVElPTikpO1xyXG4gICAgICBzcGFuc1tyZWZdID0geyBzdGFydCwgZW5kIH07XHJcbiAgICAgIHBsYWNlUmVmKHJlZiwgc2xvdEtleUZvck1pbnV0ZXMoc3RhcnQpKTtcclxuICAgIH07XHJcblxyXG4gICAgbGV0IHNhdmVDaGFpbjogUHJvbWlzZTx2b2lkPiA9IFByb21pc2UucmVzb2x2ZSgpO1xyXG4gICAgY29uc3QgcGVyc2lzdCA9ICgpID0+IHtcclxuICAgICAgc2F2ZUNoYWluID0gc2F2ZUNoYWluXHJcbiAgICAgICAgLnRoZW4oKCkgPT4gdGhpcy5zYXZlUGxhblN0YXRlKG5vdGVGaWxlLCBwbGFuLCBjdXN0b21UYXNrcywgc3BhbnMpKVxyXG4gICAgICAgIC5jYXRjaCgoZSkgPT4ge1xyXG4gICAgICAgICAgY29uc29sZS5lcnJvcihcIkZvbGRlciBSb3V0aW5lczogZmFpbGVkIHRvIHNhdmUgcGl4ZWwgY2FsZW5kYXIgcGxhblwiLCBlKTtcclxuICAgICAgICAgIG5ldyBOb3RpY2UoXCJGb2xkZXIgUm91dGluZXM6IGZhaWxlZCB0byBzYXZlIGNhbGVuZGFyIHBsYW5cIik7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IGFwcGx5RG9uZSA9IChcclxuICAgICAgcGF0aDogc3RyaW5nLFxyXG4gICAgICBzdWJ0YXNrOiBzdHJpbmcgfCBudWxsLFxyXG4gICAgICB0YXJnZXQ6IGJvb2xlYW4sXHJcbiAgICAgIHN1YnM6IHN0cmluZ1tdXHJcbiAgICApID0+IHtcclxuICAgICAgaWYgKHN1YnRhc2sgIT0gbnVsbCkge1xyXG4gICAgICAgIGNvbnN0IHJlZiA9IG1ha2VSZWYocGF0aCwgc3VidGFzayk7XHJcbiAgICAgICAgaWYgKHRhcmdldCkgZG9uZS5hZGQocmVmKTtcclxuICAgICAgICBlbHNlIGRvbmUuZGVsZXRlKHJlZik7XHJcbiAgICAgICAgY29uc3QgYWxsRG9uZSA9XHJcbiAgICAgICAgICBzdWJzLmxlbmd0aCA+IDAgJiYgc3Vicy5ldmVyeSgocykgPT4gZG9uZS5oYXMobWFrZVJlZihwYXRoLCBzKSkpO1xyXG4gICAgICAgIGlmIChhbGxEb25lKSBkb25lLmFkZChwYXRoKTtcclxuICAgICAgICBlbHNlIGRvbmUuZGVsZXRlKHBhdGgpO1xyXG4gICAgICB9IGVsc2UgaWYgKHN1YnMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIGlmICh0YXJnZXQpIHtcclxuICAgICAgICAgIGRvbmUuYWRkKHBhdGgpO1xyXG4gICAgICAgICAgZm9yIChjb25zdCBzIG9mIHN1YnMpIGRvbmUuYWRkKG1ha2VSZWYocGF0aCwgcykpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICBkb25lLmRlbGV0ZShwYXRoKTtcclxuICAgICAgICAgIGZvciAoY29uc3QgcyBvZiBzdWJzKSBkb25lLmRlbGV0ZShtYWtlUmVmKHBhdGgsIHMpKTtcclxuICAgICAgICB9XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgaWYgKHRhcmdldCkgZG9uZS5hZGQocGF0aCk7XHJcbiAgICAgICAgZWxzZSBkb25lLmRlbGV0ZShwYXRoKTtcclxuICAgICAgfVxyXG4gICAgfTtcclxuXHJcbiAgICBjb25zdCBzZXRSZWZEb25lID0gYXN5bmMgKHJlZjogc3RyaW5nLCB0YXJnZXQ6IGJvb2xlYW4pID0+IHtcclxuICAgICAgaWYgKGlzQ3VzdG9tUmVmKHJlZikpIHtcclxuICAgICAgICBjb25zdCB0YXNrID0gY3VzdG9tVGFza3NbY3VzdG9tUmVmSWQocmVmKV07XHJcbiAgICAgICAgaWYgKCF0YXNrKSByZXR1cm47XHJcbiAgICAgICAgdGFzay5kb25lID0gdGFyZ2V0O1xyXG4gICAgICAgIHBlcnNpc3QoKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuICAgICAgY29uc3QgeyBwYXRoLCBzdWJ0YXNrIH0gPSBwYXJzZVJlZihyZWYpO1xyXG4gICAgICBjb25zdCBmaWxlID0gZmlsZUZvclBhdGgocGF0aCk7XHJcbiAgICAgIGlmICghZmlsZSkgcmV0dXJuO1xyXG4gICAgICBjb25zdCBzdWJzID0gc3VidGFza3NCeVBhdGguZ2V0KHBhdGgpID8/IFtdO1xyXG4gICAgICBsZXQgcGFyZW50Q2hlY2tlZCA9IHRhcmdldDtcclxuICAgICAgaWYgKHN1YnRhc2sgIT0gbnVsbCkge1xyXG4gICAgICAgIHBhcmVudENoZWNrZWQgPSBhd2FpdCB0aGlzLnNldFN1YnRhc2tFbnRyeShcclxuICAgICAgICAgIGZpbGUsXHJcbiAgICAgICAgICBzdWJ0YXNrLFxyXG4gICAgICAgICAgZGF0ZVN0cixcclxuICAgICAgICAgIHRhcmdldCxcclxuICAgICAgICAgIHN1YnNcclxuICAgICAgICApO1xyXG4gICAgICB9IGVsc2UgaWYgKHN1YnMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIGF3YWl0IHRoaXMuc2V0UGFyZW50VG9nZ2xlQWxsKGZpbGUsIGRhdGVTdHIsIHRhcmdldCwgc3Vicyk7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgYXdhaXQgdGhpcy5zZXRFbnRyeShmaWxlLCBkYXRlU3RyLCB0YXJnZXQpO1xyXG4gICAgICB9XHJcbiAgICAgIGFwcGx5RG9uZShwYXRoLCBzdWJ0YXNrLCB0YXJnZXQsIHN1YnMpO1xyXG4gICAgICB0aGlzLmVtaXRSb3V0aW5lQ2hhbmdlKHtcclxuICAgICAgICBkYXRlU3RyLFxyXG4gICAgICAgIHBhdGgsXHJcbiAgICAgICAgc3VidGFzayxcclxuICAgICAgICBjaGVja2VkOiB0YXJnZXQsXHJcbiAgICAgICAgcGFyZW50Q2hlY2tlZCxcclxuICAgICAgICBzdWJ0YXNrczogc3VicyxcclxuICAgICAgICBvcmlnaW5JZDogYmxvY2tJZCxcclxuICAgICAgfSk7XHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IHJlZkxhYmVsID0gKHJlZjogc3RyaW5nKTogeyB0ZXh0OiBzdHJpbmc7IHBhcmVudDogc3RyaW5nIHwgbnVsbCB9ID0+IHtcclxuICAgICAgaWYgKGlzQ3VzdG9tUmVmKHJlZikpIHtcclxuICAgICAgICBjb25zdCB0YXNrID0gY3VzdG9tVGFza3NbY3VzdG9tUmVmSWQocmVmKV07XHJcbiAgICAgICAgcmV0dXJuIHsgdGV4dDogdGFzayA/IHRhc2sudGl0bGUgOiBcIk1pc3NpbmcgdGFza1wiLCBwYXJlbnQ6IFwiVEFTS1wiIH07XHJcbiAgICAgIH1cclxuICAgICAgY29uc3QgeyBwYXRoLCBzdWJ0YXNrIH0gPSBwYXJzZVJlZihyZWYpO1xyXG4gICAgICBjb25zdCBmaWxlID0gZmlsZUZvclBhdGgocGF0aCk7XHJcbiAgICAgIGNvbnN0IHJhd0Jhc2UgPSBmaWxlXHJcbiAgICAgICAgPyBmaWxlLmJhc2VuYW1lXHJcbiAgICAgICAgOiAocGF0aC5zcGxpdChcIi9cIikucG9wKCkgPz8gcGF0aCkucmVwbGFjZSgvXFwubWQkLywgXCJcIik7XHJcbiAgICAgIGNvbnN0IGJhc2UgPSB0aGlzLmRpc3BsYXlOYW1lKHJhd0Jhc2UpO1xyXG4gICAgICBpZiAoc3VidGFzayAhPSBudWxsKSByZXR1cm4geyB0ZXh0OiBzdWJ0YXNrLCBwYXJlbnQ6IGJhc2UgfTtcclxuICAgICAgcmV0dXJuIHsgdGV4dDogYmFzZSwgcGFyZW50OiBudWxsIH07XHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IG1ha2VEcmFnZ2FibGUgPSAoZWxtOiBIVE1MRWxlbWVudCwgcmVmOiBzdHJpbmcpID0+IHtcclxuICAgICAgZWxtLnNldEF0dHIoXCJkcmFnZ2FibGVcIiwgXCJ0cnVlXCIpO1xyXG4gICAgICBlbG0uYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdzdGFydFwiLCAoZTogRHJhZ0V2ZW50KSA9PiB7XHJcbiAgICAgICAgaWYgKGUuZGF0YVRyYW5zZmVyKSB7XHJcbiAgICAgICAgICBlLmRhdGFUcmFuc2Zlci5zZXREYXRhKFwidGV4dC9wbGFpblwiLCByZWYpO1xyXG4gICAgICAgICAgZS5kYXRhVHJhbnNmZXIuZWZmZWN0QWxsb3dlZCA9IFwibW92ZVwiO1xyXG4gICAgICAgIH1cclxuICAgICAgICBlbG0uYWRkQ2xhc3MoXCJpcy1kcmFnZ2luZ1wiKTtcclxuICAgICAgfSk7XHJcbiAgICAgIGVsbS5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ2VuZFwiLCAoKSA9PiBlbG0ucmVtb3ZlQ2xhc3MoXCJpcy1kcmFnZ2luZ1wiKSk7XHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IHdpcmVEcm9wWm9uZSA9ICh6b25lOiBIVE1MRWxlbWVudCwgb25Ecm9wOiAocmVmOiBzdHJpbmcpID0+IHZvaWQpID0+IHtcclxuICAgICAgY29uc3Qgb3ZlciA9IChlOiBEcmFnRXZlbnQpID0+IHtcclxuICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgaWYgKGUuZGF0YVRyYW5zZmVyKSBlLmRhdGFUcmFuc2Zlci5kcm9wRWZmZWN0ID0gXCJtb3ZlXCI7XHJcbiAgICAgICAgem9uZS5hZGRDbGFzcyhcImlzLWRyb3AtdGFyZ2V0XCIpO1xyXG4gICAgICB9O1xyXG4gICAgICB6b25lLmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnb3ZlclwiLCBvdmVyKTtcclxuICAgICAgem9uZS5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ2VudGVyXCIsIG92ZXIpO1xyXG4gICAgICB6b25lLmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnbGVhdmVcIiwgKCkgPT4gem9uZS5yZW1vdmVDbGFzcyhcImlzLWRyb3AtdGFyZ2V0XCIpKTtcclxuICAgICAgem9uZS5hZGRFdmVudExpc3RlbmVyKFwiZHJvcFwiLCAoZTogRHJhZ0V2ZW50KSA9PiB7XHJcbiAgICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICAgIHpvbmUucmVtb3ZlQ2xhc3MoXCJpcy1kcm9wLXRhcmdldFwiKTtcclxuICAgICAgICBjb25zdCByZWYgPSBlLmRhdGFUcmFuc2Zlcj8uZ2V0RGF0YShcInRleHQvcGxhaW5cIik7XHJcbiAgICAgICAgaWYgKHJlZikgb25Ecm9wKHJlZik7XHJcbiAgICAgIH0pO1xyXG4gICAgfTtcclxuXHJcbiAgICBjb25zdCBjb250YWluZXIgPSBlbC5jcmVhdGVEaXYoeyBjbHM6IFwiZm9sZGVyLXJvdXRpbmVzIHBpeGVsLWNhbGVuZGFyXCIgfSk7XHJcbiAgICBjb25zdCBoZWFkZXIgPSBjb250YWluZXIuY3JlYXRlRGl2KHsgY2xzOiBcInBpeGVsLWNhbGVuZGFyLWhlYWRlclwiIH0pO1xyXG4gICAgaGVhZGVyLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZm9sZGVyLXJvdXRpbmVzLWNvbGxhcHNlLWljb25cIiwgdGV4dDogXCJcdTI1QkNcIiB9KTtcclxuICAgIGhlYWRlci5jcmVhdGVTcGFuKHsgY2xzOiBcInBpeGVsLWNhbGVuZGFyLXRpdGxlXCIsIHRleHQ6IFwiRGF5IFBsYW5cIiB9KTtcclxuICAgIGhlYWRlci5jcmVhdGVTcGFuKHtcclxuICAgICAgY2xzOiBcInBpeGVsLWNhbGVuZGFyLWRhdGVcIixcclxuICAgICAgdGV4dDogZGF0ZS5mb3JtYXQoXCJkZGRkLCBNTU1NIEQsIFlZWVlcIiksXHJcbiAgICB9KTtcclxuICAgIGhlYWRlci5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICBjb250YWluZXIudG9nZ2xlQ2xhc3MoXHJcbiAgICAgICAgXCJpcy1jb2xsYXBzZWRcIixcclxuICAgICAgICAhY29udGFpbmVyLmhhc0NsYXNzKFwiaXMtY29sbGFwc2VkXCIpXHJcbiAgICAgICk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBsYXlvdXQgPSBjb250YWluZXIuY3JlYXRlRGl2KHsgY2xzOiBcInBpeGVsLWNhbGVuZGFyLWxheW91dFwiIH0pO1xyXG4gICAgY29uc3Qgc2lkZUVsID0gbGF5b3V0LmNyZWF0ZURpdih7IGNsczogXCJwaXhlbC1jYWxlbmRhci1zaWRlXCIgfSk7XHJcbiAgICBjb25zdCBncmlkV3JhcCA9IGxheW91dC5jcmVhdGVEaXYoeyBjbHM6IFwicGl4ZWwtY2FsZW5kYXItZ3JpZC13cmFwXCIgfSk7XHJcbiAgICBjb25zdCBncmlkRWwgPSBncmlkV3JhcC5jcmVhdGVEaXYoeyBjbHM6IFwicGl4ZWwtY2FsZW5kYXItZ3JpZFwiIH0pO1xyXG5cclxuICAgIGxldCByZWZyZXNoOiAoKSA9PiB2b2lkID0gKCkgPT4ge307XHJcbiAgICBsZXQgb3BlblNpZGVTZWN0aW9uOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcclxuXHJcbiAgICBjb25zdCBpc1JlZkRvbmUgPSAocmVmOiBzdHJpbmcpOiBib29sZWFuID0+IHtcclxuICAgICAgaWYgKGlzQ3VzdG9tUmVmKHJlZikpIHJldHVybiBjdXN0b21UYXNrc1tjdXN0b21SZWZJZChyZWYpXT8uZG9uZSA9PT0gdHJ1ZTtcclxuICAgICAgcmV0dXJuIGRvbmUuaGFzKHJlZik7XHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IGFkZENoaXBDaGVja2JveCA9IChcclxuICAgICAgaG9zdDogSFRNTEVsZW1lbnQsXHJcbiAgICAgIHJlZjogc3RyaW5nLFxyXG4gICAgICBjaGlwOiBIVE1MRWxlbWVudCA9IGhvc3RcclxuICAgICk6IEhUTUxJbnB1dEVsZW1lbnQgPT4ge1xyXG4gICAgICBjb25zdCBjaGVja2JveCA9IGhvc3QuY3JlYXRlRWwoXCJpbnB1dFwiLCB7XHJcbiAgICAgICAgdHlwZTogXCJjaGVja2JveFwiLFxyXG4gICAgICB9KSBhcyBIVE1MSW5wdXRFbGVtZW50O1xyXG4gICAgICBjaGVja2JveC5jaGVja2VkID0gaXNSZWZEb25lKHJlZik7XHJcbiAgICAgIGlmIChjaGVja2JveC5jaGVja2VkKSBjaGlwLmFkZENsYXNzKFwiaXMtZG9uZVwiKTtcclxuICAgICAgY2hlY2tib3guYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIChlKSA9PiBlLnN0b3BQcm9wYWdhdGlvbigpKTtcclxuICAgICAgY2hlY2tib3guYWRkRXZlbnRMaXN0ZW5lcihcImRibGNsaWNrXCIsIChlKSA9PiBlLnN0b3BQcm9wYWdhdGlvbigpKTtcclxuICAgICAgY2hlY2tib3guYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgY29uc3QgdGFyZ2V0ID0gY2hlY2tib3guY2hlY2tlZDtcclxuICAgICAgICBjaGVja2JveC5kaXNhYmxlZCA9IHRydWU7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgIGF3YWl0IHNldFJlZkRvbmUocmVmLCB0YXJnZXQpO1xyXG4gICAgICAgICAgcmVmcmVzaCgpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICAgICAgY29uc29sZS5lcnJvcihcIkZvbGRlciBSb3V0aW5lczogZmFpbGVkIHRvIHVwZGF0ZSBmcm9udG1hdHRlclwiLCBlcnIpO1xyXG4gICAgICAgICAgbmV3IE5vdGljZShcIkZvbGRlciBSb3V0aW5lczogZmFpbGVkIHRvIHVwZGF0ZSBjb21wbGV0aW9uXCIpO1xyXG4gICAgICAgICAgY2hlY2tib3guY2hlY2tlZCA9ICF0YXJnZXQ7XHJcbiAgICAgICAgICBjaGVja2JveC5kaXNhYmxlZCA9IGZhbHNlO1xyXG4gICAgICAgIH1cclxuICAgICAgfSk7XHJcbiAgICAgIHJldHVybiBjaGVja2JveDtcclxuICAgIH07XHJcblxyXG4gICAgLyogSW5saW5lIHBpeGVsLXN0eWxlZCB0ZXh0IGZpZWxkIHVzZWQgdG8gY3JlYXRlIG9yIHJlbmFtZSBhIG9uZS1vZmYgdGFzay4gKi9cclxuICAgIGNvbnN0IG9wZW5UYXNrSW5wdXQgPSAoXHJcbiAgICAgIGhvc3Q6IEhUTUxFbGVtZW50LFxyXG4gICAgICBpbml0aWFsOiBzdHJpbmcsXHJcbiAgICAgIG9uQ29tbWl0OiAodGl0bGU6IHN0cmluZykgPT4gdm9pZFxyXG4gICAgKSA9PiB7XHJcbiAgICAgIGNvbnN0IHdyYXAgPSBob3N0LmNyZWF0ZURpdih7IGNsczogXCJwaXhlbC1jYWxlbmRhci10YXNrLWlucHV0XCIgfSk7XHJcbiAgICAgIGNvbnN0IGlucHV0ID0gd3JhcC5jcmVhdGVFbChcImlucHV0XCIsIHsgdHlwZTogXCJ0ZXh0XCIgfSkgYXMgSFRNTElucHV0RWxlbWVudDtcclxuICAgICAgaW5wdXQudmFsdWUgPSBpbml0aWFsO1xyXG4gICAgICBpbnB1dC5wbGFjZWhvbGRlciA9IFwiVGFzayBuYW1lXHUyMDI2XCI7XHJcbiAgICAgIGlucHV0LnNldEF0dHIoXCJhcmlhLWxhYmVsXCIsIFwiVGFzayBuYW1lXCIpO1xyXG4gICAgICBsZXQgY2xvc2VkID0gZmFsc2U7XHJcbiAgICAgIGNvbnN0IGZpbmlzaCA9IChjb21taXQ6IGJvb2xlYW4pID0+IHtcclxuICAgICAgICBpZiAoY2xvc2VkKSByZXR1cm47XHJcbiAgICAgICAgY2xvc2VkID0gdHJ1ZTtcclxuICAgICAgICBjb25zdCB2YWx1ZSA9IGlucHV0LnZhbHVlLnRyaW0oKTtcclxuICAgICAgICBpZiAoY29tbWl0ICYmIHZhbHVlKSBvbkNvbW1pdCh2YWx1ZSk7XHJcbiAgICAgICAgZWxzZSByZWZyZXNoKCk7XHJcbiAgICAgIH07XHJcbiAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIChlOiBLZXlib2FyZEV2ZW50KSA9PiB7XHJcbiAgICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgICBpZiAoZS5rZXkgPT09IFwiRW50ZXJcIikge1xyXG4gICAgICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICAgICAgZmluaXNoKHRydWUpO1xyXG4gICAgICAgIH0gZWxzZSBpZiAoZS5rZXkgPT09IFwiRXNjYXBlXCIpIHtcclxuICAgICAgICAgIGUucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgICAgIGZpbmlzaChmYWxzZSk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9KTtcclxuICAgICAgaW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImJsdXJcIiwgKCkgPT4gZmluaXNoKHRydWUpKTtcclxuICAgICAgaW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIChlKSA9PiBlLnN0b3BQcm9wYWdhdGlvbigpKTtcclxuICAgICAgaW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImRibGNsaWNrXCIsIChlKSA9PiBlLnN0b3BQcm9wYWdhdGlvbigpKTtcclxuICAgICAgaW5wdXQuZm9jdXMoKTtcclxuICAgICAgaW5wdXQuc2VsZWN0KCk7XHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IGFkZFRhc2tBdCA9ICh6b25lOiBIVE1MRWxlbWVudCwgc2xvdEtleTogc3RyaW5nKSA9PiB7XHJcbiAgICAgIG9wZW5UYXNrSW5wdXQoem9uZSwgXCJcIiwgKHRpdGxlKSA9PiB7XHJcbiAgICAgICAgY29uc3QgaWQgPSBuZXdDdXN0b21UYXNrSWQoKTtcclxuICAgICAgICBjdXN0b21UYXNrc1tpZF0gPSB7IHRpdGxlLCBkb25lOiBmYWxzZSB9O1xyXG4gICAgICAgIHBsYWNlUmVmKG1ha2VDdXN0b21SZWYoaWQpLCBzbG90S2V5KTtcclxuICAgICAgICByZWZyZXNoKCk7XHJcbiAgICAgICAgcGVyc2lzdCgpO1xyXG4gICAgICB9KTtcclxuICAgIH07XHJcblxyXG4gICAgLyogLS0tLSBzdHJldGNoaW5nICYgZXhhY3QgdGltZXMgLS0tLSAqL1xyXG5cclxuICAgIGNvbnN0IHJvd0hlaWdodFB4ID0gKCk6IG51bWJlciA9PiB7XHJcbiAgICAgIC8vIHJvd3Mgc3RyZXRjaCB0byBmaXQgc3RhY2tlZCBldmVudHMsIHNvIG1lYXN1cmUgdGhlIHVuc2NhbGVkIHJ1bGVyXHJcbiAgICAgIGNvbnN0IHVuaXQgPSBncmlkRWwucXVlcnlTZWxlY3RvcihcclxuICAgICAgICBcIi5waXhlbC1jYWxlbmRhci11bml0XCJcclxuICAgICAgKSBhcyBIVE1MRWxlbWVudCB8IG51bGw7XHJcbiAgICAgIGNvbnN0IGggPSB1bml0Py5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKS5oZWlnaHQgPz8gMDtcclxuICAgICAgcmV0dXJuIGggPiAwID8gaCA6IDA7XHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IHNuYXAgPSAobWluczogbnVtYmVyKSA9PlxyXG4gICAgICBNYXRoLnJvdW5kKG1pbnMgLyBSRVNJWkVfU1RFUCkgKiBSRVNJWkVfU1RFUDtcclxuXHJcbiAgICAvKiBCb3R0b20gZHJhZyBoYW5kbGU6IHN0cmV0Y2ggdGhlIGV2ZW50IG92ZXIgbW9yZSB0aW1lLiAqL1xyXG4gICAgY29uc3QgZGVjb3JhdGVFdmVudCA9IChcclxuICAgICAgY2hpcDogSFRNTEVsZW1lbnQsXHJcbiAgICAgIHJlZjogc3RyaW5nLFxyXG4gICAgICBzcGFuOiBUaW1lU3BhblxyXG4gICAgKSA9PiB7XHJcbiAgICAgIGNvbnN0IGhhbmRsZSA9IGNoaXAuY3JlYXRlRGl2KHsgY2xzOiBcInBpeGVsLWNhbGVuZGFyLWV2ZW50LWhhbmRsZVwiIH0pO1xyXG4gICAgICBoYW5kbGUuc2V0QXR0cihcImFyaWEtbGFiZWxcIiwgXCJEcmFnIHRvIGNoYW5nZSBkdXJhdGlvblwiKTtcclxuICAgICAgaGFuZGxlLnNldEF0dHIoXCJ0aXRsZVwiLCBcIkRyYWcgdG8gc3RyZXRjaFwiKTtcclxuICAgICAgaGFuZGxlLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZSkgPT4gZS5zdG9wUHJvcGFnYXRpb24oKSk7XHJcbiAgICAgIGhhbmRsZS5hZGRFdmVudExpc3RlbmVyKFwiZGJsY2xpY2tcIiwgKGUpID0+IGUuc3RvcFByb3BhZ2F0aW9uKCkpO1xyXG4gICAgICBoYW5kbGUuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJkb3duXCIsIChlOiBQb2ludGVyRXZlbnQpID0+IHtcclxuICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgICBjb25zdCByb3dIID0gcm93SGVpZ2h0UHgoKTtcclxuICAgICAgICBpZiAoIXJvd0gpIHJldHVybjtcclxuICAgICAgICBjb25zdCBzdGFydFkgPSBlLmNsaWVudFk7XHJcbiAgICAgICAgY29uc3Qgc3RhcnRFbmQgPSBzcGFuLmVuZDtcclxuICAgICAgICBsZXQgZW5kTWluID0gc3RhcnRFbmQ7XHJcbiAgICAgICAgY2hpcC5hZGRDbGFzcyhcImlzLXJlc2l6aW5nXCIpO1xyXG4gICAgICAgIGNoaXAuc2V0QXR0cihcImRyYWdnYWJsZVwiLCBcImZhbHNlXCIpO1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICBoYW5kbGUuc2V0UG9pbnRlckNhcHR1cmUoZS5wb2ludGVySWQpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICAgICAgLyogbm90IHN1cHBvcnRlZCAqL1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBvbk1vdmUgPSAoZXY6IFBvaW50ZXJFdmVudCkgPT4ge1xyXG4gICAgICAgICAgY29uc3QgZGVsdGFNaW4gPSAoKGV2LmNsaWVudFkgLSBzdGFydFkpIC8gcm93SCkgKiBTTE9UX01JTlVURVM7XHJcbiAgICAgICAgICBlbmRNaW4gPSBjbGFtcE1pbnV0ZShcclxuICAgICAgICAgICAgTWF0aC5tYXgoc3Bhbi5zdGFydCArIE1JTl9EVVJBVElPTiwgc25hcChzdGFydEVuZCArIGRlbHRhTWluKSlcclxuICAgICAgICAgICk7XHJcbiAgICAgICAgICBjaGlwLnN0eWxlLmhlaWdodCA9IGBjYWxjKHZhcigtLWZyLXNsb3QtaCkgKiAke1xyXG4gICAgICAgICAgICAoZW5kTWluIC0gdmlzaWJsZVN0YXJ0KHNwYW4uc3RhcnQpKSAvIFNMT1RfTUlOVVRFU1xyXG4gICAgICAgICAgfSAtIDNweClgO1xyXG4gICAgICAgIH07XHJcbiAgICAgICAgY29uc3Qgb25VcCA9ICgpID0+IHtcclxuICAgICAgICAgIGhhbmRsZS5yZW1vdmVFdmVudExpc3RlbmVyKFwicG9pbnRlcm1vdmVcIiwgb25Nb3ZlKTtcclxuICAgICAgICAgIGhhbmRsZS5yZW1vdmVFdmVudExpc3RlbmVyKFwicG9pbnRlcnVwXCIsIG9uVXApO1xyXG4gICAgICAgICAgaGFuZGxlLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJwb2ludGVyY2FuY2VsXCIsIG9uVXApO1xyXG4gICAgICAgICAgY2hpcC5yZW1vdmVDbGFzcyhcImlzLXJlc2l6aW5nXCIpO1xyXG4gICAgICAgICAgaWYgKGVuZE1pbiAhPT0gc3RhcnRFbmQpIHtcclxuICAgICAgICAgICAgc2V0U3BhbihyZWYsIHNwYW4uc3RhcnQsIGVuZE1pbik7XHJcbiAgICAgICAgICAgIHBlcnNpc3QoKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIHJlZnJlc2goKTtcclxuICAgICAgICB9O1xyXG4gICAgICAgIGhhbmRsZS5hZGRFdmVudExpc3RlbmVyKFwicG9pbnRlcm1vdmVcIiwgb25Nb3ZlKTtcclxuICAgICAgICBoYW5kbGUuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJ1cFwiLCBvblVwKTtcclxuICAgICAgICBoYW5kbGUuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJjYW5jZWxcIiwgb25VcCk7XHJcbiAgICAgIH0pO1xyXG4gICAgfTtcclxuXHJcbiAgICBjb25zdCByZW5kZXJDdXN0b21DaGlwID0gKFxyXG4gICAgICBob3N0OiBIVE1MRWxlbWVudCxcclxuICAgICAgcmVmOiBzdHJpbmcsXHJcbiAgICAgIHNwYW46IFRpbWVTcGFuXHJcbiAgICApOiBIVE1MRWxlbWVudCA9PiB7XHJcbiAgICAgIGNvbnN0IGlkID0gY3VzdG9tUmVmSWQocmVmKTtcclxuICAgICAgY29uc3QgdGFzayA9IGN1c3RvbVRhc2tzW2lkXTtcclxuICAgICAgY29uc3QgY2hpcCA9IGhvc3QuY3JlYXRlRGl2KHtcclxuICAgICAgICBjbHM6IFwicGl4ZWwtY2FsZW5kYXItY2hpcCBwaXhlbC1jYWxlbmRhci1zbG90LWNoaXAgcGl4ZWwtY2FsZW5kYXItZXZlbnQgaXMtY3VzdG9tXCIsXHJcbiAgICAgIH0pO1xyXG4gICAgICBtYWtlRHJhZ2dhYmxlKGNoaXAsIHJlZik7XHJcblxyXG4gICAgICBpZiAoIXRhc2spIHtcclxuICAgICAgICBjaGlwLmFkZENsYXNzKFwiaXMtbWlzc2luZ1wiKTtcclxuICAgICAgICBjaGlwLmNyZWF0ZVNwYW4oe1xyXG4gICAgICAgICAgY2xzOiBcInBpeGVsLWNhbGVuZGFyLWNoaXAtdGV4dFwiLFxyXG4gICAgICAgICAgdGV4dDogXCJNaXNzaW5nIHRhc2tcIixcclxuICAgICAgICB9KTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBjb25zdCBoZWFkID0gY2hpcC5jcmVhdGVEaXYoeyBjbHM6IFwicGl4ZWwtY2FsZW5kYXItZXZlbnQtaGVhZFwiIH0pO1xyXG4gICAgICAgIGFkZENoaXBDaGVja2JveChoZWFkLCByZWYsIGNoaXApO1xyXG4gICAgICAgIGNvbnN0IGluZm8gPSBoZWFkLmNyZWF0ZURpdih7IGNsczogXCJwaXhlbC1jYWxlbmRhci1jaGlwLWluZm9cIiB9KTtcclxuICAgICAgICBjb25zdCB0aXRsZSA9IGluZm8uY3JlYXRlU3Bhbih7XHJcbiAgICAgICAgICBjbHM6IFwicGl4ZWwtY2FsZW5kYXItY2hpcC10ZXh0XCIsXHJcbiAgICAgICAgICB0ZXh0OiB0YXNrLnRpdGxlLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGluZm8uY3JlYXRlU3Bhbih7IGNsczogXCJwaXhlbC1jYWxlbmRhci1jaGlwLXBhcmVudFwiLCB0ZXh0OiBcIlRBU0tcIiB9KTtcclxuICAgICAgICB0aXRsZS5zZXRBdHRyKFwidGl0bGVcIiwgXCJEb3VibGUtY2xpY2sgdG8gcmVuYW1lXCIpO1xyXG4gICAgICAgIGNvbnN0IHN0YXJ0UmVuYW1lID0gKGU6IE1vdXNlRXZlbnQpID0+IHtcclxuICAgICAgICAgIGNvbnN0IHRhcmdldCA9IGUudGFyZ2V0IGFzIEhUTUxFbGVtZW50IHwgbnVsbDtcclxuICAgICAgICAgIGlmIChcclxuICAgICAgICAgICAgdGFyZ2V0Py5jbG9zZXN0KFxyXG4gICAgICAgICAgICAgIFwiLnBpeGVsLWNhbGVuZGFyLWV2ZW50LWhhbmRsZSwgLnBpeGVsLWNhbGVuZGFyLWNoaXAtcmVtb3ZlXCJcclxuICAgICAgICAgICAgKVxyXG4gICAgICAgICAgKVxyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgICBlLnN0b3BQcm9wYWdhdGlvbigpO1xyXG4gICAgICAgICAgY2hpcC5lbXB0eSgpO1xyXG4gICAgICAgICAgY2hpcC5hZGRDbGFzcyhcImlzLWVkaXRpbmdcIik7XHJcbiAgICAgICAgICBjaGlwLnNldEF0dHIoXCJkcmFnZ2FibGVcIiwgXCJmYWxzZVwiKTtcclxuICAgICAgICAgIG9wZW5UYXNrSW5wdXQoY2hpcCwgdGFzay50aXRsZSwgKG5ld1RpdGxlKSA9PiB7XHJcbiAgICAgICAgICAgIHRhc2sudGl0bGUgPSBuZXdUaXRsZTtcclxuICAgICAgICAgICAgcmVmcmVzaCgpO1xyXG4gICAgICAgICAgICBwZXJzaXN0KCk7XHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICB9O1xyXG4gICAgICAgIGNoaXAuYWRkRXZlbnRMaXN0ZW5lcihcImRibGNsaWNrXCIsIHN0YXJ0UmVuYW1lKTtcclxuICAgICAgICBjb25zdCByZW1vdmUgPSBoZWFkLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHtcclxuICAgICAgICAgIGNsczogXCJwaXhlbC1jYWxlbmRhci1jaGlwLXJlbW92ZVwiLFxyXG4gICAgICAgICAgdGV4dDogXCJcdTAwRDdcIixcclxuICAgICAgICB9KTtcclxuICAgICAgICByZW1vdmUuc2V0QXR0cihcImFyaWEtbGFiZWxcIiwgXCJEZWxldGUgdGFza1wiKTtcclxuICAgICAgICByZW1vdmUuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIChlKSA9PiB7XHJcbiAgICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgICBlLnN0b3BQcm9wYWdhdGlvbigpO1xyXG4gICAgICAgICAgZGlzY2FyZFJlZihyZWYpO1xyXG4gICAgICAgICAgcmVmcmVzaCgpO1xyXG4gICAgICAgICAgcGVyc2lzdCgpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGRlY29yYXRlRXZlbnQoY2hpcCwgcmVmLCBzcGFuKTtcclxuICAgICAgfVxyXG4gICAgICByZXR1cm4gY2hpcDtcclxuICAgIH07XHJcblxyXG4gICAgY29uc3QgcmVuZGVyU2xvdENoaXAgPSAoXHJcbiAgICAgIGhvc3Q6IEhUTUxFbGVtZW50LFxyXG4gICAgICByZWY6IHN0cmluZyxcclxuICAgICAgc3BhbjogVGltZVNwYW5cclxuICAgICk6IEhUTUxFbGVtZW50ID0+IHtcclxuICAgICAgaWYgKGlzQ3VzdG9tUmVmKHJlZikpIHJldHVybiByZW5kZXJDdXN0b21DaGlwKGhvc3QsIHJlZiwgc3Bhbik7XHJcblxyXG4gICAgICBjb25zdCB7IHN1YnRhc2ssIHBhdGggfSA9IHBhcnNlUmVmKHJlZik7XHJcbiAgICAgIGNvbnN0IGZpbGUgPSBmaWxlRm9yUGF0aChwYXRoKTtcclxuICAgICAgY29uc3QgY2hpcCA9IGhvc3QuY3JlYXRlRGl2KHtcclxuICAgICAgICBjbHM6IFwicGl4ZWwtY2FsZW5kYXItY2hpcCBwaXhlbC1jYWxlbmRhci1zbG90LWNoaXAgcGl4ZWwtY2FsZW5kYXItZXZlbnRcIixcclxuICAgICAgfSk7XHJcbiAgICAgIG1ha2VEcmFnZ2FibGUoY2hpcCwgcmVmKTtcclxuICAgICAgYXBwbHlDb2xvcihjaGlwLCBwYXRoKTtcclxuICAgICAgaWYgKHN1YnRhc2sgIT0gbnVsbCkgY2hpcC5hZGRDbGFzcyhcImlzLXN1YnRhc2tcIik7XHJcblxyXG4gICAgICBpZiAoIWZpbGUpIHtcclxuICAgICAgICBjaGlwLmFkZENsYXNzKFwiaXMtbWlzc2luZ1wiKTtcclxuICAgICAgICBjaGlwLmNyZWF0ZVNwYW4oe1xyXG4gICAgICAgICAgY2xzOiBcInBpeGVsLWNhbGVuZGFyLWNoaXAtdGV4dFwiLFxyXG4gICAgICAgICAgdGV4dDogcmVmTGFiZWwocmVmKS50ZXh0LFxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIHJldHVybiBjaGlwO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zdCBoZWFkID0gY2hpcC5jcmVhdGVEaXYoeyBjbHM6IFwicGl4ZWwtY2FsZW5kYXItZXZlbnQtaGVhZFwiIH0pO1xyXG4gICAgICBhZGRDaGlwQ2hlY2tib3goaGVhZCwgcmVmLCBjaGlwKTtcclxuICAgICAgY29uc3QgaW5mbyA9IGhlYWQuY3JlYXRlRGl2KHsgY2xzOiBcInBpeGVsLWNhbGVuZGFyLWNoaXAtaW5mb1wiIH0pO1xyXG4gICAgICBjb25zdCBsYmwgPSByZWZMYWJlbChyZWYpO1xyXG4gICAgICBpbmZvLmNyZWF0ZVNwYW4oeyBjbHM6IFwicGl4ZWwtY2FsZW5kYXItY2hpcC10ZXh0XCIsIHRleHQ6IGxibC50ZXh0IH0pO1xyXG4gICAgICBpZiAobGJsLnBhcmVudClcclxuICAgICAgICBpbmZvLmNyZWF0ZVNwYW4oe1xyXG4gICAgICAgICAgY2xzOiBcInBpeGVsLWNhbGVuZGFyLWNoaXAtcGFyZW50XCIsXHJcbiAgICAgICAgICB0ZXh0OiBsYmwucGFyZW50LFxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgY29uc3QgcmVtb3ZlID0gaGVhZC5jcmVhdGVFbChcImJ1dHRvblwiLCB7XHJcbiAgICAgICAgY2xzOiBcInBpeGVsLWNhbGVuZGFyLWNoaXAtcmVtb3ZlXCIsXHJcbiAgICAgICAgdGV4dDogXCJcdTAwRDdcIixcclxuICAgICAgfSk7XHJcbiAgICAgIHJlbW92ZS5zZXRBdHRyKFwiYXJpYS1sYWJlbFwiLCBcIlJlbW92ZSBmcm9tIGNhbGVuZGFyXCIpO1xyXG4gICAgICByZW1vdmUuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIChlKSA9PiB7XHJcbiAgICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICAgIGUuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgICAgZGlzY2FyZFJlZihyZWYpO1xyXG4gICAgICAgIHJlZnJlc2goKTtcclxuICAgICAgICBwZXJzaXN0KCk7XHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgZGVjb3JhdGVFdmVudChjaGlwLCByZWYsIHNwYW4pO1xyXG4gICAgICByZXR1cm4gY2hpcDtcclxuICAgIH07XHJcblxyXG4gICAgY29uc3QgcmVuZGVyU2lkZUhhYml0ID0gKGZpbGU6IFRGaWxlLCBjb250YWluZXJFbDogSFRNTEVsZW1lbnQpID0+IHtcclxuICAgICAgY29uc3Qgc3VicyA9IHN1YnRhc2tzQnlQYXRoLmdldChmaWxlLnBhdGgpID8/IFtdO1xyXG4gICAgICBjb25zdCB3cmFwID0gY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBcInBpeGVsLWNhbGVuZGFyLXNpZGUtaGFiaXRcIiB9KTtcclxuXHJcbiAgICAgIGNvbnN0IGNoaXAgPSB3cmFwLmNyZWF0ZURpdih7XHJcbiAgICAgICAgY2xzOiBcInBpeGVsLWNhbGVuZGFyLWNoaXAgcGl4ZWwtY2FsZW5kYXItc2lkZS1jaGlwXCIsXHJcbiAgICAgIH0pO1xyXG4gICAgICBtYWtlRHJhZ2dhYmxlKGNoaXAsIGZpbGUucGF0aCk7XHJcbiAgICAgIGFwcGx5Q29sb3IoY2hpcCwgZmlsZS5wYXRoKTtcclxuICAgICAgYWRkQ2hpcENoZWNrYm94KGNoaXAsIGZpbGUucGF0aCk7XHJcbiAgICAgIGNvbnN0IGluZm8gPSBjaGlwLmNyZWF0ZURpdih7IGNsczogXCJwaXhlbC1jYWxlbmRhci1jaGlwLWluZm9cIiB9KTtcclxuICAgICAgaW5mby5jcmVhdGVTcGFuKHtcclxuICAgICAgICBjbHM6IFwicGl4ZWwtY2FsZW5kYXItY2hpcC10ZXh0XCIsXHJcbiAgICAgICAgdGV4dDogdGhpcy5kaXNwbGF5TmFtZShmaWxlLmJhc2VuYW1lKSxcclxuICAgICAgfSk7XHJcbiAgICAgIGNvbnN0IGF0ID0gc2xvdE9mUmVmKGZpbGUucGF0aCk7XHJcbiAgICAgIGlmIChhdCkge1xyXG4gICAgICAgIGNoaXAuYWRkQ2xhc3MoXCJpcy1zY2hlZHVsZWRcIik7XHJcbiAgICAgICAgY29uc3QgcyA9IHNwYW5PZihmaWxlLnBhdGgsIGF0KTtcclxuICAgICAgICBpbmZvLmNyZWF0ZVNwYW4oe1xyXG4gICAgICAgICAgY2xzOiBcInBpeGVsLWNhbGVuZGFyLWNoaXAtdGltZVwiLFxyXG4gICAgICAgICAgdGV4dDogYCR7Zm9ybWF0SE0ocy5zdGFydCl9XHUyMDEzJHtmb3JtYXRITShzLmVuZCl9YCxcclxuICAgICAgICB9KTtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKHN1YnMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIGNvbnN0IHN1YldyYXAgPSB3cmFwLmNyZWF0ZURpdih7IGNsczogXCJwaXhlbC1jYWxlbmRhci1zaWRlLXN1YnRhc2tzXCIgfSk7XHJcbiAgICAgICAgZm9yIChjb25zdCBuYW1lIG9mIHN1YnMpIHtcclxuICAgICAgICAgIGNvbnN0IHNyZWYgPSBtYWtlUmVmKGZpbGUucGF0aCwgbmFtZSk7XHJcbiAgICAgICAgICBjb25zdCBzQ2hpcCA9IHN1YldyYXAuY3JlYXRlRGl2KHtcclxuICAgICAgICAgICAgY2xzOiBcInBpeGVsLWNhbGVuZGFyLWNoaXAgcGl4ZWwtY2FsZW5kYXItc2lkZS1jaGlwIGlzLXN1YnRhc2tcIixcclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgbWFrZURyYWdnYWJsZShzQ2hpcCwgc3JlZik7XHJcbiAgICAgICAgICBhcHBseUNvbG9yKHNDaGlwLCBmaWxlLnBhdGgpO1xyXG4gICAgICAgICAgYWRkQ2hpcENoZWNrYm94KHNDaGlwLCBzcmVmKTtcclxuICAgICAgICAgIGNvbnN0IHNJbmZvID0gc0NoaXAuY3JlYXRlRGl2KHsgY2xzOiBcInBpeGVsLWNhbGVuZGFyLWNoaXAtaW5mb1wiIH0pO1xyXG4gICAgICAgICAgc0luZm8uY3JlYXRlU3Bhbih7IGNsczogXCJwaXhlbC1jYWxlbmRhci1jaGlwLXRleHRcIiwgdGV4dDogbmFtZSB9KTtcclxuICAgICAgICAgIGNvbnN0IHNBdCA9IHNsb3RPZlJlZihzcmVmKTtcclxuICAgICAgICAgIGlmIChzQXQpIHtcclxuICAgICAgICAgICAgc0NoaXAuYWRkQ2xhc3MoXCJpcy1zY2hlZHVsZWRcIik7XHJcbiAgICAgICAgICAgIGNvbnN0IHNzID0gc3Bhbk9mKHNyZWYsIHNBdCk7XHJcbiAgICAgICAgICAgIHNJbmZvLmNyZWF0ZVNwYW4oe1xyXG4gICAgICAgICAgICAgIGNsczogXCJwaXhlbC1jYWxlbmRhci1jaGlwLXRpbWVcIixcclxuICAgICAgICAgICAgICB0ZXh0OiBgJHtmb3JtYXRITShzcy5zdGFydCl9XHUyMDEzJHtmb3JtYXRITShzcy5lbmQpfWAsXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfTtcclxuXHJcbiAgICBjb25zdCByZW5kZXJTaWRlRm9sZGVyID0gKFxyXG4gICAgICBmb2xkZXI6IFRGb2xkZXIsXHJcbiAgICAgIGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCxcclxuICAgICAgZGVwdGg6IG51bWJlclxyXG4gICAgKSA9PiB7XHJcbiAgICAgIGNvbnN0IGNoaWxkcmVuID0gWy4uLmZvbGRlci5jaGlsZHJlbl0uc29ydCgoYSwgYikgPT5cclxuICAgICAgICBhLm5hbWUubG9jYWxlQ29tcGFyZShiLm5hbWUpXHJcbiAgICAgICk7XHJcbiAgICAgIGNvbnN0IGZpbGVzID0gY2hpbGRyZW4uZmlsdGVyKFxyXG4gICAgICAgIChjKTogYyBpcyBURmlsZSA9PiBjIGluc3RhbmNlb2YgVEZpbGUgJiYgYy5leHRlbnNpb24gPT09IFwibWRcIlxyXG4gICAgICApO1xyXG4gICAgICBjb25zdCBzdWJmb2xkZXJzID0gY2hpbGRyZW4uZmlsdGVyKFxyXG4gICAgICAgIChjKTogYyBpcyBURm9sZGVyID0+IGMgaW5zdGFuY2VvZiBURm9sZGVyXHJcbiAgICAgICk7XHJcblxyXG4gICAgICBmb3IgKGNvbnN0IGZpbGUgb2YgZmlsZXMpIHJlbmRlclNpZGVIYWJpdChmaWxlLCBjb250YWluZXJFbCk7XHJcblxyXG4gICAgICBjb25zdCBzZWN0aW9uczogSFRNTEVsZW1lbnRbXSA9IFtdO1xyXG4gICAgICBzdWJmb2xkZXJzLmZvckVhY2goKHN1YiwgaSkgPT4ge1xyXG4gICAgICAgIGNvbnN0IGNvbG9ySW5kZXggPSBpICUgRm9sZGVyUm91dGluZXNQbHVnaW4uU0VDVElPTl9DT0xPUlM7XHJcbiAgICAgICAgY29uc3Qgc2VjdGlvbiA9IGNvbnRhaW5lckVsLmNyZWF0ZURpdih7XHJcbiAgICAgICAgICBjbHM6IGBwaXhlbC1jYWxlbmRhci1zaWRlLXNlY3Rpb24gZm9sZGVyLXJvdXRpbmVzLWNvbG9yLSR7Y29sb3JJbmRleCArIDF9YCxcclxuICAgICAgICB9KTtcclxuICAgICAgICBzZWN0aW9ucy5wdXNoKHNlY3Rpb24pO1xyXG4gICAgICAgIGlmIChvcGVuU2lkZVNlY3Rpb24gIT09IHN1Yi5wYXRoKSBzZWN0aW9uLmFkZENsYXNzKFwiaXMtY29sbGFwc2VkXCIpO1xyXG4gICAgICAgIGNvbnN0IHNlY0hlYWRlciA9IHNlY3Rpb24uY3JlYXRlRGl2KHtcclxuICAgICAgICAgIGNsczogXCJwaXhlbC1jYWxlbmRhci1zaWRlLWhlYWRpbmdcIixcclxuICAgICAgICB9KTtcclxuICAgICAgICBzZWNIZWFkZXIuY3JlYXRlU3Bhbih7XHJcbiAgICAgICAgICBjbHM6IFwiZm9sZGVyLXJvdXRpbmVzLWNvbGxhcHNlLWljb25cIixcclxuICAgICAgICAgIHRleHQ6IFwiXHUyNUJFXCIsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgc2VjSGVhZGVyLmNyZWF0ZVNwYW4oeyB0ZXh0OiB0aGlzLmRpc3BsYXlOYW1lKHN1Yi5uYW1lKSB9KTtcclxuICAgICAgICBjb25zdCBib2R5ID0gc2VjdGlvbi5jcmVhdGVEaXYoeyBjbHM6IFwicGl4ZWwtY2FsZW5kYXItc2lkZS1ib2R5XCIgfSk7XHJcbiAgICAgICAgcmVuZGVyU2lkZUZvbGRlcihzdWIsIGJvZHksIGRlcHRoICsgMSk7XHJcbiAgICAgICAgc2VjSGVhZGVyLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XHJcbiAgICAgICAgICBjb25zdCB3aWxsT3BlbiA9IHNlY3Rpb24uaGFzQ2xhc3MoXCJpcy1jb2xsYXBzZWRcIik7XHJcbiAgICAgICAgICBmb3IgKGNvbnN0IHMgb2Ygc2VjdGlvbnMpIHMuYWRkQ2xhc3MoXCJpcy1jb2xsYXBzZWRcIik7XHJcbiAgICAgICAgICBpZiAod2lsbE9wZW4pIHtcclxuICAgICAgICAgICAgc2VjdGlvbi5yZW1vdmVDbGFzcyhcImlzLWNvbGxhcHNlZFwiKTtcclxuICAgICAgICAgICAgb3BlblNpZGVTZWN0aW9uID0gc3ViLnBhdGg7XHJcbiAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBvcGVuU2lkZVNlY3Rpb24gPSBudWxsO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9KTtcclxuICAgIH07XHJcblxyXG4gICAgLyogU2NoZWR1bGVkIGV2ZW50cyBmbG9hdCBhYm92ZSB0aGUgc2xvdCByb3dzIHNvIG9uZSBjYW4gc3BhbiBtYW55IHJvd3MuXHJcbiAgICAgICBBdCBtb3N0IHR3byBldmVudHMgc2l0IHNpZGUgYnkgc2lkZTsgYSB0aGlyZCB3cmFwcyBvbnRvIGEgbmV3IGJhbmRcclxuICAgICAgIGJlbG93IHRoZW0sIGFuZCB0aGUgcm93cyBpdCBjb3ZlcnMgZ3JvdyB0byBtYWtlIHJvb20uICovXHJcbiAgICBjb25zdCBsYXlvdXRFdmVudHMgPSAobGF5ZXI6IEhUTUxFbGVtZW50LCByb3dFbHM6IEhUTUxFbGVtZW50W10pID0+IHtcclxuICAgICAgY29uc3QgaXRlbXM6IHsgcmVmOiBzdHJpbmc7IHNwYW46IFRpbWVTcGFuIH1bXSA9IFtdO1xyXG4gICAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhwbGFuKSkge1xyXG4gICAgICAgIGZvciAoY29uc3QgcmVmIG9mIHBsYW5ba2V5XSkge1xyXG4gICAgICAgICAgY29uc3Qgc3BhbiA9IHNwYW5PZihyZWYsIGtleSk7XHJcbiAgICAgICAgICAvLyBmaW5pc2hlZCBiZWZvcmUgdGhlIHZpc2libGUgZGF5IHN0YXJ0czogbm90aGluZyB0byBkcmF3LCBidXQgdGhlXHJcbiAgICAgICAgICAvLyB0cmF5IHN0aWxsIGxpc3RzIGl0IHdpdGggaXRzIHRpbWUgc28gaXQgY2FuIGJlIGRyYWdnZWQgYmFja1xyXG4gICAgICAgICAgaWYgKHNwYW4uZW5kIDw9IGRheVN0YXJ0KSBjb250aW51ZTtcclxuICAgICAgICAgIGl0ZW1zLnB1c2goeyByZWYsIHNwYW4gfSk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIC8vIGxvbmdlciBldmVudHMgZmlyc3Qgc28gdGhleSBjbGFpbSBhIGNvbHVtbiBmb3IgdGhlaXIgd2hvbGUgcnVuXHJcbiAgICAgIGl0ZW1zLnNvcnQoXHJcbiAgICAgICAgKGEsIGIpID0+XHJcbiAgICAgICAgICBhLnNwYW4uc3RhcnQgLSBiLnNwYW4uc3RhcnQgfHxcclxuICAgICAgICAgIGIuc3Bhbi5lbmQgLSBiLnNwYW4uc3RhcnQgLSAoYS5zcGFuLmVuZCAtIGEuc3Bhbi5zdGFydClcclxuICAgICAgKTtcclxuXHJcbiAgICAgIC8qIFJvd3MgYXJlIG51bWJlcmVkIGZyb20gdGhlIGZpcnN0IHZpc2libGUgc2xvdCwgbm90IGZyb20gbWlkbmlnaHQuICovXHJcbiAgICAgIGNvbnN0IGZpcnN0Um93ID0gKG1pbjogbnVtYmVyKSA9PlxyXG4gICAgICAgIE1hdGguZmxvb3IodmlzaWJsZVN0YXJ0KG1pbikgLyBTTE9UX01JTlVURVMpIC0gc3RhcnRSb3c7XHJcbiAgICAgIGNvbnN0IGxhc3RSb3cgPSAobWluOiBudW1iZXIpID0+XHJcbiAgICAgICAgTWF0aC5tYXgoMCwgTWF0aC5mbG9vcigobWluIC0gMSkgLyBTTE9UX01JTlVURVMpIC0gc3RhcnRSb3cpO1xyXG4gICAgICBjb25zdCByb3dTdGFydE1pbiA9IChyb3c6IG51bWJlcikgPT4gKHJvdyArIHN0YXJ0Um93KSAqIFNMT1RfTUlOVVRFUztcclxuXHJcbiAgICAgIC8qIENlbGxzIGFuIGV2ZW50IGNvdmVycywgYXMgcm93Kk1BWF9CQU5EUytiYW5kIGtleXMuIEFuIGV2ZW50IHRoYXRcclxuICAgICAgICAgY29udGludWVzIHBhc3QgYSByb3cgZmlsbHMgdGhhdCByb3cgdG8gdGhlIGJvdHRvbSwgYW5kIGZpbGxzIHRoZVxyXG4gICAgICAgICBmaW5hbCByb3cgZnJvbSB0aGUgdG9wIGRvd24gdG8gaXRzIG93biBiYW5kLiAqL1xyXG4gICAgICBjb25zdCBjZWxsc09mID0gKHIxOiBudW1iZXIsIHIyOiBudW1iZXIsIGJhbmQ6IG51bWJlcik6IG51bWJlcltdID0+IHtcclxuICAgICAgICBjb25zdCBvdXQ6IG51bWJlcltdID0gW107XHJcbiAgICAgICAgaWYgKHIxID09PSByMikgcmV0dXJuIFtyMSAqIE1BWF9CQU5EUyArIGJhbmRdO1xyXG4gICAgICAgIGZvciAobGV0IGIgPSBiYW5kOyBiIDwgTUFYX0JBTkRTOyBiKyspIG91dC5wdXNoKHIxICogTUFYX0JBTkRTICsgYik7XHJcbiAgICAgICAgZm9yIChsZXQgciA9IHIxICsgMTsgciA8IHIyOyByKyspXHJcbiAgICAgICAgICBmb3IgKGxldCBiID0gMDsgYiA8IE1BWF9CQU5EUzsgYisrKSBvdXQucHVzaChyICogTUFYX0JBTkRTICsgYik7XHJcbiAgICAgICAgZm9yIChsZXQgYiA9IDA7IGIgPD0gYmFuZDsgYisrKSBvdXQucHVzaChyMiAqIE1BWF9CQU5EUyArIGIpO1xyXG4gICAgICAgIHJldHVybiBvdXQ7XHJcbiAgICAgIH07XHJcblxyXG4gICAgICBjb25zdCB0YWtlbjogU2V0PG51bWJlcj5bXSA9IFtdO1xyXG4gICAgICBmb3IgKGxldCBjID0gMDsgYyA8IE1BWF9DT0xVTU5TOyBjKyspIHRha2VuLnB1c2gobmV3IFNldDxudW1iZXI+KCkpO1xyXG4gICAgICBjb25zdCBwbGFjZWQ6IHtcclxuICAgICAgICByZWY6IHN0cmluZztcclxuICAgICAgICBzcGFuOiBUaW1lU3BhbjtcclxuICAgICAgICByMTogbnVtYmVyO1xyXG4gICAgICAgIHIyOiBudW1iZXI7XHJcbiAgICAgICAgYmFuZDogbnVtYmVyO1xyXG4gICAgICAgIGNvbDogbnVtYmVyO1xyXG4gICAgICAgIGNlbGxzOiBudW1iZXJbXTtcclxuICAgICAgfVtdID0gW107XHJcblxyXG4gICAgICBmb3IgKGNvbnN0IGl0IG9mIGl0ZW1zKSB7XHJcbiAgICAgICAgY29uc3QgcjEgPSBmaXJzdFJvdyhpdC5zcGFuLnN0YXJ0KTtcclxuICAgICAgICBjb25zdCByMiA9IE1hdGgubWF4KHIxLCBsYXN0Um93KGl0LnNwYW4uZW5kKSk7XHJcbiAgICAgICAgbGV0IGJhbmQgPSBNQVhfQkFORFMgLSAxO1xyXG4gICAgICAgIGxldCBjb2wgPSAwO1xyXG4gICAgICAgIGxldCBjZWxscyA9IGNlbGxzT2YocjEsIHIyLCBiYW5kKTtcclxuICAgICAgICBsZXQgZm91bmQgPSBmYWxzZTtcclxuICAgICAgICBmb3IgKGxldCBiID0gMDsgYiA8IE1BWF9CQU5EUyAmJiAhZm91bmQ7IGIrKykge1xyXG4gICAgICAgICAgY29uc3QgY2FuZGlkYXRlID0gY2VsbHNPZihyMSwgcjIsIGIpO1xyXG4gICAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBNQVhfQ09MVU1OUyAmJiAhZm91bmQ7IGMrKykge1xyXG4gICAgICAgICAgICBpZiAoY2FuZGlkYXRlLnNvbWUoKGspID0+IHRha2VuW2NdLmhhcyhrKSkpIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICBiYW5kID0gYjtcclxuICAgICAgICAgICAgY29sID0gYztcclxuICAgICAgICAgICAgY2VsbHMgPSBjYW5kaWRhdGU7XHJcbiAgICAgICAgICAgIGZvdW5kID0gdHJ1ZTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgZm9yIChjb25zdCBrIG9mIGNlbGxzKSB0YWtlbltjb2xdLmFkZChrKTtcclxuICAgICAgICBwbGFjZWQucHVzaCh7IC4uLml0LCByMSwgcjIsIGJhbmQsIGNvbCwgY2VsbHMgfSk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIHJvd3MgZ3JvdyB0byBmaXQgdGhlIGRlZXBlc3QgYmFuZCBhbnkgb2YgdGhlaXIgZXZlbnRzIHJlYWNoZXNcclxuICAgICAgY29uc3QgdW5pdHM6IG51bWJlcltdID0gcm93RWxzLm1hcCgoKSA9PiAxKTtcclxuICAgICAgZm9yIChjb25zdCBwIG9mIHBsYWNlZCkge1xyXG4gICAgICAgIGZvciAobGV0IHIgPSBwLnIxOyByIDw9IHAucjI7IHIrKylcclxuICAgICAgICAgIGlmIChyIDwgdW5pdHMubGVuZ3RoKSB1bml0c1tyXSA9IE1hdGgubWF4KHVuaXRzW3JdLCBwLmJhbmQgKyAxKTtcclxuICAgICAgfVxyXG4gICAgICBjb25zdCByb3dUb3A6IG51bWJlcltdID0gW107XHJcbiAgICAgIGxldCBhY2MgPSAwO1xyXG4gICAgICBmb3IgKGxldCByID0gMDsgciA8IHVuaXRzLmxlbmd0aDsgcisrKSB7XHJcbiAgICAgICAgcm93VG9wW3JdID0gYWNjO1xyXG4gICAgICAgIGFjYyArPSB1bml0c1tyXTtcclxuICAgICAgICByb3dFbHNbcl0uc3R5bGUuc2V0UHJvcGVydHkoXCItLWZyLXJvdy11bml0c1wiLCBTdHJpbmcodW5pdHNbcl0pKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgZm9yIChjb25zdCBwIG9mIHBsYWNlZCkge1xyXG4gICAgICAgIGNvbnN0IGNoaXAgPSByZW5kZXJTbG90Q2hpcChsYXllciwgcC5yZWYsIHAuc3Bhbik7XHJcbiAgICAgICAgLy8gYW4gZXZlbnQgb25seSBzaGFyZXMgaXRzIHdpZHRoIHdoZW4gc29tZXRoaW5nIHNpdHMgYmVzaWRlIGl0XHJcbiAgICAgICAgY29uc3QgYmVzaWRlID0gcGxhY2VkLnNvbWUoXHJcbiAgICAgICAgICAobykgPT5cclxuICAgICAgICAgICAgbyAhPT0gcCAmJlxyXG4gICAgICAgICAgICBvLmNvbCAhPT0gcC5jb2wgJiZcclxuICAgICAgICAgICAgby5jZWxscy5zb21lKChrKSA9PiBwLmNlbGxzLmluY2x1ZGVzKGspKVxyXG4gICAgICAgICk7XHJcbiAgICAgICAgY29uc3QgdG9wID1cclxuICAgICAgICAgIHJvd1RvcFtwLnIxXSArXHJcbiAgICAgICAgICBwLmJhbmQgK1xyXG4gICAgICAgICAgKHZpc2libGVTdGFydChwLnNwYW4uc3RhcnQpIC0gcm93U3RhcnRNaW4ocC5yMSkpIC8gU0xPVF9NSU5VVEVTO1xyXG4gICAgICAgIGNvbnN0IGJvdHRvbSA9XHJcbiAgICAgICAgICByb3dUb3BbcC5yMl0gK1xyXG4gICAgICAgICAgcC5iYW5kICtcclxuICAgICAgICAgIChwLnNwYW4uZW5kIC0gcm93U3RhcnRNaW4ocC5yMikpIC8gU0xPVF9NSU5VVEVTO1xyXG4gICAgICAgIGNoaXAuc2V0QXR0cihcImRhdGEtc3RhcnRcIiwgZm9ybWF0SE0ocC5zcGFuLnN0YXJ0KSk7XHJcbiAgICAgICAgY2hpcC5zZXRBdHRyKFwiZGF0YS1lbmRcIiwgZm9ybWF0SE0ocC5zcGFuLmVuZCkpO1xyXG4gICAgICAgIGNoaXAuc2V0QXR0cihcImRhdGEtYmFuZFwiLCBTdHJpbmcocC5iYW5kKSk7XHJcbiAgICAgICAgY2hpcC5zdHlsZS50b3AgPSBgY2FsYyh2YXIoLS1mci1zbG90LWgpICogJHt0b3B9KWA7XHJcbiAgICAgICAgY2hpcC5zdHlsZS5oZWlnaHQgPSBgY2FsYyh2YXIoLS1mci1zbG90LWgpICogJHtib3R0b20gLSB0b3B9IC0gM3B4KWA7XHJcbiAgICAgICAgY2hpcC5zdHlsZS5sZWZ0ID0gYmVzaWRlID8gYCR7cC5jb2wgKiA1MH0lYCA6IFwiMCVcIjtcclxuICAgICAgICBjaGlwLnN0eWxlLndpZHRoID0gYmVzaWRlID8gXCI1MCVcIiA6IFwiMTAwJVwiO1xyXG4gICAgICAgIC8vIGxldCBhIGRyb3AgbGFuZCBvbiB0aGUgc2xvdCB1bmRlcm5lYXRoIGEgbG9uZyBldmVudFxyXG4gICAgICAgIHdpcmVEcm9wWm9uZShjaGlwLCAocmVmKSA9PiB7XHJcbiAgICAgICAgICBpZiAocmVmID09PSBwLnJlZikgcmV0dXJuO1xyXG4gICAgICAgICAgcGxhY2VSZWYocmVmLCBzbG90S2V5Rm9yTWludXRlcyh2aXNpYmxlU3RhcnQocC5zcGFuLnN0YXJ0KSkpO1xyXG4gICAgICAgICAgZGVsZXRlIHNwYW5zW3JlZl07XHJcbiAgICAgICAgICByZWZyZXNoKCk7XHJcbiAgICAgICAgICBwZXJzaXN0KCk7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH1cclxuICAgIH07XHJcblxyXG4gICAgY29uc3QgcmVidWlsZEdyaWQgPSAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IHJvd0VsczogSFRNTEVsZW1lbnRbXSA9IFtdO1xyXG4gICAgICBmb3IgKGNvbnN0IGtleSBvZiBzbG90S2V5cykge1xyXG4gICAgICAgIGNvbnN0IHJvdyA9IGdyaWRFbC5jcmVhdGVEaXYoeyBjbHM6IFwicGl4ZWwtY2FsZW5kYXItcm93XCIgfSk7XHJcbiAgICAgICAgcm93RWxzLnB1c2gocm93KTtcclxuICAgICAgICByb3cuc2V0QXR0cihcImRhdGEtc2xvdFwiLCBrZXkpO1xyXG4gICAgICAgIGlmIChrZXkuZW5kc1dpdGgoXCI6MDBcIikpIHJvdy5hZGRDbGFzcyhcImlzLWhvdXJcIik7XHJcbiAgICAgICAgaWYgKGlzVG9kYXkgJiYga2V5ID09PSBjdXJyZW50U2xvdEtleShub3cpKSByb3cuYWRkQ2xhc3MoXCJpcy1ub3dcIik7XHJcbiAgICAgICAgcm93LmNyZWF0ZURpdih7IGNsczogXCJwaXhlbC1jYWxlbmRhci10aW1lXCIsIHRleHQ6IGtleSB9KTtcclxuICAgICAgICBjb25zdCB6b25lID0gcm93LmNyZWF0ZURpdih7IGNsczogXCJwaXhlbC1jYWxlbmRhci1zbG90XCIgfSk7XHJcbiAgICAgICAgem9uZS5zZXRBdHRyKFwiYXJpYS1sYWJlbFwiLCBgJHtrZXl9IFx1MjAxNCBkb3VibGUtY2xpY2sgdG8gYWRkIGEgdGFza2ApO1xyXG4gICAgICAgIHdpcmVEcm9wWm9uZSh6b25lLCAocmVmKSA9PiB7XHJcbiAgICAgICAgICBjb25zdCBkdXJhdGlvbiA9IGR1cmF0aW9uT2YocmVmKTtcclxuICAgICAgICAgIGNvbnN0IHN0YXJ0ID0gcGFyc2VITShrZXkpID8/IDA7XHJcbiAgICAgICAgICBzZXRTcGFuKHJlZiwgc3RhcnQsIHN0YXJ0ICsgZHVyYXRpb24pO1xyXG4gICAgICAgICAgcmVmcmVzaCgpO1xyXG4gICAgICAgICAgcGVyc2lzdCgpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIHpvbmUuYWRkRXZlbnRMaXN0ZW5lcihcImRibGNsaWNrXCIsIChlOiBNb3VzZUV2ZW50KSA9PiB7XHJcbiAgICAgICAgICBjb25zdCB0YXJnZXQgPSBlLnRhcmdldCBhcyBIVE1MRWxlbWVudCB8IG51bGw7XHJcbiAgICAgICAgICBpZiAodGFyZ2V0Py5jbG9zZXN0KFwiLnBpeGVsLWNhbGVuZGFyLWNoaXBcIikpIHJldHVybjtcclxuICAgICAgICAgIGlmICh6b25lLnF1ZXJ5U2VsZWN0b3IoXCIucGl4ZWwtY2FsZW5kYXItdGFzay1pbnB1dFwiKSkgcmV0dXJuO1xyXG4gICAgICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICAgICAgYWRkVGFza0F0KHpvbmUsIGtleSk7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH1cclxuICAgICAgLy8gcm93cyB2YXJ5IGluIGhlaWdodCwgc28ga2VlcCBhbiB1bnNjYWxlZCBydWxlciBmb3IgdGhlIHJlc2l6ZSBtYXRoc1xyXG4gICAgICBncmlkRWwuY3JlYXRlRGl2KHsgY2xzOiBcInBpeGVsLWNhbGVuZGFyLXVuaXRcIiB9KTtcclxuICAgICAgbGF5b3V0RXZlbnRzKGdyaWRFbC5jcmVhdGVEaXYoeyBjbHM6IFwicGl4ZWwtY2FsZW5kYXItZXZlbnRzXCIgfSksIHJvd0Vscyk7XHJcbiAgICB9O1xyXG5cclxuICAgIHJlZnJlc2ggPSAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IHByZXZTY3JvbGwgPSBncmlkV3JhcC5zY3JvbGxUb3A7XHJcblxyXG4gICAgICBzaWRlRWwuZW1wdHkoKTtcclxuICAgICAgY29uc3Qgc2lkZUhlYWRlciA9IHNpZGVFbC5jcmVhdGVEaXYoeyBjbHM6IFwicGl4ZWwtY2FsZW5kYXItc2lkZS1oZWFkZXJcIiB9KTtcclxuICAgICAgc2lkZUhlYWRlci5jcmVhdGVTcGFuKHtcclxuICAgICAgICBjbHM6IFwicGl4ZWwtY2FsZW5kYXItc2lkZS10aXRsZVwiLFxyXG4gICAgICAgIHRleHQ6IFwiSGFiaXRzXCIsXHJcbiAgICAgIH0pO1xyXG4gICAgICBzaWRlSGVhZGVyLmNyZWF0ZVNwYW4oe1xyXG4gICAgICAgIGNsczogXCJwaXhlbC1jYWxlbmRhci1zaWRlLWhpbnRcIixcclxuICAgICAgICB0ZXh0OiBcIkRvdWJsZS1jbGljayBhIHRpbWUgdG8gYWRkIGEgdGFza1wiLFxyXG4gICAgICB9KTtcclxuICAgICAgY29uc3Qgc2lkZUxpc3QgPSBzaWRlRWwuY3JlYXRlRGl2KHsgY2xzOiBcInBpeGVsLWNhbGVuZGFyLXNpZGUtbGlzdFwiIH0pO1xyXG4gICAgICBpZiAoaGFiaXRGaWxlcy5sZW5ndGggPT09IDApIHtcclxuICAgICAgICBzaWRlTGlzdC5jcmVhdGVEaXYoe1xyXG4gICAgICAgICAgY2xzOiBcInBpeGVsLWNhbGVuZGFyLXNpZGUtZW1wdHlcIixcclxuICAgICAgICAgIHRleHQ6IGBObyBoYWJpdHMgZm91bmQgaW4gXCIke3RoaXMuc2V0dGluZ3Mucm91dGluZXNGb2xkZXJ9XCIuYCxcclxuICAgICAgICB9KTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICByZW5kZXJTaWRlRm9sZGVyKHJvb3QsIHNpZGVMaXN0LCAwKTtcclxuICAgICAgfVxyXG4gICAgICB3aXJlRHJvcFpvbmUoc2lkZUxpc3QsIChyZWYpID0+IHtcclxuICAgICAgICBkaXNjYXJkUmVmKHJlZik7XHJcbiAgICAgICAgcmVmcmVzaCgpO1xyXG4gICAgICAgIHBlcnNpc3QoKTtcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBncmlkRWwuZW1wdHkoKTtcclxuICAgICAgcmVidWlsZEdyaWQoKTtcclxuICAgICAgZ3JpZFdyYXAuc2Nyb2xsVG9wID0gcHJldlNjcm9sbDtcclxuICAgIH07XHJcblxyXG4gICAgcmVmcmVzaCgpO1xyXG5cclxuICAgIHRoaXMucmVnaXN0ZXJCbG9ja0xpc3RlbmVyKGVsLCBjdHgsIChldikgPT4ge1xyXG4gICAgICBpZiAoZXYub3JpZ2luSWQgPT09IGJsb2NrSWQgfHwgZXYuZGF0ZVN0ciAhPT0gZGF0ZVN0cikgcmV0dXJuO1xyXG4gICAgICBpZiAoIXN1YnRhc2tzQnlQYXRoLmhhcyhldi5wYXRoKSkgcmV0dXJuO1xyXG4gICAgICBhcHBseURvbmUoZXYucGF0aCwgZXYuc3VidGFzaywgZXYuY2hlY2tlZCwgZXYuc3VidGFza3MpO1xyXG4gICAgICByZWZyZXNoKCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBTY3JvbGwgdG8gdGhlIGN1cnJlbnQgdGltZSAodG9kYXkpIG9yIGEgc2Vuc2libGUgZGVmYXVsdCBvbiBmaXJzdCByZW5kZXIuXHJcbiAgICAvLyBFaXRoZXIgY2FuIGZhbGwgb3V0c2lkZSB0aGUgdmlzaWJsZSByYW5nZSwgd2hpY2gganVzdCBsZWF2ZXMgdXMgYXQgdGhlIHRvcC5cclxuICAgIGNvbnN0IHNjcm9sbEtleSA9IGlzVG9kYXlcclxuICAgICAgPyBjdXJyZW50U2xvdEtleShub3cpXHJcbiAgICAgIDogc2xvdEtleUZvck1pbnV0ZXModmlzaWJsZVN0YXJ0KDggKiA2MCkpO1xyXG4gICAgY29uc3QgdGFyZ2V0Um93ID0gZ3JpZEVsLnF1ZXJ5U2VsZWN0b3IoXHJcbiAgICAgIGBbZGF0YS1zbG90PVwiJHtzY3JvbGxLZXl9XCJdYFxyXG4gICAgKSBhcyBIVE1MRWxlbWVudCB8IG51bGw7XHJcbiAgICBpZiAodGFyZ2V0Um93KSBncmlkV3JhcC5zY3JvbGxUb3AgPSBNYXRoLm1heCgwLCB0YXJnZXRSb3cub2Zmc2V0VG9wIC0gOCk7XHJcbiAgfVxyXG5cclxuICAvKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuICAgICBTdGF0cyBib2FyZCAoYGBgcm91dGluZS1zdGF0c2BgYClcclxuICAgICA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi9cclxuXHJcbiAgcHJpdmF0ZSBnZXRFbnRyeURhdGVzKFxyXG4gICAgZmlsZTogVEZpbGUsXHJcbiAgICBvdmVycmlkZXM/OiBFbnRyeVN0YXRlT3ZlcnJpZGVzXHJcbiAgKTogU2V0PHN0cmluZz4ge1xyXG4gICAgY29uc3QgZm0gPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShmaWxlKT8uZnJvbnRtYXR0ZXI7XHJcbiAgICBjb25zdCBlbnRyaWVzID0gbmV3IFNldChcclxuICAgICAgdGhpcy5ub3JtYWxpemVFbnRyaWVzKGZtPy5bdGhpcy5zZXR0aW5ncy5lbnRyaWVzUHJvcGVydHldKVxyXG4gICAgKTtcclxuICAgIGNvbnN0IGZpbGVPdmVycmlkZXMgPSBvdmVycmlkZXM/LmdldChmaWxlLnBhdGgpO1xyXG4gICAgaWYgKCFmaWxlT3ZlcnJpZGVzKSByZXR1cm4gZW50cmllcztcclxuXHJcbiAgICBmb3IgKGNvbnN0IFtkYXRlU3RyLCBleHBlY3RlZF0gb2YgZmlsZU92ZXJyaWRlcykge1xyXG4gICAgICBpZiAoZW50cmllcy5oYXMoZGF0ZVN0cikgPT09IGV4cGVjdGVkKSB7XHJcbiAgICAgICAgZmlsZU92ZXJyaWRlcy5kZWxldGUoZGF0ZVN0cik7XHJcbiAgICAgIH0gZWxzZSBpZiAoZXhwZWN0ZWQpIHtcclxuICAgICAgICBlbnRyaWVzLmFkZChkYXRlU3RyKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBlbnRyaWVzLmRlbGV0ZShkYXRlU3RyKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgaWYgKGZpbGVPdmVycmlkZXMuc2l6ZSA9PT0gMCkgb3ZlcnJpZGVzPy5kZWxldGUoZmlsZS5wYXRoKTtcclxuICAgIHJldHVybiBlbnRyaWVzO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzZXRFbnRyeU92ZXJyaWRlKFxyXG4gICAgb3ZlcnJpZGVzOiBFbnRyeVN0YXRlT3ZlcnJpZGVzLFxyXG4gICAgcGF0aDogc3RyaW5nLFxyXG4gICAgZGF0ZVN0cjogc3RyaW5nLFxyXG4gICAgZXhwZWN0ZWQ6IGJvb2xlYW4sXHJcbiAgKSB7XHJcbiAgICBsZXQgZmlsZU92ZXJyaWRlcyA9IG92ZXJyaWRlcy5nZXQocGF0aCk7XHJcbiAgICBpZiAoIWZpbGVPdmVycmlkZXMpIHtcclxuICAgICAgZmlsZU92ZXJyaWRlcyA9IG5ldyBNYXAoKTtcclxuICAgICAgb3ZlcnJpZGVzLnNldChwYXRoLCBmaWxlT3ZlcnJpZGVzKTtcclxuICAgIH1cclxuICAgIGZpbGVPdmVycmlkZXMuc2V0KGRhdGVTdHIsIGV4cGVjdGVkKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgY29sbGVjdFNlY3Rpb25GaWxlcyhmb2xkZXI6IFRGb2xkZXIpOiBURmlsZVtdIHtcclxuICAgIHJldHVybiBbLi4uZm9sZGVyLmNoaWxkcmVuXVxyXG4gICAgICAuZmlsdGVyKChjKTogYyBpcyBURmlsZSA9PiBjIGluc3RhbmNlb2YgVEZpbGUgJiYgYy5leHRlbnNpb24gPT09IFwibWRcIilcclxuICAgICAgLnNvcnQoKGEsIGIpID0+IGEubmFtZS5sb2NhbGVDb21wYXJlKGIubmFtZSkpO1xyXG4gIH1cclxuXHJcbiAgLyogTG9uZ2VzdCBydW4gb2YgY29uc2VjdXRpdmUgdHJ1ZSB2YWx1ZXMuICovXHJcbiAgcHJpdmF0ZSBiZXN0U3RyZWFrKGZsYWdzOiBib29sZWFuW10pOiBudW1iZXIge1xyXG4gICAgbGV0IGJlc3QgPSAwO1xyXG4gICAgbGV0IHJ1biA9IDA7XHJcbiAgICBmb3IgKGNvbnN0IGYgb2YgZmxhZ3MpIHtcclxuICAgICAgcnVuID0gZiA/IHJ1biArIDEgOiAwO1xyXG4gICAgICBpZiAocnVuID4gYmVzdCkgYmVzdCA9IHJ1bjtcclxuICAgIH1cclxuICAgIHJldHVybiBiZXN0O1xyXG4gIH1cclxuXHJcbiAgLyogVHJhaWxpbmcgcnVuIG9mIHRydWUgdmFsdWVzIGVuZGluZyBhdCB0aGUgbGFzdCBpbmRleCAodG9kYXkpLiAqL1xyXG4gIHByaXZhdGUgY3VycmVudFN0cmVhayhmbGFnczogYm9vbGVhbltdKTogbnVtYmVyIHtcclxuICAgIGxldCBydW4gPSAwO1xyXG4gICAgZm9yIChsZXQgaSA9IGZsYWdzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XHJcbiAgICAgIGlmIChmbGFnc1tpXSkgcnVuKys7XHJcbiAgICAgIGVsc2UgYnJlYWs7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcnVuO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSByYW5rRm9yKHBjdDogbnVtYmVyKTogc3RyaW5nIHtcclxuICAgIGlmIChwY3QgPj0gOTUpIHJldHVybiBcIlNcIjtcclxuICAgIGlmIChwY3QgPj0gODUpIHJldHVybiBcIkFcIjtcclxuICAgIGlmIChwY3QgPj0gNzApIHJldHVybiBcIkJcIjtcclxuICAgIGlmIChwY3QgPj0gNTApIHJldHVybiBcIkNcIjtcclxuICAgIGlmIChwY3QgPj0gMjUpIHJldHVybiBcIkRcIjtcclxuICAgIHJldHVybiBcIkVcIjtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3BhcmtsaW5lKHBlckRheTogbnVtYmVyW10sIHJvdXRpbmVzOiBudW1iZXIpOiBzdHJpbmcge1xyXG4gICAgY29uc3QgZ2x5cGhzID0gW1wiXHUyNTgxXCIsIFwiXHUyNTgyXCIsIFwiXHUyNTgzXCIsIFwiXHUyNTg0XCIsIFwiXHUyNTg1XCIsIFwiXHUyNTg2XCIsIFwiXHUyNTg3XCIsIFwiXHUyNTg4XCJdO1xyXG4gICAgaWYgKHJvdXRpbmVzIDw9IDApIHJldHVybiBcIlwiO1xyXG4gICAgcmV0dXJuIHBlckRheVxyXG4gICAgICAubWFwKCh2KSA9PiB7XHJcbiAgICAgICAgY29uc3QgcmF0aW8gPSBNYXRoLm1heCgwLCBNYXRoLm1pbigxLCB2IC8gcm91dGluZXMpKTtcclxuICAgICAgICBjb25zdCBpZHggPVxyXG4gICAgICAgICAgdiA9PT0gMCA/IDAgOiBNYXRoLm1heCgxLCBNYXRoLnJvdW5kKHJhdGlvICogKGdseXBocy5sZW5ndGggLSAxKSkpO1xyXG4gICAgICAgIHJldHVybiBnbHlwaHNbaWR4XTtcclxuICAgICAgfSlcclxuICAgICAgLmpvaW4oXCJcIik7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHJlbmRlclN0YXRzKFxyXG4gICAgc291cmNlOiBzdHJpbmcsXHJcbiAgICBlbDogSFRNTEVsZW1lbnQsXHJcbiAgICBjdHg6IE1hcmtkb3duUG9zdFByb2Nlc3NvckNvbnRleHRcclxuICApIHtcclxuICAgIGVsLmVtcHR5KCk7XHJcblxyXG4gICAgY29uc3Qgcm9vdCA9IHRoaXMucm91dGluZXNSb290KCk7XHJcbiAgICBpZiAoIXJvb3QpIHtcclxuICAgICAgZWwuY3JlYXRlRGl2KHtcclxuICAgICAgICBjbHM6IFwiZm9sZGVyLXJvdXRpbmVzLWVycm9yXCIsXHJcbiAgICAgICAgdGV4dDogYEZvbGRlciBSb3V0aW5lczogZm9sZGVyIFwiJHt0aGlzLnNldHRpbmdzLnJvdXRpbmVzRm9sZGVyfVwiIG5vdCBmb3VuZC4gU2V0IGl0IGluIHBsdWdpbiBzZXR0aW5ncy5gLFxyXG4gICAgICB9KTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGNvbnRhaW5lciA9IGVsLmNyZWF0ZURpdih7IGNsczogXCJmb2xkZXItcm91dGluZXMgcm91dGluZS1zdGF0c1wiIH0pO1xyXG5cclxuICAgIGNvbnN0IHRvb2xiYXIgPSBjb250YWluZXIuY3JlYXRlRGl2KHsgY2xzOiBcInJvdXRpbmUtc3RhdHMtdG9vbGJhclwiIH0pO1xyXG4gICAgdG9vbGJhci5jcmVhdGVTcGFuKHsgY2xzOiBcInJvdXRpbmUtc3RhdHMtdG9vbGJhci10aXRsZVwiLCB0ZXh0OiBcIlNUQVRTXCIgfSk7XHJcbiAgICB0b29sYmFyLmNyZWF0ZVNwYW4oeyBjbHM6IFwicm91dGluZS1zdGF0cy10b29sYmFyLXJhbmdlXCIsIHRleHQ6IFwiMjEgREFZU1wiIH0pO1xyXG5cclxuICAgIGNvbnN0IGJvYXJkcyA9IGNvbnRhaW5lci5jcmVhdGVEaXYoeyBjbHM6IFwicm91dGluZS1zdGF0cy1ib2FyZHNcIiB9KTtcclxuICAgIGNvbnN0IGJsb2NrSWQgPSB0aGlzLm5leHRCbG9ja0lkKCk7XHJcbiAgICBjb25zdCBlbnRyeU92ZXJyaWRlczogRW50cnlTdGF0ZU92ZXJyaWRlcyA9IG5ldyBNYXAoKTtcclxuICAgIHRoaXMucmVuZGVyU3RhdHNCb2FyZHMoYm9hcmRzLCByb290LCAyMSwgYmxvY2tJZCwgZW50cnlPdmVycmlkZXMpO1xyXG5cclxuICAgIHRoaXMucmVnaXN0ZXJCbG9ja0xpc3RlbmVyKGVsLCBjdHgsIChldikgPT4ge1xyXG4gICAgICBpZiAoZXYub3JpZ2luSWQgPT09IGJsb2NrSWQpIHJldHVybjtcclxuICAgICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChldi5wYXRoKTtcclxuICAgICAgaWYgKCEoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSkgcmV0dXJuO1xyXG4gICAgICB0aGlzLnNldEVudHJ5T3ZlcnJpZGUoXHJcbiAgICAgICAgZW50cnlPdmVycmlkZXMsXHJcbiAgICAgICAgZmlsZS5wYXRoLFxyXG4gICAgICAgIGV2LmRhdGVTdHIsXHJcbiAgICAgICAgZXYucGFyZW50Q2hlY2tlZFxyXG4gICAgICApO1xyXG4gICAgICB0aGlzLnJlbmRlclN0YXRzQm9hcmRzKFxyXG4gICAgICAgIGJvYXJkcyxcclxuICAgICAgICByb290LFxyXG4gICAgICAgIDIxLFxyXG4gICAgICAgIGJsb2NrSWQsXHJcbiAgICAgICAgZW50cnlPdmVycmlkZXNcclxuICAgICAgKTtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSByZW5kZXJTdGF0c0JvYXJkcyhcclxuICAgIGhvc3Q6IEhUTUxFbGVtZW50LFxyXG4gICAgcm9vdDogVEZvbGRlcixcclxuICAgIGRheXM6IG51bWJlcixcclxuICAgIGJsb2NrSWQ6IHN0cmluZyxcclxuICAgIGVudHJ5T3ZlcnJpZGVzOiBFbnRyeVN0YXRlT3ZlcnJpZGVzXHJcbiAgKSB7XHJcbiAgICBob3N0LmVtcHR5KCk7XHJcblxyXG4gICAgY29uc3QgdG9kYXkgPSBtb21lbnQoKS5zdGFydE9mKFwiZGF5XCIpO1xyXG4gICAgY29uc3QgZGF0ZVN0cnM6IHN0cmluZ1tdID0gW107XHJcbiAgICBjb25zdCBsYWJlbHM6IHN0cmluZ1tdID0gW107XHJcbiAgICBmb3IgKGxldCBpID0gZGF5cyAtIDE7IGkgPj0gMDsgaS0tKSB7XHJcbiAgICAgIGNvbnN0IGQgPSB0b2RheS5jbG9uZSgpLnN1YnRyYWN0KGksIFwiZGF5c1wiKTtcclxuICAgICAgZGF0ZVN0cnMucHVzaChkLmZvcm1hdCh0aGlzLnNldHRpbmdzLnN0b3JlRGF0ZUZvcm1hdCB8fCBcIllZWVktTU0tRERcIikpO1xyXG4gICAgICBsYWJlbHMucHVzaChkLmZvcm1hdChcIkRcIikpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIG9uZSBncmlkIHBlciBzdWJmb2xkZXIgKEZpdG5lc3MsIE5hbWF6LCAuLi4pIHBsdXMgcm9vdC1sZXZlbCBmaWxlc1xyXG4gICAgY29uc3Qgc2VjdGlvbnM6IHsgbmFtZTogc3RyaW5nOyBmaWxlczogVEZpbGVbXSB9W10gPSBbXTtcclxuICAgIGNvbnN0IHJvb3RGaWxlcyA9IHRoaXMuY29sbGVjdFNlY3Rpb25GaWxlcyhyb290KTtcclxuICAgIGlmIChyb290RmlsZXMubGVuZ3RoKVxyXG4gICAgICBzZWN0aW9ucy5wdXNoKHsgbmFtZTogdGhpcy5kaXNwbGF5TmFtZShyb290Lm5hbWUpLCBmaWxlczogcm9vdEZpbGVzIH0pO1xyXG4gICAgY29uc3Qgc3ViZm9sZGVycyA9IFsuLi5yb290LmNoaWxkcmVuXVxyXG4gICAgICAuZmlsdGVyKChjKTogYyBpcyBURm9sZGVyID0+IGMgaW5zdGFuY2VvZiBURm9sZGVyKVxyXG4gICAgICAuc29ydCgoYSwgYikgPT4gYS5uYW1lLmxvY2FsZUNvbXBhcmUoYi5uYW1lKSk7XHJcbiAgICBmb3IgKGNvbnN0IHN1YiBvZiBzdWJmb2xkZXJzKSB7XHJcbiAgICAgIGNvbnN0IGZpbGVzID0gdGhpcy5jb2xsZWN0U2VjdGlvbkZpbGVzKHN1Yik7XHJcbiAgICAgIGlmIChmaWxlcy5sZW5ndGgpXHJcbiAgICAgICAgc2VjdGlvbnMucHVzaCh7IG5hbWU6IHRoaXMuZGlzcGxheU5hbWUoc3ViLm5hbWUpLCBmaWxlcyB9KTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoc2VjdGlvbnMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgIGhvc3QuY3JlYXRlRGl2KHtcclxuICAgICAgICBjbHM6IFwiZm9sZGVyLXJvdXRpbmVzLWVycm9yXCIsXHJcbiAgICAgICAgdGV4dDogXCJGb2xkZXIgUm91dGluZXM6IG5vIHJvdXRpbmUgbm90ZXMgZm91bmQuXCIsXHJcbiAgICAgIH0pO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3Qgd2Vla2RheXMgPSBbXCJTXCIsIFwiTVwiLCBcIlRcIiwgXCJXXCIsIFwiVFwiLCBcIkZcIiwgXCJTXCJdO1xyXG5cclxuICAgIHNlY3Rpb25zLmZvckVhY2goKHNlY3Rpb24sIHNlY3Rpb25JbmRleCkgPT4ge1xyXG4gICAgICBjb25zdCBjb2xvckluZGV4ID0gc2VjdGlvbkluZGV4ICUgRm9sZGVyUm91dGluZXNQbHVnaW4uU0VDVElPTl9DT0xPUlM7XHJcbiAgICAgIGNvbnN0IGJvYXJkID0gaG9zdC5jcmVhdGVEaXYoe1xyXG4gICAgICAgIGNsczogYGZvbGRlci1yb3V0aW5lcy1zZWN0aW9uIHJvdXRpbmUtc3RhdHMtYm9hcmQgZm9sZGVyLXJvdXRpbmVzLWNvbG9yLSR7XHJcbiAgICAgICAgICBjb2xvckluZGV4ICsgMVxyXG4gICAgICAgIH1gLFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIC8qIC0tLS0gZ2F0aGVyIHBlci1kYXkgLyBwZXItcm91dGluZSBkYXRhIC0tLS0gKi9cclxuICAgICAgY29uc3Qgcm93cyA9IHNlY3Rpb24uZmlsZXMubWFwKChmaWxlKSA9PiB7XHJcbiAgICAgICAgY29uc3QgZGF0ZXMgPSB0aGlzLmdldEVudHJ5RGF0ZXMoZmlsZSwgZW50cnlPdmVycmlkZXMpO1xyXG4gICAgICAgIGNvbnN0IGZsYWdzID0gZGF0ZVN0cnMubWFwKChkcykgPT4gZGF0ZXMuaGFzKGRzKSk7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIGZpbGUsXHJcbiAgICAgICAgICBuYW1lOiB0aGlzLmRpc3BsYXlOYW1lKGZpbGUuYmFzZW5hbWUpLFxyXG4gICAgICAgICAgZmxhZ3MsXHJcbiAgICAgICAgICBkb25lOiBmbGFncy5maWx0ZXIoQm9vbGVhbikubGVuZ3RoLFxyXG4gICAgICAgIH07XHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgY29uc3QgcGVyRGF5ID0gZGF0ZVN0cnMubWFwKFxyXG4gICAgICAgIChfLCBkaSkgPT4gcm93cy5maWx0ZXIoKHIpID0+IHIuZmxhZ3NbZGldKS5sZW5ndGhcclxuICAgICAgKTtcclxuICAgICAgY29uc3Qgc2VjdGlvbkRvbmUgPSByb3dzLnJlZHVjZSgocywgcikgPT4gcyArIHIuZG9uZSwgMCk7XHJcbiAgICAgIGNvbnN0IHNlY3Rpb25Ub3RhbCA9IHNlY3Rpb24uZmlsZXMubGVuZ3RoICogZGF5cyB8fCAxO1xyXG4gICAgICBjb25zdCBwY3QgPSBNYXRoLnJvdW5kKChzZWN0aW9uRG9uZSAvIHNlY3Rpb25Ub3RhbCkgKiAxMDApO1xyXG4gICAgICBjb25zdCByYW5rID0gdGhpcy5yYW5rRm9yKHBjdCk7XHJcbiAgICAgIGNvbnN0IHhwID0gc2VjdGlvbkRvbmUgKiA1O1xyXG4gICAgICBjb25zdCBsZXZlbCA9IE1hdGgubWF4KDEsIE1hdGguZmxvb3IoeHAgLyAxMDApICsgMSk7XHJcblxyXG4gICAgICAvLyBzZWN0aW9uLWxldmVsIHN0cmVha3M6IGEgXCJwZXJmZWN0IGRheVwiID0gYWxsIHJvdXRpbmVzIGRvbmUgdGhhdCBkYXlcclxuICAgICAgY29uc3QgcGVyZmVjdERheSA9IHBlckRheS5tYXAoKHYpID0+IHYgPT09IHNlY3Rpb24uZmlsZXMubGVuZ3RoICYmIHYgPiAwKTtcclxuICAgICAgY29uc3QgY3VyU3RyZWFrID0gdGhpcy5jdXJyZW50U3RyZWFrKHBlcmZlY3REYXkpO1xyXG4gICAgICBjb25zdCBiZXN0U3RyZWFrID0gTWF0aC5tYXgoXHJcbiAgICAgICAgLi4ucm93cy5tYXAoKHIpID0+IHRoaXMuYmVzdFN0cmVhayhyLmZsYWdzKSksXHJcbiAgICAgICAgdGhpcy5iZXN0U3RyZWFrKHBlcmZlY3REYXkpXHJcbiAgICAgICk7XHJcbiAgICAgIGNvbnN0IG1pc3NlZCA9IHNlY3Rpb25Ub3RhbCAtIHNlY3Rpb25Eb25lO1xyXG5cclxuICAgICAgLyogLS0tLSBoZWFkZXIgd2l0aCBtZXRhZGF0YSAtLS0tICovXHJcbiAgICAgIGNvbnN0IGhlYWRlciA9IGJvYXJkLmNyZWF0ZURpdih7IGNsczogXCJmb2xkZXItcm91dGluZXMtaGVhZGluZyByb3V0aW5lLXN0YXRzLWhlYWRcIiB9KTtcclxuICAgICAgaGVhZGVyLmNyZWF0ZVNwYW4oe1xyXG4gICAgICAgIGNsczogXCJmb2xkZXItcm91dGluZXMtYmFubmVyXCIsXHJcbiAgICAgICAgdGV4dDogdGhpcy5nZXRDYXRlZ29yeUljb24oc2VjdGlvbi5uYW1lKSxcclxuICAgICAgfSk7XHJcbiAgICAgIGNvbnN0IGhlYWRNYWluID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJyb3V0aW5lLXN0YXRzLWhlYWQtbWFpblwiIH0pO1xyXG4gICAgICBoZWFkTWFpbi5jcmVhdGVTcGFuKHtcclxuICAgICAgICBjbHM6IFwiZm9sZGVyLXJvdXRpbmVzLWhlYWRpbmctdGl0bGVcIixcclxuICAgICAgICB0ZXh0OiBzZWN0aW9uLm5hbWUsXHJcbiAgICAgIH0pO1xyXG4gICAgICBjb25zdCBoZWFkTWV0YSA9IGhlYWRNYWluLmNyZWF0ZURpdih7IGNsczogXCJyb3V0aW5lLXN0YXRzLWhlYWQtbWV0YVwiIH0pO1xyXG4gICAgICBoZWFkTWV0YS5jcmVhdGVTcGFuKHsgY2xzOiBcInJvdXRpbmUtc3RhdHMtbHZsXCIsIHRleHQ6IGBMVi4ke2xldmVsfWAgfSk7XHJcbiAgICAgIGhlYWRNZXRhLmNyZWF0ZVNwYW4oeyB0ZXh0OiBgXHVEODNEXHVERDI1ICR7Y3VyU3RyZWFrfWAgfSk7XHJcbiAgICAgIGhlYWRNZXRhLmNyZWF0ZVNwYW4oeyB0ZXh0OiBgJHtwY3R9JWAgfSk7XHJcbiAgICAgIGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwicm91dGluZS1zdGF0cy1yYW5rXCIsIHRleHQ6IHJhbmsgfSk7XHJcblxyXG4gICAgICAvKiAtLS0tIHN1bW1hcnkgc3RhdCBiYXIgLS0tLSAqL1xyXG4gICAgICBjb25zdCBzdW1tYXJ5ID0gYm9hcmQuY3JlYXRlRGl2KHsgY2xzOiBcInJvdXRpbmUtc3RhdHMtc3VtbWFyeVwiIH0pO1xyXG4gICAgICBjb25zdCBzdGF0ID0gKGljb246IHN0cmluZywgbGFiZWw6IHN0cmluZywgdmFsdWU6IHN0cmluZywgbW9kID0gXCJcIikgPT4ge1xyXG4gICAgICAgIGNvbnN0IHMgPSBzdW1tYXJ5LmNyZWF0ZURpdih7IGNsczogYHJvdXRpbmUtc3RhdHMtc3RhdCAke21vZH1gIH0pO1xyXG4gICAgICAgIHMuY3JlYXRlU3Bhbih7IGNsczogXCJyb3V0aW5lLXN0YXRzLXN0YXQtaWNvblwiLCB0ZXh0OiBpY29uIH0pO1xyXG4gICAgICAgIGNvbnN0IGIgPSBzLmNyZWF0ZURpdih7IGNsczogXCJyb3V0aW5lLXN0YXRzLXN0YXQtYm9keVwiIH0pO1xyXG4gICAgICAgIGIuY3JlYXRlU3Bhbih7IGNsczogXCJyb3V0aW5lLXN0YXRzLXN0YXQtbGFiZWxcIiwgdGV4dDogbGFiZWwgfSk7XHJcbiAgICAgICAgYi5jcmVhdGVTcGFuKHsgY2xzOiBcInJvdXRpbmUtc3RhdHMtc3RhdC12YWx1ZVwiLCB0ZXh0OiB2YWx1ZSB9KTtcclxuICAgICAgfTtcclxuICAgICAgc3RhdChcIlx1RDgzRFx1REQyNVwiLCBcIkJFU1RcIiwgU3RyaW5nKGJlc3RTdHJlYWspLCBcImlzLWJlc3RcIik7XHJcbiAgICAgIHN0YXQoXCJcdTI2QTFcIiwgXCJTVFJFQUtcIiwgU3RyaW5nKGN1clN0cmVhayksIFwiaXMtc3RyZWFrXCIpO1xyXG4gICAgICBzdGF0KFwiXHVEODNDXHVERkM2XCIsIFwiRE9ORVwiLCBgJHtwY3R9JWAsIFwiaXMtZG9uZVwiKTtcclxuICAgICAgc3RhdChcIlx1MkI1MFwiLCBcIlhQXCIsIGArJHt4cH1gLCBcImlzLXhwXCIpO1xyXG5cclxuICAgICAgLyogLS0tLSBjb21wbGV0aW9uIEhVRCAtLS0tICovXHJcbiAgICAgIGNvbnN0IGh1ZCA9IGJvYXJkLmNyZWF0ZURpdih7IGNsczogXCJyb3V0aW5lLXN0YXRzLWh1ZFwiIH0pO1xyXG4gICAgICBodWQuY3JlYXRlU3Bhbih7IGNsczogXCJyb3V0aW5lLXN0YXRzLWh1ZC1sYWJlbFwiLCB0ZXh0OiBcIkNPTVBMRVRJT05cIiB9KTtcclxuICAgICAgY29uc3QgaHVkQmFyID0gaHVkLmNyZWF0ZURpdih7IGNsczogXCJyb3V0aW5lLXN0YXRzLWh1ZC1iYXJcIiB9KTtcclxuICAgICAgY29uc3QgaHVkQmxvY2tzID0gMTA7XHJcbiAgICAgIGNvbnN0IGh1ZEZpbGxlZCA9IE1hdGgucm91bmQoKHBjdCAvIDEwMCkgKiBodWRCbG9ja3MpO1xyXG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGh1ZEJsb2NrczsgaSsrKSB7XHJcbiAgICAgICAgY29uc3QgYmxrID0gaHVkQmFyLmNyZWF0ZURpdih7IGNsczogXCJyb3V0aW5lLXN0YXRzLWh1ZC1ibG9ja1wiIH0pO1xyXG4gICAgICAgIGJsay50b2dnbGVDbGFzcyhcImlzLWZpbGxlZFwiLCBpIDwgaHVkRmlsbGVkKTtcclxuICAgICAgICBibGsuc3R5bGUuc2V0UHJvcGVydHkoXCItLWZyLWJsa1wiLCBTdHJpbmcoaSkpO1xyXG4gICAgICB9XHJcbiAgICAgIGh1ZC5jcmVhdGVTcGFuKHsgY2xzOiBcInJvdXRpbmUtc3RhdHMtaHVkLXBjdFwiLCB0ZXh0OiBgJHtwY3R9JWAgfSk7XHJcblxyXG4gICAgICAvKiAtLS0tIGdyaWQsIHdlZWstZ3JvdXBlZCAtLS0tICovXHJcbiAgICAgIGNvbnN0IHdlZWtzID0gTWF0aC5jZWlsKGRheXMgLyA3KTtcclxuICAgICAgY29uc3QgZ3JpZCA9IGJvYXJkLmNyZWF0ZURpdih7IGNsczogXCJyb3V0aW5lLXN0YXRzLWdyaWRcIiB9KTtcclxuICAgICAgZ3JpZC5zdHlsZS5zZXRQcm9wZXJ0eShcIi0tZnItc3RhdHMtZGF5c1wiLCBTdHJpbmcoZGF5cykpO1xyXG4gICAgICBncmlkLnN0eWxlLnNldFByb3BlcnR5KFwiLS1mci1zdGF0cy13ZWVrc1wiLCBTdHJpbmcod2Vla3MpKTtcclxuICAgICAgLy8gYnVpbGQgY29sdW1uIHRlbXBsYXRlIHdpdGggYSBzcGFjZXIgY29sdW1uIGJlZm9yZSBlYWNoIG5ldyB3ZWVrXHJcbiAgICAgIGNvbnN0IGRheUNvbHM6IHN0cmluZ1tdID0gW107XHJcbiAgICAgIGZvciAobGV0IGRpID0gMDsgZGkgPCBkYXlzOyBkaSsrKSB7XHJcbiAgICAgICAgaWYgKGRpICUgNyA9PT0gMCAmJiBkaSAhPT0gMCkgZGF5Q29scy5wdXNoKFwiMC40cmVtXCIpO1xyXG4gICAgICAgIGRheUNvbHMucHVzaChcIjEuMTVyZW1cIik7XHJcbiAgICAgIH1cclxuICAgICAgZ3JpZC5zdHlsZS5ncmlkVGVtcGxhdGVDb2x1bW5zID0gYG1heC1jb250ZW50ICR7ZGF5Q29scy5qb2luKFxyXG4gICAgICAgIFwiIFwiXHJcbiAgICAgICl9IGF1dG9gO1xyXG5cclxuICAgICAgLy8gZGF5LW9mLXdlZWsgaGVhZGVyIHJvd1xyXG4gICAgICBncmlkLmNyZWF0ZURpdih7IGNsczogXCJyb3V0aW5lLXN0YXRzLWNlbGwgcm91dGluZS1zdGF0cy1jb3JuZXJcIiB9KTtcclxuICAgICAgZGF0ZVN0cnMuZm9yRWFjaCgoZHMsIGRpKSA9PiB7XHJcbiAgICAgICAgaWYgKGRpICUgNyA9PT0gMCAmJiBkaSAhPT0gMClcclxuICAgICAgICAgIGdyaWQuY3JlYXRlRGl2KHsgY2xzOiBcInJvdXRpbmUtc3RhdHMtc3BhY2VyXCIgfSk7XHJcbiAgICAgICAgY29uc3Qgd2QgPSBtb21lbnQoZHMsIHRoaXMuc2V0dGluZ3Muc3RvcmVEYXRlRm9ybWF0IHx8IFwiWVlZWS1NTS1ERFwiKS5kYXkoKTtcclxuICAgICAgICBjb25zdCBjZWxsID0gZ3JpZC5jcmVhdGVEaXYoe1xyXG4gICAgICAgICAgY2xzOiBcInJvdXRpbmUtc3RhdHMtY2VsbCByb3V0aW5lLXN0YXRzLWRheWxhYmVsXCIsXHJcbiAgICAgICAgICB0ZXh0OiB3ZWVrZGF5c1t3ZF0sXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgaWYgKGRpID09PSBkYXlzIC0gMSkgY2VsbC5hZGRDbGFzcyhcImlzLXRvZGF5LWNvbFwiKTtcclxuICAgICAgfSk7XHJcbiAgICAgIGdyaWQuY3JlYXRlRGl2KHtcclxuICAgICAgICBjbHM6IFwicm91dGluZS1zdGF0cy1jZWxsIHJvdXRpbmUtc3RhdHMtZGF5bGFiZWwgcm91dGluZS1zdGF0cy10b3RhbC1oZWFkXCIsXHJcbiAgICAgICAgdGV4dDogXCJcdTAzQTNcIixcclxuICAgICAgfSk7XHJcblxyXG4gICAgICByb3dzLmZvckVhY2goKHJvdykgPT4ge1xyXG4gICAgICAgIGdyaWQuY3JlYXRlRGl2KHtcclxuICAgICAgICAgIGNsczogXCJyb3V0aW5lLXN0YXRzLWNlbGwgcm91dGluZS1zdGF0cy1yb3dsYWJlbFwiLFxyXG4gICAgICAgICAgdGV4dDogcm93Lm5hbWUsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgLy8gbGVuZ3RoIG9mIHRoZSBjb25zZWN1dGl2ZSBydW4gb2YgY29tcGxldGVkIGRheXMgZW5kaW5nIGF0IGVhY2ggaW5kZXhcclxuICAgICAgICBjb25zdCBydW5MZW46IG51bWJlcltdID0gW107XHJcbiAgICAgICAgcm93LmZsYWdzLmZvckVhY2goKGRvbmUsIGRpKSA9PiB7XHJcbiAgICAgICAgICBydW5MZW5bZGldID0gZG9uZSA/IChkaSA+IDAgPyBydW5MZW5bZGkgLSAxXSA6IDApICsgMSA6IDA7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgcm93LmZsYWdzLmZvckVhY2goKGRvbmUsIGRpKSA9PiB7XHJcbiAgICAgICAgICBpZiAoZGkgJSA3ID09PSAwICYmIGRpICE9PSAwKVxyXG4gICAgICAgICAgICBncmlkLmNyZWF0ZURpdih7IGNsczogXCJyb3V0aW5lLXN0YXRzLXNwYWNlclwiIH0pO1xyXG4gICAgICAgICAgY29uc3QgY2VsbCA9IGdyaWQuY3JlYXRlRGl2KHtcclxuICAgICAgICAgICAgY2xzOiBcInJvdXRpbmUtc3RhdHMtY2VsbCByb3V0aW5lLXN0YXRzLWRheSBpcy1jbGlja2FibGVcIixcclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgY2VsbC50b2dnbGVDbGFzcyhcImlzLWRvbmVcIiwgZG9uZSk7XHJcbiAgICAgICAgICBpZiAoZGkgPT09IGRheXMgLSAxKSBjZWxsLmFkZENsYXNzKFwiaXMtdG9kYXktY29sXCIpO1xyXG5cclxuICAgICAgICAgIC8vIHN0cmVha3M6IGpvaW4gbmVpZ2hib3VyaW5nIGNvbXBsZXRlZCBkYXlzIGFuZCBsYWJlbCB0aGUgcnVuJ3MgZW5kXHJcbiAgICAgICAgICBjb25zdCBwcmV2RG9uZSA9IGRpID4gMCAmJiByb3cuZmxhZ3NbZGkgLSAxXSA9PT0gdHJ1ZTtcclxuICAgICAgICAgIGNvbnN0IG5leHREb25lID0gcm93LmZsYWdzW2RpICsgMV0gPT09IHRydWU7XHJcbiAgICAgICAgICBjb25zdCBpc1J1bkVuZCA9IGRvbmUgJiYgIW5leHREb25lO1xyXG4gICAgICAgICAgY29uc3Qgc3RyZWFrID0gcnVuTGVuW2RpXTtcclxuICAgICAgICAgIGlmIChkb25lICYmIChwcmV2RG9uZSB8fCBuZXh0RG9uZSkpIGNlbGwuYWRkQ2xhc3MoXCJpcy1ydW5cIik7XHJcbiAgICAgICAgICBpZiAoZG9uZSAmJiBwcmV2RG9uZSkgY2VsbC5hZGRDbGFzcyhcImlzLXJ1bi1jb250XCIpO1xyXG4gICAgICAgICAgaWYgKGRvbmUgJiYgbmV4dERvbmUpIHtcclxuICAgICAgICAgICAgY2VsbC5hZGRDbGFzcyhcImlzLXJ1bi1saW5rXCIpO1xyXG4gICAgICAgICAgICAvLyBhIHdlZWsgc3BhY2VyIGNvbHVtbiBzaXRzIGJldHdlZW4gdGhlc2UgdHdvIGNlbGxzXHJcbiAgICAgICAgICAgIGlmICgoZGkgKyAxKSAlIDcgPT09IDApIGNlbGwuYWRkQ2xhc3MoXCJpcy13ZWVrLWJyaWRnZVwiKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGlmIChpc1J1bkVuZCAmJiBzdHJlYWsgPiAxKSB7XHJcbiAgICAgICAgICAgIGNlbGwuYWRkQ2xhc3MoXCJpcy1ydW4tZW5kXCIpO1xyXG4gICAgICAgICAgICBjZWxsLmNyZWF0ZVNwYW4oe1xyXG4gICAgICAgICAgICAgIGNsczogXCJyb3V0aW5lLXN0YXRzLXJ1bi1jb3VudFwiLFxyXG4gICAgICAgICAgICAgIHRleHQ6IFN0cmluZyhzdHJlYWspLFxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgY2VsbC5zZXRBdHRyKFwiZGF0YS1zdHJlYWtcIiwgU3RyaW5nKHN0cmVhaykpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgY29uc3QgZHMgPSBkYXRlU3Ryc1tkaV07XHJcbiAgICAgICAgICBjZWxsLnNldEF0dHIoXHJcbiAgICAgICAgICAgIFwiYXJpYS1sYWJlbFwiLFxyXG4gICAgICAgICAgICBpc1J1bkVuZCAmJiBzdHJlYWsgPiAxXHJcbiAgICAgICAgICAgICAgPyBgJHtyb3cubmFtZX0gXHUwMEI3ICR7ZHN9IFx1MDBCNyAke3N0cmVha30gZGF5IHN0cmVha2BcclxuICAgICAgICAgICAgICA6IGAke3Jvdy5uYW1lfSBcdTAwQjcgJHtkc31gXHJcbiAgICAgICAgICApO1xyXG4gICAgICAgICAgY2VsbC5zZXRBdHRyKFwicm9sZVwiLCBcImJ1dHRvblwiKTtcclxuICAgICAgICAgIGNlbGwudGFiSW5kZXggPSAwO1xyXG5cclxuICAgICAgICAgIGNvbnN0IHRvZ2dsZSA9IGFzeW5jICgpID0+IHtcclxuICAgICAgICAgICAgaWYgKGNlbGwuaGFzQ2xhc3MoXCJpcy1idXN5XCIpKSByZXR1cm47XHJcbiAgICAgICAgICAgIGNlbGwuYWRkQ2xhc3MoXCJpcy1idXN5XCIpO1xyXG4gICAgICAgICAgICBjb25zdCB0YXJnZXQgPSAhY2VsbC5oYXNDbGFzcyhcImlzLWRvbmVcIik7XHJcbiAgICAgICAgICAgIC8vIG9wdGltaXN0aWMgVUkgc28gdGhlIGNsaWNrZWQgY2VsbCByZWZsZWN0cyB0aGUgY2hhbmdlIGluc3RhbnRseVxyXG4gICAgICAgICAgICBjZWxsLnRvZ2dsZUNsYXNzKFwiaXMtZG9uZVwiLCB0YXJnZXQpO1xyXG4gICAgICAgICAgICBjZWxsLnRvZ2dsZUNsYXNzKFwiaXMtbWlzc2VkXCIsICF0YXJnZXQpO1xyXG4gICAgICAgICAgICAvLyBzdHJlYWsgam9pbnMgYXJlIHJlY29tcHV0ZWQgb24gcmUtcmVuZGVyOyBkcm9wIHRoZSBzdGFsZSBvbmVzIG5vd1xyXG4gICAgICAgICAgICBjZWxsLmVtcHR5KCk7XHJcbiAgICAgICAgICAgIGZvciAoY29uc3QgYyBvZiBbXHJcbiAgICAgICAgICAgICAgXCJpcy1ydW5cIixcclxuICAgICAgICAgICAgICBcImlzLXJ1bi1jb250XCIsXHJcbiAgICAgICAgICAgICAgXCJpcy1ydW4tbGlua1wiLFxyXG4gICAgICAgICAgICAgIFwiaXMtcnVuLWVuZFwiLFxyXG4gICAgICAgICAgICAgIFwiaXMtd2Vlay1icmlkZ2VcIixcclxuICAgICAgICAgICAgXSlcclxuICAgICAgICAgICAgICBjZWxsLnJlbW92ZUNsYXNzKGMpO1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgIGNvbnN0IHN1YnRhc2tzID0gdGhpcy5nZXRTdWJ0YXNrcyhyb3cuZmlsZSk7XHJcbiAgICAgICAgICAgICAgaWYgKHN1YnRhc2tzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuc2V0UGFyZW50VG9nZ2xlQWxsKHJvdy5maWxlLCBkcywgdGFyZ2V0LCBzdWJ0YXNrcyk7XHJcbiAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuc2V0RW50cnkocm93LmZpbGUsIGRzLCB0YXJnZXQpO1xyXG4gICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICB0aGlzLmVtaXRSb3V0aW5lQ2hhbmdlKHtcclxuICAgICAgICAgICAgICAgIGRhdGVTdHI6IGRzLFxyXG4gICAgICAgICAgICAgICAgcGF0aDogcm93LmZpbGUucGF0aCxcclxuICAgICAgICAgICAgICAgIHN1YnRhc2s6IG51bGwsXHJcbiAgICAgICAgICAgICAgICBjaGVja2VkOiB0YXJnZXQsXHJcbiAgICAgICAgICAgICAgICBwYXJlbnRDaGVja2VkOiB0YXJnZXQsXHJcbiAgICAgICAgICAgICAgICBzdWJ0YXNrcyxcclxuICAgICAgICAgICAgICAgIG9yaWdpbklkOiBibG9ja0lkLFxyXG4gICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgIHRoaXMuc2V0RW50cnlPdmVycmlkZShcclxuICAgICAgICAgICAgICAgIGVudHJ5T3ZlcnJpZGVzLFxyXG4gICAgICAgICAgICAgICAgcm93LmZpbGUucGF0aCxcclxuICAgICAgICAgICAgICAgIGRzLFxyXG4gICAgICAgICAgICAgICAgdGFyZ2V0XHJcbiAgICAgICAgICAgICAgKTtcclxuICAgICAgICAgICAgICB0aGlzLnJlbmRlclN0YXRzQm9hcmRzKFxyXG4gICAgICAgICAgICAgICAgaG9zdCxcclxuICAgICAgICAgICAgICAgIHJvb3QsXHJcbiAgICAgICAgICAgICAgICBkYXlzLFxyXG4gICAgICAgICAgICAgICAgYmxvY2tJZCxcclxuICAgICAgICAgICAgICAgIGVudHJ5T3ZlcnJpZGVzXHJcbiAgICAgICAgICAgICAgKTtcclxuICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXCJGb2xkZXIgUm91dGluZXM6IGZhaWxlZCB0byB1cGRhdGUgZW50cnlcIiwgZSk7XHJcbiAgICAgICAgICAgICAgbmV3IE5vdGljZShgRm9sZGVyIFJvdXRpbmVzOiBmYWlsZWQgdG8gdXBkYXRlICR7cm93LmZpbGUuYmFzZW5hbWV9YCk7XHJcbiAgICAgICAgICAgICAgY2VsbC50b2dnbGVDbGFzcyhcImlzLWRvbmVcIiwgIXRhcmdldCk7XHJcbiAgICAgICAgICAgICAgY2VsbC50b2dnbGVDbGFzcyhcImlzLW1pc3NlZFwiLCB0YXJnZXQpO1xyXG4gICAgICAgICAgICAgIGNlbGwucmVtb3ZlQ2xhc3MoXCJpcy1idXN5XCIpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9O1xyXG4gICAgICAgICAgLy8gVGFwIGRldGVjdGlvbjogb25seSB0b2dnbGUgaWYgdGhlIHBvaW50ZXIgYmFyZWx5IG1vdmVkIGJldHdlZW5cclxuICAgICAgICAgIC8vIGRvd24gYW5kIHVwLCBzbyB2ZXJ0aWNhbC9ob3Jpem9udGFsIHNjcm9sbGluZyBpc24ndCBoaWphY2tlZC5cclxuICAgICAgICAgIGxldCBzdGFydFggPSAwO1xyXG4gICAgICAgICAgbGV0IHN0YXJ0WSA9IDA7XHJcbiAgICAgICAgICBsZXQgdHJhY2tpbmcgPSBmYWxzZTtcclxuICAgICAgICAgIGNvbnN0IE1PVkVfVE9MRVJBTkNFID0gMTA7XHJcbiAgICAgICAgICBjZWxsLmFkZEV2ZW50TGlzdGVuZXIoXCJwb2ludGVyZG93blwiLCAoZXZ0OiBQb2ludGVyRXZlbnQpID0+IHtcclxuICAgICAgICAgICAgdHJhY2tpbmcgPSB0cnVlO1xyXG4gICAgICAgICAgICBzdGFydFggPSBldnQuY2xpZW50WDtcclxuICAgICAgICAgICAgc3RhcnRZID0gZXZ0LmNsaWVudFk7XHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICAgIGNlbGwuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJtb3ZlXCIsIChldnQ6IFBvaW50ZXJFdmVudCkgPT4ge1xyXG4gICAgICAgICAgICBpZiAoIXRyYWNraW5nKSByZXR1cm47XHJcbiAgICAgICAgICAgIGlmIChcclxuICAgICAgICAgICAgICBNYXRoLmFicyhldnQuY2xpZW50WCAtIHN0YXJ0WCkgPiBNT1ZFX1RPTEVSQU5DRSB8fFxyXG4gICAgICAgICAgICAgIE1hdGguYWJzKGV2dC5jbGllbnRZIC0gc3RhcnRZKSA+IE1PVkVfVE9MRVJBTkNFXHJcbiAgICAgICAgICAgICkge1xyXG4gICAgICAgICAgICAgIHRyYWNraW5nID0gZmFsc2U7IC8vIHRyZWF0IGFzIGEgc2Nyb2xsL2RyYWcsIG5vdCBhIHRhcFxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICAgIGNlbGwuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJ1cFwiLCAoZXZ0OiBQb2ludGVyRXZlbnQpID0+IHtcclxuICAgICAgICAgICAgaWYgKCF0cmFja2luZykgcmV0dXJuO1xyXG4gICAgICAgICAgICB0cmFja2luZyA9IGZhbHNlO1xyXG4gICAgICAgICAgICBpZiAoXHJcbiAgICAgICAgICAgICAgTWF0aC5hYnMoZXZ0LmNsaWVudFggLSBzdGFydFgpIDw9IE1PVkVfVE9MRVJBTkNFICYmXHJcbiAgICAgICAgICAgICAgTWF0aC5hYnMoZXZ0LmNsaWVudFkgLSBzdGFydFkpIDw9IE1PVkVfVE9MRVJBTkNFXHJcbiAgICAgICAgICAgICkge1xyXG4gICAgICAgICAgICAgIHRvZ2dsZSgpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICAgIGNlbGwuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJjYW5jZWxcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICB0cmFja2luZyA9IGZhbHNlO1xyXG4gICAgICAgICAgfSk7XHJcbiAgICAgICAgICBjZWxsLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIChldnQ6IEtleWJvYXJkRXZlbnQpID0+IHtcclxuICAgICAgICAgICAgaWYgKGV2dC5rZXkgPT09IFwiRW50ZXJcIiB8fCBldnQua2V5ID09PSBcIiBcIikge1xyXG4gICAgICAgICAgICAgIGV2dC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICAgICAgICAgIHRvZ2dsZSgpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICB9KTtcclxuICAgICAgICBncmlkLmNyZWF0ZURpdih7XHJcbiAgICAgICAgICBjbHM6IFwicm91dGluZS1zdGF0cy1jZWxsIHJvdXRpbmUtc3RhdHMtcm93dG90YWxcIixcclxuICAgICAgICAgIHRleHQ6IGAke3Jvdy5kb25lfS8ke2RheXN9YCxcclxuICAgICAgICB9KTtcclxuICAgICAgfSk7XHJcblxyXG4gICAgICAvLyBzdGFydCBzY3JvbGxlZCB0byB0aGUgZmFyIHJpZ2h0IChtb3N0IHJlY2VudCBkYXlzIC8gdG9kYXkpXHJcbiAgICAgIGdyaWQuc2Nyb2xsTGVmdCA9IGdyaWQuc2Nyb2xsV2lkdGg7XHJcblxyXG4gICAgICAvKiAtLS0tIHdlZWtseSBtaWxlc3RvbmVzIC0tLS0gKi9cclxuICAgICAgY29uc3QgbWlsZXN0b25lcyA9IGJvYXJkLmNyZWF0ZURpdih7IGNsczogXCJyb3V0aW5lLXN0YXRzLXdlZWtzXCIgfSk7XHJcbiAgICAgIGZvciAobGV0IHcgPSAwOyB3IDwgd2Vla3M7IHcrKykge1xyXG4gICAgICAgIGNvbnN0IHN0YXJ0ID0gdyAqIDc7XHJcbiAgICAgICAgY29uc3QgZW5kID0gTWF0aC5taW4oc3RhcnQgKyA3LCBkYXlzKTtcclxuICAgICAgICBjb25zdCBzcGFuID0gZW5kIC0gc3RhcnQ7XHJcbiAgICAgICAgY29uc3QgY2VsbHNJbldlZWsgPSBzcGFuICogc2VjdGlvbi5maWxlcy5sZW5ndGggfHwgMTtcclxuICAgICAgICBsZXQgd2Vla0RvbmUgPSAwO1xyXG4gICAgICAgIGZvciAobGV0IGRpID0gc3RhcnQ7IGRpIDwgZW5kOyBkaSsrKSB3ZWVrRG9uZSArPSBwZXJEYXlbZGldO1xyXG4gICAgICAgIGNvbnN0IHdwY3QgPSBNYXRoLnJvdW5kKCh3ZWVrRG9uZSAvIGNlbGxzSW5XZWVrKSAqIDEwMCk7XHJcbiAgICAgICAgY29uc3Qgc3RhcnMgPSBNYXRoLm1heCgwLCBNYXRoLm1pbig1LCBNYXRoLnJvdW5kKHdwY3QgLyAyMCkpKTtcclxuICAgICAgICBjb25zdCB3cmFuayA9IHRoaXMucmFua0Zvcih3cGN0KTtcclxuICAgICAgICBjb25zdCBjaGlwID0gbWlsZXN0b25lcy5jcmVhdGVEaXYoeyBjbHM6IFwicm91dGluZS1zdGF0cy13ZWVrLWNoaXBcIiB9KTtcclxuICAgICAgICBjaGlwLnRvZ2dsZUNsYXNzKFwiaXMtcGVyZmVjdFwiLCB3cGN0ID09PSAxMDApO1xyXG4gICAgICAgIGNoaXAuY3JlYXRlU3Bhbih7XHJcbiAgICAgICAgICBjbHM6IFwicm91dGluZS1zdGF0cy13ZWVrLW5hbWVcIixcclxuICAgICAgICAgIHRleHQ6IGBXSyAke3cgKyAxfWAsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgY2hpcC5jcmVhdGVTcGFuKHtcclxuICAgICAgICAgIGNsczogXCJyb3V0aW5lLXN0YXRzLXdlZWstc3RhcnNcIixcclxuICAgICAgICAgIHRleHQ6IFwiXHUyNjA1XCIucmVwZWF0KHN0YXJzKSArIFwiXHUyNjA2XCIucmVwZWF0KDUgLSBzdGFycyksXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgY2hpcC5jcmVhdGVTcGFuKHtcclxuICAgICAgICAgIGNsczogXCJyb3V0aW5lLXN0YXRzLXdlZWstcmFua1wiLFxyXG4gICAgICAgICAgdGV4dDogd3BjdCA9PT0gMTAwID8gXCJQRVJGRUNUXCIgOiB3cmFuayxcclxuICAgICAgICB9KTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLyogLS0tLSBzcGFya2xpbmUgdHJlbmQgLS0tLSAqL1xyXG4gICAgICBjb25zdCB0cmVuZCA9IGJvYXJkLmNyZWF0ZURpdih7IGNsczogXCJyb3V0aW5lLXN0YXRzLXRyZW5kXCIgfSk7XHJcbiAgICAgIHRyZW5kLmNyZWF0ZVNwYW4oeyBjbHM6IFwicm91dGluZS1zdGF0cy10cmVuZC1sYWJlbFwiLCB0ZXh0OiBcIlRSRU5EXCIgfSk7XHJcbiAgICAgIHRyZW5kLmNyZWF0ZVNwYW4oe1xyXG4gICAgICAgIGNsczogXCJyb3V0aW5lLXN0YXRzLXRyZW5kLXNwYXJrXCIsXHJcbiAgICAgICAgdGV4dDogdGhpcy5zcGFya2xpbmUocGVyRGF5LCBzZWN0aW9uLmZpbGVzLmxlbmd0aCksXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgLyogLS0tLSBmb290ZXIgc3RhdHMgZ3JpZCAtLS0tICovXHJcbiAgICAgIGNvbnN0IGZvb3RlciA9IGJvYXJkLmNyZWF0ZURpdih7IGNsczogXCJyb3V0aW5lLXN0YXRzLWZvb3RlclwiIH0pO1xyXG4gICAgICBjb25zdCBmc3RhdCA9IChsYWJlbDogc3RyaW5nLCB2YWx1ZTogc3RyaW5nKSA9PiB7XHJcbiAgICAgICAgY29uc3QgZiA9IGZvb3Rlci5jcmVhdGVEaXYoeyBjbHM6IFwicm91dGluZS1zdGF0cy1mc3RhdFwiIH0pO1xyXG4gICAgICAgIGYuY3JlYXRlU3Bhbih7IGNsczogXCJyb3V0aW5lLXN0YXRzLWZzdGF0LXZhbHVlXCIsIHRleHQ6IHZhbHVlIH0pO1xyXG4gICAgICAgIGYuY3JlYXRlU3Bhbih7IGNsczogXCJyb3V0aW5lLXN0YXRzLWZzdGF0LWxhYmVsXCIsIHRleHQ6IGxhYmVsIH0pO1xyXG4gICAgICB9O1xyXG4gICAgICBmc3RhdChcIkJFU1QgU1RSRUFLXCIsIGAke2Jlc3RTdHJlYWt9ZGApO1xyXG4gICAgICBmc3RhdChcIlNVQ0NFU1NcIiwgYCR7cGN0fSVgKTtcclxuICAgICAgZnN0YXQoXCJNSVNTRURcIiwgYCR7bWlzc2VkfWApO1xyXG4gICAgICBmc3RhdChcIlhQIEdBSU5FRFwiLCBgKyR7eHB9YCk7XHJcblxyXG4gICAgICAvKiAtLS0tIGFjaGlldmVtZW50cyAtLS0tICovXHJcbiAgICAgIGNvbnN0IGFjaGlldmVtZW50czogeyBpY29uOiBzdHJpbmc7IHRleHQ6IHN0cmluZyB9W10gPSBbXTtcclxuICAgICAgaWYgKHNlY3Rpb25Eb25lID4gMClcclxuICAgICAgICBhY2hpZXZlbWVudHMucHVzaCh7IGljb246IFwiXHUyQjUwXCIsIHRleHQ6IFwiRmlyc3QgQ2xlYXJcIiB9KTtcclxuICAgICAgaWYgKGN1clN0cmVhayA+PSA3IHx8IGJlc3RTdHJlYWsgPj0gNylcclxuICAgICAgICBhY2hpZXZlbWVudHMucHVzaCh7IGljb246IFwiXHUyNkExXCIsIHRleHQ6IFwiNy1EYXkgU3RyZWFrXCIgfSk7XHJcbiAgICAgIGlmIChwZXJmZWN0RGF5LnNvbWUoKHApID0+IHApKVxyXG4gICAgICAgIGFjaGlldmVtZW50cy5wdXNoKHsgaWNvbjogXCJcdUQ4M0NcdURGQzZcIiwgdGV4dDogXCJQZXJmZWN0IERheVwiIH0pO1xyXG4gICAgICBpZiAocGVyZmVjdERheS5zbGljZSgtNykuZXZlcnkoKHApID0+IHApICYmIGRheXMgPj0gNylcclxuICAgICAgICBhY2hpZXZlbWVudHMucHVzaCh7IGljb246IFwiXHVEODNEXHVEQzUxXCIsIHRleHQ6IFwiUGVyZmVjdCBXZWVrXCIgfSk7XHJcbiAgICAgIGlmIChwY3QgPT09IDEwMClcclxuICAgICAgICBhY2hpZXZlbWVudHMucHVzaCh7IGljb246IFwiXHVEODNEXHVEQzhFXCIsIHRleHQ6IFwiMTAwJSBDb21wbGV0ZVwiIH0pO1xyXG4gICAgICBpZiAoYWNoaWV2ZW1lbnRzLmxlbmd0aCkge1xyXG4gICAgICAgIGNvbnN0IGFjaCA9IGJvYXJkLmNyZWF0ZURpdih7IGNsczogXCJyb3V0aW5lLXN0YXRzLWFjaGlldmVtZW50c1wiIH0pO1xyXG4gICAgICAgIGFjaGlldmVtZW50cy5mb3JFYWNoKChhKSA9PiB7XHJcbiAgICAgICAgICBjb25zdCBiYWRnZSA9IGFjaC5jcmVhdGVEaXYoeyBjbHM6IFwicm91dGluZS1zdGF0cy1iYWRnZVwiIH0pO1xyXG4gICAgICAgICAgYmFkZ2UuY3JlYXRlU3Bhbih7IGNsczogXCJyb3V0aW5lLXN0YXRzLWJhZGdlLWljb25cIiwgdGV4dDogYS5pY29uIH0pO1xyXG4gICAgICAgICAgYmFkZ2UuY3JlYXRlU3Bhbih7IGNsczogXCJyb3V0aW5lLXN0YXRzLWJhZGdlLXRleHRcIiwgdGV4dDogYS50ZXh0IH0pO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvKiAtLS0tIGxlZ2VuZCAtLS0tICovXHJcbiAgICAgIGNvbnN0IGxlZ2VuZCA9IGJvYXJkLmNyZWF0ZURpdih7IGNsczogXCJyb3V0aW5lLXN0YXRzLWxlZ2VuZFwiIH0pO1xyXG4gICAgICBjb25zdCBsZWcgPSAoY2xzOiBzdHJpbmcsIHRleHQ6IHN0cmluZykgPT4ge1xyXG4gICAgICAgIGNvbnN0IGwgPSBsZWdlbmQuY3JlYXRlRGl2KHsgY2xzOiBcInJvdXRpbmUtc3RhdHMtbGVnZW5kLWl0ZW1cIiB9KTtcclxuICAgICAgICBsLmNyZWF0ZVNwYW4oeyBjbHM6IGByb3V0aW5lLXN0YXRzLWxlZ2VuZC1zd2F0Y2ggJHtjbHN9YCB9KTtcclxuICAgICAgICBsLmNyZWF0ZVNwYW4oeyB0ZXh0IH0pO1xyXG4gICAgICB9O1xyXG4gICAgICBsZWcoXCJpcy1kb25lXCIsIFwiRG9uZVwiKTtcclxuICAgICAgbGVnKFwiaXMtbWlzc2VkXCIsIFwiTWlzc2VkXCIpO1xyXG4gICAgICBsZWcoXCJpcy10b2RheVwiLCBcIlRvZGF5XCIpO1xyXG4gICAgICBsZWcoXCJpcy1wZXJmZWN0XCIsIFwiUGVyZmVjdFwiKTtcclxuICAgIH0pO1xyXG4gIH1cclxufVxyXG5cclxuY2xhc3MgUmVzZXRUcmFja2luZ0RhdGFNb2RhbCBleHRlbmRzIE1vZGFsIHtcclxuICBwcml2YXRlIHBsdWdpbjogRm9sZGVyUm91dGluZXNQbHVnaW47XHJcblxyXG4gIGNvbnN0cnVjdG9yKGFwcDogQXBwLCBwbHVnaW46IEZvbGRlclJvdXRpbmVzUGx1Z2luKSB7XHJcbiAgICBzdXBlcihhcHApO1xyXG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XHJcbiAgfVxyXG5cclxuICBvbk9wZW4oKTogdm9pZCB7XHJcbiAgICB0aGlzLnNldFRpdGxlKFwiUmVzZXQgYWxsIHRyYWNraW5nIGRhdGE/XCIpO1xyXG4gICAgdGhpcy5jb250ZW50RWwuY3JlYXRlRWwoXCJwXCIsIHtcclxuICAgICAgdGV4dDogXCJUaGlzIHBlcm1hbmVudGx5IHJlbW92ZXMgYWxsIGNvbXBsZXRpb24gaGlzdG9yeSwgc3VidGFzayBjb21wbGV0aW9uIGhpc3RvcnksIHNhdmVkIGNhbGVuZGFyIHBsYW5zLCBvbmUtb2ZmIGNhbGVuZGFyIHRhc2tzLCBhbmQgY3VzdG9tIGNhbGVuZGFyIHRpbWVzIGZyb20gZXZlcnkgTWFya2Rvd24gZmlsZSBpbiB0aGlzIHZhdWx0LlwiLFxyXG4gICAgfSk7XHJcbiAgICB0aGlzLmNvbnRlbnRFbC5jcmVhdGVFbChcInBcIiwge1xyXG4gICAgICB0ZXh0OiBcIkhhYml0IGRlZmluaXRpb25zLCBub3RlIGNvbnRlbnQsIGFuZCBwbHVnaW4gc2V0dGluZ3MgYXJlIGtlcHQuIFRoaXMgY2Fubm90IGJlIHVuZG9uZS5cIixcclxuICAgIH0pO1xyXG5cclxuICAgIGxldCBjYW5jZWxCdXR0b246IEhUTUxCdXR0b25FbGVtZW50IHwgbnVsbCA9IG51bGw7XHJcbiAgICBuZXcgU2V0dGluZyh0aGlzLmNvbnRlbnRFbClcclxuICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PiB7XHJcbiAgICAgICAgY2FuY2VsQnV0dG9uID0gYnV0dG9uLmJ1dHRvbkVsO1xyXG4gICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KFwiQ2FuY2VsXCIpLm9uQ2xpY2soKCkgPT4gdGhpcy5jbG9zZSgpKTtcclxuICAgICAgfSlcclxuICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxyXG4gICAgICAgIGJ1dHRvblxyXG4gICAgICAgICAgLnNldEJ1dHRvblRleHQoXCJSZXNldCB0cmFja2luZyBkYXRhXCIpXHJcbiAgICAgICAgICAuc2V0V2FybmluZygpXHJcbiAgICAgICAgICAub25DbGljayhhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgICAgIGJ1dHRvbi5zZXREaXNhYmxlZCh0cnVlKS5zZXRCdXR0b25UZXh0KFwiUmVzZXR0aW5nLi4uXCIpO1xyXG4gICAgICAgICAgICBpZiAoY2FuY2VsQnV0dG9uKSBjYW5jZWxCdXR0b24uZGlzYWJsZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucGx1Z2luLnJlc2V0VHJhY2tpbmdEYXRhKCk7XHJcbiAgICAgICAgICAgICAgdGhpcy5jbG9zZSgpO1xyXG4gICAgICAgICAgICAgIGlmIChyZXN1bHQuZmFpbGVkRmlsZXMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgICAgICAgbmV3IE5vdGljZShcclxuICAgICAgICAgICAgICAgICAgYEZvbGRlciBSb3V0aW5lczogY2xlYXJlZCAke3Jlc3VsdC5wcm9wZXJ0aWVzQ2xlYXJlZH0gcHJvcGVydGllcyBmcm9tICR7cmVzdWx0LmZpbGVzQ2xlYXJlZH0gZmlsZXM7ICR7cmVzdWx0LmZhaWxlZEZpbGVzLmxlbmd0aH0gZmlsZXMgY291bGQgbm90IGJlIHVwZGF0ZWQuIFNlZSB0aGUgZGV2ZWxvcGVyIGNvbnNvbGUuYFxyXG4gICAgICAgICAgICAgICAgKTtcclxuICAgICAgICAgICAgICB9IGVsc2UgaWYgKHJlc3VsdC5maWxlc0NsZWFyZWQgPT09IDApIHtcclxuICAgICAgICAgICAgICAgIG5ldyBOb3RpY2UoXCJGb2xkZXIgUm91dGluZXM6IG5vIHRyYWNraW5nIGRhdGEgZm91bmQuXCIpO1xyXG4gICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBuZXcgTm90aWNlKFxyXG4gICAgICAgICAgICAgICAgICBgRm9sZGVyIFJvdXRpbmVzOiBjbGVhcmVkICR7cmVzdWx0LnByb3BlcnRpZXNDbGVhcmVkfSBwcm9wZXJ0aWVzIGZyb20gJHtyZXN1bHQuZmlsZXNDbGVhcmVkfSBmaWxlcy4gUmVvcGVuIGFmZmVjdGVkIG5vdGVzIHRvIHJlZnJlc2ggdGhlaXIgdmlld3MuYFxyXG4gICAgICAgICAgICAgICAgKTtcclxuICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihcIkZvbGRlciBSb3V0aW5lczogZmFpbGVkIHRvIHJlc2V0IHRyYWNraW5nIGRhdGFcIiwgZXJyb3IpO1xyXG4gICAgICAgICAgICAgIG5ldyBOb3RpY2UoXCJGb2xkZXIgUm91dGluZXM6IGZhaWxlZCB0byByZXNldCB0cmFja2luZyBkYXRhLlwiKTtcclxuICAgICAgICAgICAgICBidXR0b24uc2V0RGlzYWJsZWQoZmFsc2UpLnNldEJ1dHRvblRleHQoXCJSZXNldCB0cmFja2luZyBkYXRhXCIpO1xyXG4gICAgICAgICAgICAgIGlmIChjYW5jZWxCdXR0b24pIGNhbmNlbEJ1dHRvbi5kaXNhYmxlZCA9IGZhbHNlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9KVxyXG4gICAgICApO1xyXG4gIH1cclxuXHJcbiAgb25DbG9zZSgpOiB2b2lkIHtcclxuICAgIHRoaXMuY29udGVudEVsLmVtcHR5KCk7XHJcbiAgfVxyXG59XHJcblxyXG5jbGFzcyBGb2xkZXJSb3V0aW5lc1NldHRpbmdUYWIgZXh0ZW5kcyBQbHVnaW5TZXR0aW5nVGFiIHtcclxuICBwbHVnaW46IEZvbGRlclJvdXRpbmVzUGx1Z2luO1xyXG5cclxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgcGx1Z2luOiBGb2xkZXJSb3V0aW5lc1BsdWdpbikge1xyXG4gICAgc3VwZXIoYXBwLCBwbHVnaW4pO1xyXG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XHJcbiAgfVxyXG5cclxuICBkaXNwbGF5KCk6IHZvaWQge1xyXG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcclxuICAgIGNvbnRhaW5lckVsLmVtcHR5KCk7XHJcblxyXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXHJcbiAgICAgIC5zZXROYW1lKFwiUm91dGluZXMgZm9sZGVyXCIpXHJcbiAgICAgIC5zZXREZXNjKFwiRm9sZGVyIGhvbGRpbmcgeW91ciByb3V0aW5lIG5vdGVzLlwiKVxyXG4gICAgICAuYWRkRHJvcGRvd24oKGRyb3ApID0+IHtcclxuICAgICAgICBjb25zdCBjdXJyZW50ID0gdGhpcy5wbHVnaW4uc2V0dGluZ3Mucm91dGluZXNGb2xkZXI7XHJcbiAgICAgICAgY29uc3QgZm9sZGVycyA9IHRoaXMucGx1Z2luLmFsbEZvbGRlclBhdGhzKCk7XHJcbiAgICAgICAgLy8gQSBmb2xkZXIgdGhhdCBoYXMgc2luY2UgYmVlbiByZW5hbWVkIG9yIGRlbGV0ZWQgc3RpbGwgZ2V0cyBhbiBlbnRyeSxcclxuICAgICAgICAvLyBzbyB0aGUgcGlja2VyIHNob3dzIHdoYXQgaXMgc3RvcmVkIGluc3RlYWQgb2YgYSBkaWZmZXJlbnQgZm9sZGVyLlxyXG4gICAgICAgIGlmICghZm9sZGVycy5pbmNsdWRlcyhjdXJyZW50KSlcclxuICAgICAgICAgIGRyb3AuYWRkT3B0aW9uKFxyXG4gICAgICAgICAgICBjdXJyZW50LFxyXG4gICAgICAgICAgICBjdXJyZW50ID09PSBcIlwiID8gXCIobm9uZSBzZWxlY3RlZClcIiA6IGAke2N1cnJlbnR9IChub3QgZm91bmQpYFxyXG4gICAgICAgICAgKTtcclxuICAgICAgICBmb3IgKGNvbnN0IHBhdGggb2YgZm9sZGVycylcclxuICAgICAgICAgIGRyb3AuYWRkT3B0aW9uKHBhdGgsIHBhdGggPT09IFwiL1wiID8gXCIvICh2YXVsdCByb290KVwiIDogcGF0aCk7XHJcbiAgICAgICAgZHJvcC5zZXRWYWx1ZShjdXJyZW50KS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcclxuICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnJvdXRpbmVzRm9sZGVyID0gdmFsdWU7XHJcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICB9KTtcclxuICAgICAgfSk7XHJcblxyXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXHJcbiAgICAgIC5zZXROYW1lKFwiSGlkZSByb3V0aW5lIG51bWJlcmluZ1wiKVxyXG4gICAgICAuc2V0RGVzYyhcclxuICAgICAgICBcIkhpZGUgY2hlY2tsaXN0IGluZGljZXMgYW5kIGxlYWRpbmcgZmlsZSBvciBmb2xkZXIgbnVtYmVyaW5nIHN1Y2ggYXMgJzEuIE1lZGl0YXRpb24nIGFjcm9zcyBjaGVja2xpc3RzLCBjYWxlbmRhcnMsIGFuZCBzdGF0cy4gTmFtZXMgb24gZGlzayBhcmUgdW5jaGFuZ2VkOyByZW9wZW4gYWZmZWN0ZWQgbm90ZXMgdG8gYXBwbHkuXCJcclxuICAgICAgKVxyXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XHJcbiAgICAgICAgdG9nZ2xlXHJcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuaGlkZVJvdXRpbmVOdW1iZXJpbmcpXHJcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XHJcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmhpZGVSb3V0aW5lTnVtYmVyaW5nID0gdmFsdWU7XHJcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgICAgfSlcclxuICAgICAgKTtcclxuXHJcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcclxuICAgICAgLnNldE5hbWUoXCJFbnRyaWVzIHByb3BlcnR5XCIpXHJcbiAgICAgIC5zZXREZXNjKFwiRnJvbnRtYXR0ZXIgcHJvcGVydHkgdXBkYXRlZCB3aGVuIGFuIGl0ZW0gaXMgY2hlY2tlZC5cIilcclxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XHJcbiAgICAgICAgdGV4dFxyXG4gICAgICAgICAgLnNldFBsYWNlaG9sZGVyKFwiZW50cmllc1wiKVxyXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmVudHJpZXNQcm9wZXJ0eSlcclxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcclxuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuZW50cmllc1Byb3BlcnR5ID0gdmFsdWUudHJpbSgpIHx8IFwiZW50cmllc1wiO1xyXG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICAgIH0pXHJcbiAgICAgICk7XHJcblxyXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXHJcbiAgICAgIC5zZXROYW1lKFwiU3RvcmVkIGRhdGUgZm9ybWF0XCIpXHJcbiAgICAgIC5zZXREZXNjKFwiTW9tZW50IGZvcm1hdCB1c2VkIGZvciB0aGUgZGF0ZSB3cml0dGVuIGludG8gJ2VudHJpZXMnLlwiKVxyXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cclxuICAgICAgICB0ZXh0XHJcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoXCJZWVlZLU1NLUREXCIpXHJcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3Muc3RvcmVEYXRlRm9ybWF0KVxyXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5zdG9yZURhdGVGb3JtYXQgPSB2YWx1ZS50cmltKCkgfHwgXCJZWVlZLU1NLUREXCI7XHJcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgICAgfSlcclxuICAgICAgKTtcclxuXHJcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcclxuICAgICAgLnNldE5hbWUoXCJTdWJ0YXNrcyBwcm9wZXJ0eVwiKVxyXG4gICAgICAuc2V0RGVzYyhcIkZyb250bWF0dGVyIHByb3BlcnR5IHRoYXQgbGlzdHMgYSBub3RlJ3Mgc3VidGFza3MuXCIpXHJcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxyXG4gICAgICAgIHRleHRcclxuICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcihcInN1YnRhc2tzXCIpXHJcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3Muc3VidGFza3NQcm9wZXJ0eSlcclxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcclxuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Muc3VidGFza3NQcm9wZXJ0eSA9IHZhbHVlLnRyaW0oKSB8fCBcInN1YnRhc2tzXCI7XHJcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgICAgfSlcclxuICAgICAgKTtcclxuXHJcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcclxuICAgICAgLnNldE5hbWUoXCJTdWJ0YXNrIGVudHJpZXMgcHJvcGVydHlcIilcclxuICAgICAgLnNldERlc2MoXCJGcm9udG1hdHRlciBwcm9wZXJ0eSB3aGVyZSBwZXItc3VidGFzayBjb21wbGV0aW9uIGRhdGVzIGFyZSBzdG9yZWQuXCIpXHJcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxyXG4gICAgICAgIHRleHRcclxuICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcihcInN1YnRhc2tFbnRyaWVzXCIpXHJcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3Muc3VidGFza0VudHJpZXNQcm9wZXJ0eSlcclxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcclxuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Muc3VidGFza0VudHJpZXNQcm9wZXJ0eSA9XHJcbiAgICAgICAgICAgICAgdmFsdWUudHJpbSgpIHx8IFwic3VidGFza0VudHJpZXNcIjtcclxuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgICB9KVxyXG4gICAgICApO1xyXG5cclxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxyXG4gICAgICAuc2V0TmFtZShcIlBpeGVsIGNhbGVuZGFyIHByb3BlcnR5XCIpXHJcbiAgICAgIC5zZXREZXNjKFxyXG4gICAgICAgIFwiRnJvbnRtYXR0ZXIgcHJvcGVydHkgb24gdGhlIGRhaWx5IG5vdGUgd2hlcmUgdGhlIHBpeGVsLWNhbGVuZGFyIGRheSBwbGFuIGlzIHN0b3JlZC5cIlxyXG4gICAgICApXHJcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxyXG4gICAgICAgIHRleHRcclxuICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcihcInBpeGVsQ2FsZW5kYXJQbGFuXCIpXHJcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MucGl4ZWxDYWxlbmRhclByb3BlcnR5KVxyXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5waXhlbENhbGVuZGFyUHJvcGVydHkgPVxyXG4gICAgICAgICAgICAgIHZhbHVlLnRyaW0oKSB8fCBcInBpeGVsQ2FsZW5kYXJQbGFuXCI7XHJcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgICAgfSlcclxuICAgICAgKTtcclxuXHJcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcclxuICAgICAgLnNldE5hbWUoXCJQaXhlbCBjYWxlbmRhciB0YXNrcyBwcm9wZXJ0eVwiKVxyXG4gICAgICAuc2V0RGVzYyhcclxuICAgICAgXCJGcm9udG1hdHRlciBwcm9wZXJ0eSBpbiB0aGUgZGFpbHkgbm90ZSB3aGVyZSBvbmUtb2ZmIGNhbGVuZGFyIHRhc2tzIGFyZSBzdG9yZWQuXCJcclxuICAgICAgKVxyXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cclxuICAgICAgdGV4dFxyXG4gICAgICAgIC5zZXRQbGFjZWhvbGRlcihcInBpeGVsQ2FsZW5kYXJUYXNrc1wiKVxyXG4gICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5waXhlbENhbGVuZGFyVGFza3NQcm9wZXJ0eSlcclxuICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XHJcbiAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5waXhlbENhbGVuZGFyVGFza3NQcm9wZXJ0eSA9XHJcbiAgICAgICAgICAgIHZhbHVlLnRyaW0oKSB8fCBcInBpeGVsQ2FsZW5kYXJUYXNrc1wiO1xyXG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgfSlcclxuICAgICAgKTtcclxuXHJcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcclxuICAgICAgLnNldE5hbWUoXCJQaXhlbCBjYWxlbmRhciB0aW1lcyBwcm9wZXJ0eVwiKVxyXG4gICAgICAuc2V0RGVzYyhcclxuICAgICAgICBcIkZyb250bWF0dGVyIHByb3BlcnR5IGluIHRoZSBkYWlseSBub3RlIHdoZXJlIGN1c3RvbSBzdGFydC9maW5pc2ggdGltZXMgYXJlIHN0b3JlZC5cIlxyXG4gICAgICApXHJcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxyXG4gICAgICAgIHRleHRcclxuICAgICAgICAuc2V0UGxhY2Vob2xkZXIoXCJwaXhlbENhbGVuZGFyVGltZXNcIilcclxuICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MucGl4ZWxDYWxlbmRhclRpbWVzUHJvcGVydHkpXHJcbiAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MucGl4ZWxDYWxlbmRhclRpbWVzUHJvcGVydHkgPVxyXG4gICAgICAgICAgICB2YWx1ZS50cmltKCkgfHwgXCJwaXhlbENhbGVuZGFyVGltZXNcIjtcclxuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgIH0pXHJcbiAgICAgICk7XHJcblxyXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXHJcbiAgICAgIC5zZXROYW1lKFwiQ2FsZW5kYXIgc3RhcnQgdGltZVwiKVxyXG4gICAgICAuc2V0RGVzYyhcclxuICAgICAgICBcIkVhcmxpZXN0IHRpbWUgdGhlIGRheSBwbGFuIHNob3dzLiBTbG90cyBiZWZvcmUgaXQgYXJlIGhpZGRlbjsgcmVvcGVuIHRoZSBub3RlIHRvIGFwcGx5LlwiXHJcbiAgICAgIClcclxuICAgICAgLmFkZERyb3Bkb3duKChkcm9wKSA9PiB7XHJcbiAgICAgICAgZm9yIChjb25zdCBrZXkgb2YgYnVpbGRTbG90S2V5cygpKSBkcm9wLmFkZE9wdGlvbihrZXksIGtleSk7XHJcbiAgICAgICAgZHJvcFxyXG4gICAgICAgICAgLnNldFZhbHVlKGZvcm1hdEhNKHRoaXMucGx1Z2luLmNhbGVuZGFyU3RhcnRNaW51dGVzKCkpKVxyXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jYWxlbmRhclN0YXJ0VGltZSA9IHZhbHVlO1xyXG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICAgIH0pO1xyXG4gICAgICB9KTtcclxuXHJcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcclxuICAgICAgLnNldE5hbWUoXCJSZXNldCBhbGwgdHJhY2tpbmcgZGF0YVwiKVxyXG4gICAgICAuc2V0RGVzYyhcclxuICAgICAgICBcIlBlcm1hbmVudGx5IGRlbGV0ZSBjb21wbGV0aW9uIGhpc3RvcnkgYW5kIHNhdmVkIGNhbGVuZGFyIGRhdGEgZnJvbSBldmVyeSBNYXJrZG93biBmaWxlIGluIHRoaXMgdmF1bHQuXCJcclxuICAgICAgKVxyXG4gICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XHJcbiAgICAgICAgYnV0dG9uXHJcbiAgICAgICAgICAuc2V0QnV0dG9uVGV4dChcIlJlc2V0IHRyYWNraW5nIGRhdGFcIilcclxuICAgICAgICAgIC5zZXRXYXJuaW5nKClcclxuICAgICAgICAgIC5vbkNsaWNrKCgpID0+IG5ldyBSZXNldFRyYWNraW5nRGF0YU1vZGFsKHRoaXMuYXBwLCB0aGlzLnBsdWdpbikub3BlbigpKVxyXG4gICAgICApO1xyXG4gIH1cclxufVxyXG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLHNCQWNPO0FBZVAsSUFBTSxtQkFBMkM7QUFBQSxFQUMvQyxnQkFBZ0I7QUFBQSxFQUNoQixzQkFBc0I7QUFBQSxFQUN0QixpQkFBaUI7QUFBQSxFQUNqQixpQkFBaUI7QUFBQSxFQUNqQixrQkFBa0I7QUFBQSxFQUNsQix3QkFBd0I7QUFBQSxFQUN4Qix1QkFBdUI7QUFBQSxFQUN2Qiw0QkFBNEI7QUFBQSxFQUM1Qiw0QkFBNEI7QUFBQSxFQUM1QixtQkFBbUI7QUFDckI7QUFFQSxJQUFNLGVBQWU7QUFFckIsSUFBTSxlQUFlO0FBQ3JCLElBQU0sY0FBYztBQUVwQixJQUFNLGNBQWM7QUFDcEIsSUFBTSxZQUFZO0FBQ2xCLElBQU0sY0FBYyxLQUFLO0FBQ3pCLElBQU0sY0FBYztBQUlwQixJQUFNLG9CQUFvQjtBQTJCMUIsU0FBUyxZQUFZLEdBQW1CO0FBQ3RDLFNBQU8sS0FBSyxJQUFJLEdBQUcsS0FBSyxJQUFJLGFBQWEsS0FBSyxNQUFNLENBQUMsQ0FBQyxDQUFDO0FBQ3pEO0FBRUEsU0FBUyxTQUFTLEtBQXFCO0FBQ3JDLFFBQU0sSUFBSSxZQUFZLEdBQUc7QUFDekIsUUFBTSxJQUFJLEtBQUssTUFBTSxJQUFJ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
