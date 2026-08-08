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
  subtaskEntriesProperty: "subtaskEntries",
  pixelCalendarProperty: "pixelCalendarPlan",
  pixelCalendarTasksProperty: "pixelCalendarTasks",
  pixelCalendarTimesProperty: "pixelCalendarTimes"
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
function slotKeyForMinutes(min) {
  const snapped = Math.floor(Math.min(min, DAY_MINUTES - SLOT_MINUTES) / SLOT_MINUTES) * SLOT_MINUTES;
  return formatHM(Math.max(0, snapped));
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
function buildSlotKeys() {
  const keys = [];
  for (let m = 0; m < 24 * 60; m += SLOT_MINUTES) {
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
      header.createSpan({ cls: "folder-routines-collapse-icon", text: "\u25BC" });
      header.createSpan({ cls: "folder-routines-banner", text: this.getCategoryIcon(sub.name) });
      header.createSpan({ cls: "folder-routines-heading-title", text: sub.name });
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
    for (let i = 0; i < _FolderRoutinesPlugin.PROGRESS_BLOCKS; i++) {
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
    const slotKeys = buildSlotKeys();
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
      const base = file ? file.basename : (path.split("/").pop() ?? path).replace(/\.md$/, "");
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
      window.setTimeout(() => {
        input.focus();
        input.select();
      }, 0);
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
          chip.style.height = `calc(var(--fr-slot-h) * ${(endMin - span.start) / SLOT_MINUTES} - 3px)`;
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
      info.createSpan({ cls: "pixel-calendar-chip-text", text: file.basename });
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
        secHeader.createSpan({ text: sub.name });
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
        for (const ref of plan[key])
          items.push({ ref, span: spanOf(ref, key) });
      }
      items.sort(
        (a, b) => a.span.start - b.span.start || b.span.end - b.span.start - (a.span.end - a.span.start)
      );
      const firstRow = (min) => Math.floor(min / SLOT_MINUTES);
      const lastRow = (min) => Math.floor((min - 1) / SLOT_MINUTES);
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
        const top = rowTop[p.r1] + p.band + (p.span.start - p.r1 * SLOT_MINUTES) / SLOT_MINUTES;
        const bottom = rowTop[p.r2] + p.band + (p.span.end - p.r2 * SLOT_MINUTES) / SLOT_MINUTES;
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
          placeRef(ref, slotKeyForMinutes(p.span.start));
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
    const scrollKey = isToday ? currentSlotKey(now) : "08:00";
    const targetRow = gridEl.querySelector(
      `[data-slot="${scrollKey}"]`
    );
    if (targetRow)
      gridWrap.scrollTop = Math.max(0, targetRow.offsetTop - 8);
  }
  /* ============================================================
     Stats board (```routine-stats```)
     ============================================================ */
  getEntryDates(file) {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    return new Set(this.normalizeEntries(fm?.[this.settings.entriesProperty]));
  }
  /* Poll the metadata cache until it reflects the just-written entry state,
     so a re-render doesn't read stale frontmatter. */
  async waitForEntryState(file, dateStr, expected, tries = 20) {
    for (let i = 0; i < tries; i++) {
      if (this.getEntryDates(file).has(dateStr) === expected)
        return;
      await new Promise((r) => window.setTimeout(r, 25));
    }
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
    const blockId = this.nextBlockId();
    this.renderStatsBoards(boards, root, 21, blockId);
    this.registerBlockListener(el, ctx, (ev) => {
      if (ev.originId === blockId)
        return;
      const file = this.app.vault.getAbstractFileByPath(ev.path);
      if (!(file instanceof import_obsidian.TFile))
        return;
      this.waitForEntryState(file, ev.dateStr, ev.parentChecked).then(() => this.renderStatsBoards(boards, root, 21, blockId)).catch(
        (e) => console.error("Folder Routines: failed to refresh stats", e)
      );
    });
  }
  renderStatsBoards(host, root, days, blockId) {
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
    const subfolders = [...root.children].filter((c) => c instanceof import_obsidian.TFolder).sort((a, b) => a.name.localeCompare(b.name));
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
      const colorIndex = sectionIndex % _FolderRoutinesPlugin.SECTION_COLORS;
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
          text: row.file.basename
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
            isRunEnd && streak > 1 ? `${row.file.basename} \xB7 ${ds} \xB7 ${streak} day streak` : `${row.file.basename} \xB7 ${ds}`
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
              await this.waitForEntryState(row.file, ds, target);
              this.renderStatsBoards(host, root, days, blockId);
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
      window.requestAnimationFrame(() => {
        grid.scrollLeft = grid.scrollWidth;
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
_FolderRoutinesPlugin.PROGRESS_BLOCKS = 10;
_FolderRoutinesPlugin.SECTION_COLORS = 4;
var FolderRoutinesPlugin = _FolderRoutinesPlugin;
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
  }
};
