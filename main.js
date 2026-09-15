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
  subtaskEntriesProperty: "subtaskEntries"
};
var SUBTASK_SEP = "::";
function makeRef(path, subtask) {
  return subtask != null && subtask !== "" ? path + SUBTASK_SEP + subtask : path;
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
    this.addCommand({
      id: "insert-routines-block",
      name: "Insert routines checklist block",
      editorCallback: (editor, _view) => {
        editor.replaceSelection("```routines\n```\n");
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
      this.settings.subtaskEntriesProperty
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
          `Habit Checklist: failed to reset tracking data in ${file.path}`,
          error
        );
      }
    }
    return { filesCleared, propertiesCleared, failedFiles };
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
        console.error("Habit Checklist: sync listener failed", err);
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
        text: `Habit Checklist: folder "${this.settings.routinesFolder}" not found. Set it in plugin settings.`
      });
      return;
    }
    const date = this.getNoteDate(ctx.sourcePath);
    if (!date) {
      el.createDiv({
        cls: "folder-routines-error",
        text: "Habit Checklist: could not parse a date from this note's filename (expected a daily note)."
      });
      return;
    }
    const dateStr = date.format(this.settings.storeDateFormat || "YYYY-MM-DD");
    const container = el.createDiv({
      cls: "folder-routines folder-routines-minimal"
    });
    const section = container.createDiv({
      cls: "folder-routines-section folder-routines-root"
    });
    const body = section.createDiv({ cls: "folder-routines-body" });
    const sync = { id: this.nextBlockId(), setters: /* @__PURE__ */ new Map() };
    await this.renderFolder(root, body, dateStr, 3, sync);
    this.registerBlockListener(el, ctx, (ev) => {
      if (ev.originId === sync.id || ev.dateStr !== dateStr)
        return;
      sync.setters.get(makeRef(ev.path, ev.subtask))?.(ev.checked);
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
    badge.createSpan({ cls: "folder-routines-progress-label", text: "Progress" });
    badge.createSpan({ cls: "folder-routines-progress-count", text: "0/0" });
    const bar = progress.createDiv({ cls: "folder-routines-progress-bar" });
    bar.createDiv({ cls: "folder-routines-progress-fill" });
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
    const isComplete = total > 0 && done === total;
    section.toggleClass("is-complete", isComplete);
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
          console.error("Habit Checklist: failed to update frontmatter", e);
          new import_obsidian.Notice(`Habit Checklist: failed to update ${file.basename}`);
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
          console.error("Habit Checklist: failed to update frontmatter", e);
          new import_obsidian.Notice(`Habit Checklist: failed to update ${file.basename}`);
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
        console.error("Habit Checklist: failed to update frontmatter", e);
        new import_obsidian.Notice(`Habit Checklist: failed to update ${file.basename}`);
        checkbox.checked = !target;
      } finally {
        setAllDisabled(false);
        this.updateAncestorProgress(itemEl);
      }
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
      text: "This permanently removes habit and subtask completion history from every Markdown file in this vault."
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
              `Habit Checklist: cleared ${result.propertiesCleared} properties from ${result.filesCleared} files; ${result.failedFiles.length} files could not be updated. See the developer console.`
            );
          } else if (result.filesCleared === 0) {
            new import_obsidian.Notice("Habit Checklist: no tracking data found.");
          } else {
            new import_obsidian.Notice(
              `Habit Checklist: cleared ${result.propertiesCleared} properties from ${result.filesCleared} files. Reopen affected notes to refresh their views.`
            );
          }
        } catch (error) {
          console.error("Habit Checklist: failed to reset tracking data", error);
          new import_obsidian.Notice("Habit Checklist: failed to reset tracking data.");
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
      "Hide checklist indices and leading file or folder numbering such as '1. Meditation'. Names on disk are unchanged; reopen affected notes to apply."
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
    new import_obsidian.Setting(containerEl).setName("Reset all tracking data").setDesc(
      "Permanently delete habit and subtask completion history from every Markdown file in this vault."
    ).addButton(
      (button) => button.setButtonText("Reset tracking data").setWarning().onClick(() => new ResetTrackingDataModal(this.app, this.plugin).open())
    );
  }
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibWFpbi50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHtcclxuICBBcHAsXHJcbiAgUGx1Z2luLFxyXG4gIFBsdWdpblNldHRpbmdUYWIsXHJcbiAgU2V0dGluZyxcclxuICBURmlsZSxcclxuICBURm9sZGVyLFxyXG4gIE1hcmtkb3duUG9zdFByb2Nlc3NvckNvbnRleHQsXHJcbiAgTWFya2Rvd25SZW5kZXJDaGlsZCxcclxuICBNb2RhbCxcclxuICBOb3RpY2UsXHJcbiAgRWRpdG9yLFxyXG4gIE1hcmtkb3duVmlldyxcclxuICBtb21lbnQsXHJcbn0gZnJvbSBcIm9ic2lkaWFuXCI7XHJcblxyXG5pbnRlcmZhY2UgRm9sZGVyUm91dGluZXNTZXR0aW5ncyB7XHJcbiAgcm91dGluZXNGb2xkZXI6IHN0cmluZztcclxuICBoaWRlUm91dGluZU51bWJlcmluZzogYm9vbGVhbjtcclxuICBlbnRyaWVzUHJvcGVydHk6IHN0cmluZztcclxuICBzdG9yZURhdGVGb3JtYXQ6IHN0cmluZztcclxuICBzdWJ0YXNrc1Byb3BlcnR5OiBzdHJpbmc7XHJcbiAgc3VidGFza0VudHJpZXNQcm9wZXJ0eTogc3RyaW5nO1xyXG59XHJcblxyXG5jb25zdCBERUZBVUxUX1NFVFRJTkdTOiBGb2xkZXJSb3V0aW5lc1NldHRpbmdzID0ge1xyXG4gIHJvdXRpbmVzRm9sZGVyOiBcIlJvdXRpbmVzXCIsXHJcbiAgaGlkZVJvdXRpbmVOdW1iZXJpbmc6IGZhbHNlLFxyXG4gIGVudHJpZXNQcm9wZXJ0eTogXCJlbnRyaWVzXCIsXHJcbiAgc3RvcmVEYXRlRm9ybWF0OiBcIllZWVktTU0tRERcIixcclxuICBzdWJ0YXNrc1Byb3BlcnR5OiBcInN1YnRhc2tzXCIsXHJcbiAgc3VidGFza0VudHJpZXNQcm9wZXJ0eTogXCJzdWJ0YXNrRW50cmllc1wiLFxyXG59O1xyXG5cclxuY29uc3QgU1VCVEFTS19TRVAgPSBcIjo6XCI7XHJcblxyXG5pbnRlcmZhY2UgVHJhY2tpbmdSZXNldFJlc3VsdCB7XHJcbiAgZmlsZXNDbGVhcmVkOiBudW1iZXI7XHJcbiAgcHJvcGVydGllc0NsZWFyZWQ6IG51bWJlcjtcclxuICBmYWlsZWRGaWxlczogc3RyaW5nW107XHJcbn1cclxuXHJcbi8qIFBlci1ibG9jayByZWdpc3RyeSBvZiBcImFwcGx5IHRoaXMgY29tcGxldGlvbiBzdGF0ZSB0byBteSBVSVwiIGNhbGxiYWNrcyxcclxuICAga2V5ZWQgYnkgcmVmIChub3RlIHBhdGgsIG9yIHBhdGg6OnN1YnRhc2spLiAqL1xyXG5pbnRlcmZhY2UgQmxvY2tTeW5jIHtcclxuICBpZDogc3RyaW5nO1xyXG4gIHNldHRlcnM6IE1hcDxzdHJpbmcsIChjaGVja2VkOiBib29sZWFuKSA9PiB2b2lkPjtcclxufVxyXG5cclxuLyogQnJvYWRjYXN0IHdoZW5ldmVyIGEgaGFiaXQgY29tcGxldGlvbiBpcyB3cml0dGVuLCBzbyBldmVyeSByZW5kZXJlZFxyXG4gIGNoZWNrbGlzdCBzdGF5cyBpbiBzeW5jIHdpdGhvdXQgYSByZS1yZW5kZXIgb2YgdGhlIHdob2xlIHBhZ2UuICovXHJcbmludGVyZmFjZSBSb3V0aW5lQ2hhbmdlRXZlbnQge1xyXG4gIGRhdGVTdHI6IHN0cmluZztcclxuICBwYXRoOiBzdHJpbmc7XHJcbiAgc3VidGFzazogc3RyaW5nIHwgbnVsbDtcclxuICBjaGVja2VkOiBib29sZWFuO1xyXG4gIHBhcmVudENoZWNrZWQ6IGJvb2xlYW47XHJcbiAgc3VidGFza3M6IHN0cmluZ1tdO1xyXG4gIG9yaWdpbklkOiBzdHJpbmc7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG1ha2VSZWYocGF0aDogc3RyaW5nLCBzdWJ0YXNrPzogc3RyaW5nIHwgbnVsbCk6IHN0cmluZyB7XHJcbiAgcmV0dXJuIHN1YnRhc2sgIT0gbnVsbCAmJiBzdWJ0YXNrICE9PSBcIlwiID8gcGF0aCArIFNVQlRBU0tfU0VQICsgc3VidGFzayA6IHBhdGg7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldERhaWx5Tm90ZUZvcm1hdChhcHA6IEFwcCk6IHN0cmluZyB7XHJcbiAgY29uc3QgYW55QXBwID0gYXBwIGFzIGFueTtcclxuICB0cnkge1xyXG4gICAgY29uc3QgZG4gPSBhbnlBcHAuaW50ZXJuYWxQbHVnaW5zPy5nZXRQbHVnaW5CeUlkPy4oXCJkYWlseS1ub3Rlc1wiKTtcclxuICAgIGNvbnN0IGZtdCA9IGRuPy5pbnN0YW5jZT8ub3B0aW9ucz8uZm9ybWF0O1xyXG4gICAgaWYgKGZtdCkgcmV0dXJuIGZtdDtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICAvKiBpZ25vcmUgKi9cclxuICB9XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHBuID0gYW55QXBwLnBsdWdpbnM/LmdldFBsdWdpbj8uKFwicGVyaW9kaWMtbm90ZXNcIik7XHJcbiAgICBjb25zdCBmbXQgPSBwbj8uc2V0dGluZ3M/LmRhaWx5Py5mb3JtYXQ7XHJcbiAgICBpZiAoZm10KSByZXR1cm4gZm10O1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIC8qIGlnbm9yZSAqL1xyXG4gIH1cclxuICByZXR1cm4gXCJZWVlZLU1NLUREXCI7XHJcbn1cclxuXHJcbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEZvbGRlclJvdXRpbmVzUGx1Z2luIGV4dGVuZHMgUGx1Z2luIHtcclxuICBzZXR0aW5nczogRm9sZGVyUm91dGluZXNTZXR0aW5ncztcclxuXHJcbiAgYXN5bmMgb25sb2FkKCkge1xyXG4gICAgYXdhaXQgdGhpcy5sb2FkU2V0dGluZ3MoKTtcclxuXHJcbiAgICB0aGlzLnJlZ2lzdGVyTWFya2Rvd25Db2RlQmxvY2tQcm9jZXNzb3IoXHJcbiAgICAgIFwicm91dGluZXNcIixcclxuICAgICAgKHNvdXJjZSwgZWwsIGN0eCkgPT4gdGhpcy5yZW5kZXJSb3V0aW5lcyhlbCwgY3R4KVxyXG4gICAgKTtcclxuXHJcbiAgICB0aGlzLmFkZENvbW1hbmQoe1xyXG4gICAgICBpZDogXCJpbnNlcnQtcm91dGluZXMtYmxvY2tcIixcclxuICAgICAgbmFtZTogXCJJbnNlcnQgcm91dGluZXMgY2hlY2tsaXN0IGJsb2NrXCIsXHJcbiAgICAgIGVkaXRvckNhbGxiYWNrOiAoZWRpdG9yOiBFZGl0b3IsIF92aWV3OiBNYXJrZG93blZpZXcpID0+IHtcclxuICAgICAgICBlZGl0b3IucmVwbGFjZVNlbGVjdGlvbihcImBgYHJvdXRpbmVzXFxuYGBgXFxuXCIpO1xyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgdGhpcy5hZGRTZXR0aW5nVGFiKG5ldyBGb2xkZXJSb3V0aW5lc1NldHRpbmdUYWIodGhpcy5hcHAsIHRoaXMpKTtcclxuICB9XHJcblxyXG4gIGFzeW5jIGxvYWRTZXR0aW5ncygpIHtcclxuICAgIHRoaXMuc2V0dGluZ3MgPSBPYmplY3QuYXNzaWduKHt9LCBERUZBVUxUX1NFVFRJTkdTLCBhd2FpdCB0aGlzLmxvYWREYXRhKCkpO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgc2F2ZVNldHRpbmdzKCkge1xyXG4gICAgYXdhaXQgdGhpcy5zYXZlRGF0YSh0aGlzLnNldHRpbmdzKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgdHJhY2tpbmdQcm9wZXJ0eU5hbWVzKCk6IHN0cmluZ1tdIHtcclxuICAgIHJldHVybiBbXHJcbiAgICAgIHRoaXMuc2V0dGluZ3MuZW50cmllc1Byb3BlcnR5LFxyXG4gICAgICB0aGlzLnNldHRpbmdzLnN1YnRhc2tFbnRyaWVzUHJvcGVydHksXHJcbiAgICBdLmZpbHRlcigobmFtZSwgaW5kZXgsIG5hbWVzKSA9PiBuYW1lLmxlbmd0aCA+IDAgJiYgbmFtZXMuaW5kZXhPZihuYW1lKSA9PT0gaW5kZXgpO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgcmVzZXRUcmFja2luZ0RhdGEoKTogUHJvbWlzZTxUcmFja2luZ1Jlc2V0UmVzdWx0PiB7XHJcbiAgICBjb25zdCBwcm9wZXJ0aWVzID0gdGhpcy50cmFja2luZ1Byb3BlcnR5TmFtZXMoKTtcclxuICAgIGNvbnN0IGZpbGVzID0gdGhpcy5hcHAudmF1bHQuZ2V0TWFya2Rvd25GaWxlcygpLmZpbHRlcigoZmlsZSkgPT4ge1xyXG4gICAgICBjb25zdCBmcm9udG1hdHRlciA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpPy5mcm9udG1hdHRlcjtcclxuICAgICAgcmV0dXJuIChcclxuICAgICAgICBmcm9udG1hdHRlciAhPSBudWxsICYmXHJcbiAgICAgICAgcHJvcGVydGllcy5zb21lKChwcm9wZXJ0eSkgPT5cclxuICAgICAgICAgIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChmcm9udG1hdHRlciwgcHJvcGVydHkpXHJcbiAgICAgICAgKVxyXG4gICAgICApO1xyXG4gICAgfSk7XHJcblxyXG4gICAgbGV0IGZpbGVzQ2xlYXJlZCA9IDA7XHJcbiAgICBsZXQgcHJvcGVydGllc0NsZWFyZWQgPSAwO1xyXG4gICAgY29uc3QgZmFpbGVkRmlsZXM6IHN0cmluZ1tdID0gW107XHJcblxyXG4gICAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XHJcbiAgICAgIGxldCByZW1vdmVkRnJvbUZpbGUgPSAwO1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGF3YWl0IHRoaXMuYXBwLmZpbGVNYW5hZ2VyLnByb2Nlc3NGcm9udE1hdHRlcihmaWxlLCAoZnJvbnRtYXR0ZXIpID0+IHtcclxuICAgICAgICAgIGZvciAoY29uc3QgcHJvcGVydHkgb2YgcHJvcGVydGllcykge1xyXG4gICAgICAgICAgICBpZiAoIU9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChmcm9udG1hdHRlciwgcHJvcGVydHkpKVxyXG4gICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICBkZWxldGUgZnJvbnRtYXR0ZXJbcHJvcGVydHldO1xyXG4gICAgICAgICAgICByZW1vdmVkRnJvbUZpbGUgKz0gMTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgICAgICBpZiAocmVtb3ZlZEZyb21GaWxlID4gMCkge1xyXG4gICAgICAgICAgZmlsZXNDbGVhcmVkICs9IDE7XHJcbiAgICAgICAgICBwcm9wZXJ0aWVzQ2xlYXJlZCArPSByZW1vdmVkRnJvbUZpbGU7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGZhaWxlZEZpbGVzLnB1c2goZmlsZS5wYXRoKTtcclxuICAgICAgICBjb25zb2xlLmVycm9yKFxyXG4gICAgICAgICAgYEhhYml0IENoZWNrbGlzdDogZmFpbGVkIHRvIHJlc2V0IHRyYWNraW5nIGRhdGEgaW4gJHtmaWxlLnBhdGh9YCxcclxuICAgICAgICAgIGVycm9yXHJcbiAgICAgICAgKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiB7IGZpbGVzQ2xlYXJlZCwgcHJvcGVydGllc0NsZWFyZWQsIGZhaWxlZEZpbGVzIH07XHJcbiAgfVxyXG5cclxuICAvKiBUaGUgY29uZmlndXJlZCByb3V0aW5lcyBmb2xkZXIsIG9yIG51bGwgd2hlbiBpdCBubyBsb25nZXIgZXhpc3RzLiBUaGVcclxuICAgICBwaWNrZXIgc3RvcmVzIHRoZSB2YXVsdCByb290IGFzIFwiL1wiLCB3aGljaCBpcyBub3QgYSBub3JtYWwgZm9sZGVyIHBhdGguICovXHJcbiAgcm91dGluZXNSb290KCk6IFRGb2xkZXIgfCBudWxsIHtcclxuICAgIGNvbnN0IHBhdGggPSB0aGlzLnNldHRpbmdzLnJvdXRpbmVzRm9sZGVyO1xyXG4gICAgY29uc3QgdmF1bHRSb290ID0gdGhpcy5hcHAudmF1bHQuZ2V0Um9vdCgpO1xyXG4gICAgaWYgKHBhdGggPT09IFwiL1wiIHx8IHBhdGggPT09IHZhdWx0Um9vdC5wYXRoKSByZXR1cm4gdmF1bHRSb290O1xyXG4gICAgY29uc3QgZm9sZGVyID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKHBhdGgpO1xyXG4gICAgcmV0dXJuIGZvbGRlciBpbnN0YW5jZW9mIFRGb2xkZXIgPyBmb2xkZXIgOiBudWxsO1xyXG4gIH1cclxuXHJcbiAgLyogRXZlcnkgZm9sZGVyIGluIHRoZSB2YXVsdCwgZWFjaCBwYXJlbnQgbGlzdGVkIGJlZm9yZSBpdHMgY2hpbGRyZW4sIHNvIHRoZVxyXG4gICAgIHNldHRpbmdzIHBpY2tlciByZWFkcyBsaWtlIHRoZSBmaWxlIGV4cGxvcmVyLiAqL1xyXG4gIGFsbEZvbGRlclBhdGhzKCk6IHN0cmluZ1tdIHtcclxuICAgIGNvbnN0IG91dDogc3RyaW5nW10gPSBbXTtcclxuICAgIGNvbnN0IHdhbGsgPSAoZm9sZGVyOiBURm9sZGVyKSA9PiB7XHJcbiAgICAgIG91dC5wdXNoKGZvbGRlci5wYXRoKTtcclxuICAgICAgY29uc3Qgc3VicyA9IGZvbGRlci5jaGlsZHJlblxyXG4gICAgICAgIC5maWx0ZXIoKGMpOiBjIGlzIFRGb2xkZXIgPT4gYyBpbnN0YW5jZW9mIFRGb2xkZXIpXHJcbiAgICAgICAgLnNvcnQoKGEsIGIpID0+IGEubmFtZS5sb2NhbGVDb21wYXJlKGIubmFtZSkpO1xyXG4gICAgICBmb3IgKGNvbnN0IHN1YiBvZiBzdWJzKSB3YWxrKHN1Yik7XHJcbiAgICB9O1xyXG4gICAgd2Fsayh0aGlzLmFwcC52YXVsdC5nZXRSb290KCkpO1xyXG4gICAgcmV0dXJuIG91dDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgZGlzcGxheU5hbWUobmFtZTogc3RyaW5nKTogc3RyaW5nIHtcclxuICAgIGlmICghdGhpcy5zZXR0aW5ncy5oaWRlUm91dGluZU51bWJlcmluZykgcmV0dXJuIG5hbWU7XHJcbiAgICBjb25zdCB3aXRob3V0TnVtYmVyaW5nID0gbmFtZS5yZXBsYWNlKC9eXFxzKlxcZCtbLildXFxzKy8sIFwiXCIpO1xyXG4gICAgcmV0dXJuIHdpdGhvdXROdW1iZXJpbmcgfHwgbmFtZTtcclxuICB9XHJcblxyXG4gIC8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4gICAgIExpdmUgc3luYyBiZXR3ZWVuIGJsb2Nrc1xyXG4gICAgID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqL1xyXG5cclxuICBwcml2YXRlIGNoYW5nZUxpc3RlbmVycyA9IG5ldyBTZXQ8KGU6IFJvdXRpbmVDaGFuZ2VFdmVudCkgPT4gdm9pZD4oKTtcclxuICBwcml2YXRlIGJsb2NrU2VxID0gMDtcclxuXHJcbiAgcHJpdmF0ZSBuZXh0QmxvY2tJZCgpOiBzdHJpbmcge1xyXG4gICAgdGhpcy5ibG9ja1NlcSArPSAxO1xyXG4gICAgcmV0dXJuIGBmci1ibG9jay0ke3RoaXMuYmxvY2tTZXF9YDtcclxuICB9XHJcblxyXG4gIC8qIFJlZ2lzdGVyIGEgbGlzdGVuZXIgYm91bmQgdG8gYSByZW5kZXJlZCBjb2RlIGJsb2NrOiBpdCBpcyBkcm9wcGVkIGFzIHNvb25cclxuICAgICBhcyBPYnNpZGlhbiB1bmxvYWRzIHRoYXQgYmxvY2sncyBlbGVtZW50LiAqL1xyXG4gIHByaXZhdGUgcmVnaXN0ZXJCbG9ja0xpc3RlbmVyKFxyXG4gICAgZWw6IEhUTUxFbGVtZW50LFxyXG4gICAgY3R4OiBNYXJrZG93blBvc3RQcm9jZXNzb3JDb250ZXh0LFxyXG4gICAgbGlzdGVuZXI6IChlOiBSb3V0aW5lQ2hhbmdlRXZlbnQpID0+IHZvaWRcclxuICApIHtcclxuICAgIHRoaXMuY2hhbmdlTGlzdGVuZXJzLmFkZChsaXN0ZW5lcik7XHJcbiAgICBjb25zdCBjaGlsZCA9IG5ldyBNYXJrZG93blJlbmRlckNoaWxkKGVsKTtcclxuICAgIGNoaWxkLnJlZ2lzdGVyKCgpID0+IHRoaXMuY2hhbmdlTGlzdGVuZXJzLmRlbGV0ZShsaXN0ZW5lcikpO1xyXG4gICAgY3R4LmFkZENoaWxkKGNoaWxkKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgZW1pdFJvdXRpbmVDaGFuZ2UoZTogUm91dGluZUNoYW5nZUV2ZW50KSB7XHJcbiAgICBmb3IgKGNvbnN0IGxpc3RlbmVyIG9mIFsuLi50aGlzLmNoYW5nZUxpc3RlbmVyc10pIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBsaXN0ZW5lcihlKTtcclxuICAgICAgfSBjYXRjaCAoZXJyKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcihcIkhhYml0IENoZWNrbGlzdDogc3luYyBsaXN0ZW5lciBmYWlsZWRcIiwgZXJyKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBub3JtYWxpemVFbnRyaWVzKHZhbDogdW5rbm93bik6IHN0cmluZ1tdIHtcclxuICAgIGlmICh2YWwgPT0gbnVsbCkgcmV0dXJuIFtdO1xyXG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsKSkgcmV0dXJuIHZhbC5tYXAoKHYpID0+IFN0cmluZyh2KSk7XHJcbiAgICByZXR1cm4gW1N0cmluZyh2YWwpXTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgZ2V0Tm90ZURhdGUoc291cmNlUGF0aDogc3RyaW5nKTogUmV0dXJuVHlwZTx0eXBlb2YgbW9tZW50PiB8IG51bGwge1xyXG4gICAgY29uc3QgYmFzZSA9IChzb3VyY2VQYXRoLnNwbGl0KFwiL1wiKS5wb3AoKSA/PyBcIlwiKS5yZXBsYWNlKC9cXC5tZCQvLCBcIlwiKTtcclxuICAgIGNvbnN0IGZtdCA9IGdldERhaWx5Tm90ZUZvcm1hdCh0aGlzLmFwcCk7XHJcbiAgICBjb25zdCBtID0gbW9tZW50KGJhc2UsIGZtdCwgdHJ1ZSk7XHJcbiAgICByZXR1cm4gbS5pc1ZhbGlkKCkgPyBtIDogbnVsbDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgaXNDaGVja2VkKGZpbGU6IFRGaWxlLCBkYXRlU3RyOiBzdHJpbmcpOiBib29sZWFuIHtcclxuICAgIGNvbnN0IGZtID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoZmlsZSk/LmZyb250bWF0dGVyO1xyXG4gICAgY29uc3QgZW50cmllcyA9IHRoaXMubm9ybWFsaXplRW50cmllcyhmbT8uW3RoaXMuc2V0dGluZ3MuZW50cmllc1Byb3BlcnR5XSk7XHJcbiAgICByZXR1cm4gZW50cmllcy5pbmNsdWRlcyhkYXRlU3RyKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgZ2V0U3VidGFza3MoZmlsZTogVEZpbGUpOiBzdHJpbmdbXSB7XHJcbiAgICBjb25zdCBmbSA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpPy5mcm9udG1hdHRlcjtcclxuICAgIHJldHVybiB0aGlzLm5vcm1hbGl6ZUVudHJpZXMoZm0/Llt0aGlzLnNldHRpbmdzLnN1YnRhc2tzUHJvcGVydHldKVxyXG4gICAgICAubWFwKChzKSA9PiBzLnRyaW0oKSlcclxuICAgICAgLmZpbHRlcigocykgPT4gcy5sZW5ndGggPiAwKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgbm9ybWFsaXplU3VidGFza0VudHJpZXModmFsOiB1bmtub3duKTogUmVjb3JkPHN0cmluZywgc3RyaW5nW10+IHtcclxuICAgIGNvbnN0IG91dDogUmVjb3JkPHN0cmluZywgc3RyaW5nW10+ID0ge307XHJcbiAgICBpZiAodmFsID09IG51bGwgfHwgdHlwZW9mIHZhbCAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbCkpIHJldHVybiBvdXQ7XHJcbiAgICBmb3IgKGNvbnN0IFtrZXksIHZdIG9mIE9iamVjdC5lbnRyaWVzKHZhbCBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikpIHtcclxuICAgICAgb3V0W2tleV0gPSB0aGlzLm5vcm1hbGl6ZUVudHJpZXModik7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gb3V0O1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBpc1N1YnRhc2tDaGVja2VkKGZpbGU6IFRGaWxlLCBuYW1lOiBzdHJpbmcsIGRhdGVTdHI6IHN0cmluZyk6IGJvb2xlYW4ge1xyXG4gICAgY29uc3QgZm0gPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShmaWxlKT8uZnJvbnRtYXR0ZXI7XHJcbiAgICBjb25zdCBtYXAgPSB0aGlzLm5vcm1hbGl6ZVN1YnRhc2tFbnRyaWVzKGZtPy5bdGhpcy5zZXR0aW5ncy5zdWJ0YXNrRW50cmllc1Byb3BlcnR5XSk7XHJcbiAgICByZXR1cm4gKG1hcFtuYW1lXSA/PyBbXSkuaW5jbHVkZXMoZGF0ZVN0cik7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHJlY29uY2lsZVN1YnRhc2tFbnRyaWVzKFxyXG4gICAgZmlsZTogVEZpbGUsXHJcbiAgICBzdWJ0YXNrczogc3RyaW5nW11cclxuICApOiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIHN0cmluZ1tdPj4ge1xyXG4gICAgY29uc3QgZW50cmllc1Byb3AgPSB0aGlzLnNldHRpbmdzLmVudHJpZXNQcm9wZXJ0eTtcclxuICAgIGNvbnN0IHN1YlByb3AgPSB0aGlzLnNldHRpbmdzLnN1YnRhc2tFbnRyaWVzUHJvcGVydHk7XHJcblxyXG4gICAgY29uc3QgZm0gPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShmaWxlKT8uZnJvbnRtYXR0ZXI7XHJcbiAgICBjb25zdCBwYXJlbnREYXRlcyA9IHRoaXMubm9ybWFsaXplRW50cmllcyhmbT8uW2VudHJpZXNQcm9wXSk7XHJcbiAgICBjb25zdCBjdXJyZW50ID0gdGhpcy5ub3JtYWxpemVTdWJ0YXNrRW50cmllcyhmbT8uW3N1YlByb3BdKTtcclxuXHJcbiAgICBjb25zdCByZXNvbHZlZDogUmVjb3JkPHN0cmluZywgc3RyaW5nW10+ID0ge307XHJcbiAgICBsZXQgY2hhbmdlZCA9IGZhbHNlO1xyXG4gICAgZm9yIChjb25zdCBuYW1lIG9mIHN1YnRhc2tzKSB7XHJcbiAgICAgIGNvbnN0IHNldCA9IG5ldyBTZXQoY3VycmVudFtuYW1lXSA/PyBbXSk7XHJcbiAgICAgIGNvbnN0IGJlZm9yZSA9IHNldC5zaXplO1xyXG4gICAgICBmb3IgKGNvbnN0IGQgb2YgcGFyZW50RGF0ZXMpIHNldC5hZGQoZCk7XHJcbiAgICAgIGlmIChzZXQuc2l6ZSAhPT0gYmVmb3JlKSBjaGFuZ2VkID0gdHJ1ZTtcclxuICAgICAgcmVzb2x2ZWRbbmFtZV0gPSBbLi4uc2V0XS5zb3J0KCk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGNoYW5nZWQpIHtcclxuICAgICAgYXdhaXQgdGhpcy5hcHAuZmlsZU1hbmFnZXIucHJvY2Vzc0Zyb250TWF0dGVyKGZpbGUsIChmbXcpID0+IHtcclxuICAgICAgICBjb25zdCBwRGF0ZXMgPSB0aGlzLm5vcm1hbGl6ZUVudHJpZXMoZm13W2VudHJpZXNQcm9wXSk7XHJcbiAgICAgICAgY29uc3QgbWFwID0gdGhpcy5ub3JtYWxpemVTdWJ0YXNrRW50cmllcyhmbXdbc3ViUHJvcF0pO1xyXG4gICAgICAgIGZvciAoY29uc3QgbmFtZSBvZiBzdWJ0YXNrcykge1xyXG4gICAgICAgICAgY29uc3Qgc2V0ID0gbmV3IFNldChtYXBbbmFtZV0gPz8gW10pO1xyXG4gICAgICAgICAgZm9yIChjb25zdCBkIG9mIHBEYXRlcykgc2V0LmFkZChkKTtcclxuICAgICAgICAgIG1hcFtuYW1lXSA9IFsuLi5zZXRdLnNvcnQoKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgZm13W3N1YlByb3BdID0gbWFwO1xyXG4gICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gcmVzb2x2ZWQ7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHNldEVudHJ5KGZpbGU6IFRGaWxlLCBkYXRlU3RyOiBzdHJpbmcsIGNoZWNrZWQ6IGJvb2xlYW4pIHtcclxuICAgIGNvbnN0IHByb3AgPSB0aGlzLnNldHRpbmdzLmVudHJpZXNQcm9wZXJ0eTtcclxuICAgIGF3YWl0IHRoaXMuYXBwLmZpbGVNYW5hZ2VyLnByb2Nlc3NGcm9udE1hdHRlcihmaWxlLCAoZm0pID0+IHtcclxuICAgICAgbGV0IGVudHJpZXMgPSB0aGlzLm5vcm1hbGl6ZUVudHJpZXMoZm1bcHJvcF0pO1xyXG4gICAgICBpZiAoY2hlY2tlZCkge1xyXG4gICAgICAgIGlmICghZW50cmllcy5pbmNsdWRlcyhkYXRlU3RyKSkgZW50cmllcy5wdXNoKGRhdGVTdHIpO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGVudHJpZXMgPSBlbnRyaWVzLmZpbHRlcigoZSkgPT4gZSAhPT0gZGF0ZVN0cik7XHJcbiAgICAgIH1cclxuICAgICAgZW50cmllcy5zb3J0KCk7XHJcbiAgICAgIGZtW3Byb3BdID0gZW50cmllcztcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBzZXRTdWJ0YXNrRW50cnkoXHJcbiAgICBmaWxlOiBURmlsZSxcclxuICAgIG5hbWU6IHN0cmluZyxcclxuICAgIGRhdGVTdHI6IHN0cmluZyxcclxuICAgIGNoZWNrZWQ6IGJvb2xlYW4sXHJcbiAgICBhbGxTdWJ0YXNrczogc3RyaW5nW11cclxuICApOiBQcm9taXNlPGJvb2xlYW4+IHtcclxuICAgIGNvbnN0IGVudHJpZXNQcm9wID0gdGhpcy5zZXR0aW5ncy5lbnRyaWVzUHJvcGVydHk7XHJcbiAgICBjb25zdCBzdWJQcm9wID0gdGhpcy5zZXR0aW5ncy5zdWJ0YXNrRW50cmllc1Byb3BlcnR5O1xyXG4gICAgbGV0IHBhcmVudENoZWNrZWQgPSBmYWxzZTtcclxuICAgIGF3YWl0IHRoaXMuYXBwLmZpbGVNYW5hZ2VyLnByb2Nlc3NGcm9udE1hdHRlcihmaWxlLCAoZm0pID0+IHtcclxuICAgICAgY29uc3QgbWFwID0gdGhpcy5ub3JtYWxpemVTdWJ0YXNrRW50cmllcyhmbVtzdWJQcm9wXSk7XHJcbiAgICAgIGxldCBkYXRlcyA9IG1hcFtuYW1lXSA/PyBbXTtcclxuICAgICAgaWYgKGNoZWNrZWQpIHtcclxuICAgICAgICBpZiAoIWRhdGVzLmluY2x1ZGVzKGRhdGVTdHIpKSBkYXRlcy5wdXNoKGRhdGVTdHIpO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGRhdGVzID0gZGF0ZXMuZmlsdGVyKChkKSA9PiBkICE9PSBkYXRlU3RyKTtcclxuICAgICAgfVxyXG4gICAgICBkYXRlcy5zb3J0KCk7XHJcbiAgICAgIG1hcFtuYW1lXSA9IGRhdGVzO1xyXG5cclxuICAgICAgY29uc3QgYWxsRG9uZSA9IGFsbFN1YnRhc2tzLmV2ZXJ5KChzKSA9PiAobWFwW3NdID8/IFtdKS5pbmNsdWRlcyhkYXRlU3RyKSk7XHJcbiAgICAgIHBhcmVudENoZWNrZWQgPSBhbGxEb25lO1xyXG4gICAgICBsZXQgZW50cmllcyA9IHRoaXMubm9ybWFsaXplRW50cmllcyhmbVtlbnRyaWVzUHJvcF0pO1xyXG4gICAgICBpZiAoYWxsRG9uZSkge1xyXG4gICAgICAgIGlmICghZW50cmllcy5pbmNsdWRlcyhkYXRlU3RyKSkgZW50cmllcy5wdXNoKGRhdGVTdHIpO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGVudHJpZXMgPSBlbnRyaWVzLmZpbHRlcigoZSkgPT4gZSAhPT0gZGF0ZVN0cik7XHJcbiAgICAgIH1cclxuICAgICAgZW50cmllcy5zb3J0KCk7XHJcbiAgICAgIGZtW2VudHJpZXNQcm9wXSA9IGVudHJpZXM7XHJcblxyXG4gICAgICBpZiAoT2JqZWN0LmtleXMobWFwKS5sZW5ndGggPT09IDApIHtcclxuICAgICAgICBkZWxldGUgZm1bc3ViUHJvcF07XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgZm1bc3ViUHJvcF0gPSBtYXA7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG4gICAgcmV0dXJuIHBhcmVudENoZWNrZWQ7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHNldFBhcmVudFRvZ2dsZUFsbChcclxuICAgIGZpbGU6IFRGaWxlLFxyXG4gICAgZGF0ZVN0cjogc3RyaW5nLFxyXG4gICAgY2hlY2tlZDogYm9vbGVhbixcclxuICAgIGFsbFN1YnRhc2tzOiBzdHJpbmdbXVxyXG4gICkge1xyXG4gICAgY29uc3QgZW50cmllc1Byb3AgPSB0aGlzLnNldHRpbmdzLmVudHJpZXNQcm9wZXJ0eTtcclxuICAgIGNvbnN0IHN1YlByb3AgPSB0aGlzLnNldHRpbmdzLnN1YnRhc2tFbnRyaWVzUHJvcGVydHk7XHJcbiAgICBhd2FpdCB0aGlzLmFwcC5maWxlTWFuYWdlci5wcm9jZXNzRnJvbnRNYXR0ZXIoZmlsZSwgKGZtKSA9PiB7XHJcbiAgICAgIGNvbnN0IG1hcCA9IHRoaXMubm9ybWFsaXplU3VidGFza0VudHJpZXMoZm1bc3ViUHJvcF0pO1xyXG4gICAgICBmb3IgKGNvbnN0IG5hbWUgb2YgYWxsU3VidGFza3MpIHtcclxuICAgICAgICBsZXQgZGF0ZXMgPSBtYXBbbmFtZV0gPz8gW107XHJcbiAgICAgICAgaWYgKGNoZWNrZWQpIHtcclxuICAgICAgICAgIGlmICghZGF0ZXMuaW5jbHVkZXMoZGF0ZVN0cikpIGRhdGVzLnB1c2goZGF0ZVN0cik7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIGRhdGVzID0gZGF0ZXMuZmlsdGVyKChkKSA9PiBkICE9PSBkYXRlU3RyKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgZGF0ZXMuc29ydCgpO1xyXG4gICAgICAgIG1hcFtuYW1lXSA9IGRhdGVzO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBsZXQgZW50cmllcyA9IHRoaXMubm9ybWFsaXplRW50cmllcyhmbVtlbnRyaWVzUHJvcF0pO1xyXG4gICAgICBpZiAoY2hlY2tlZCkge1xyXG4gICAgICAgIGlmICghZW50cmllcy5pbmNsdWRlcyhkYXRlU3RyKSkgZW50cmllcy5wdXNoKGRhdGVTdHIpO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGVudHJpZXMgPSBlbnRyaWVzLmZpbHRlcigoZSkgPT4gZSAhPT0gZGF0ZVN0cik7XHJcbiAgICAgIH1cclxuICAgICAgZW50cmllcy5zb3J0KCk7XHJcbiAgICAgIGZtW2VudHJpZXNQcm9wXSA9IGVudHJpZXM7XHJcblxyXG4gICAgICBpZiAoT2JqZWN0LmtleXMobWFwKS5sZW5ndGggPT09IDApIHtcclxuICAgICAgICBkZWxldGUgZm1bc3ViUHJvcF07XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgZm1bc3ViUHJvcF0gPSBtYXA7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyByZW5kZXJSb3V0aW5lcyhlbDogSFRNTEVsZW1lbnQsIGN0eDogTWFya2Rvd25Qb3N0UHJvY2Vzc29yQ29udGV4dCkge1xyXG4gICAgZWwuZW1wdHkoKTtcclxuXHJcbiAgICBjb25zdCByb290ID0gdGhpcy5yb3V0aW5lc1Jvb3QoKTtcclxuICAgIGlmICghcm9vdCkge1xyXG4gICAgICBlbC5jcmVhdGVEaXYoe1xyXG4gICAgICAgIGNsczogXCJmb2xkZXItcm91dGluZXMtZXJyb3JcIixcclxuICAgICAgICB0ZXh0OiBgSGFiaXQgQ2hlY2tsaXN0OiBmb2xkZXIgXCIke3RoaXMuc2V0dGluZ3Mucm91dGluZXNGb2xkZXJ9XCIgbm90IGZvdW5kLiBTZXQgaXQgaW4gcGx1Z2luIHNldHRpbmdzLmAsXHJcbiAgICAgIH0pO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgZGF0ZSA9IHRoaXMuZ2V0Tm90ZURhdGUoY3R4LnNvdXJjZVBhdGgpO1xyXG4gICAgaWYgKCFkYXRlKSB7XHJcbiAgICAgIGVsLmNyZWF0ZURpdih7XHJcbiAgICAgICAgY2xzOiBcImZvbGRlci1yb3V0aW5lcy1lcnJvclwiLFxyXG4gICAgICAgIHRleHQ6IFwiSGFiaXQgQ2hlY2tsaXN0OiBjb3VsZCBub3QgcGFyc2UgYSBkYXRlIGZyb20gdGhpcyBub3RlJ3MgZmlsZW5hbWUgKGV4cGVjdGVkIGEgZGFpbHkgbm90ZSkuXCIsXHJcbiAgICAgIH0pO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgZGF0ZVN0ciA9IGRhdGUuZm9ybWF0KHRoaXMuc2V0dGluZ3Muc3RvcmVEYXRlRm9ybWF0IHx8IFwiWVlZWS1NTS1ERFwiKTtcclxuICAgIGNvbnN0IGNvbnRhaW5lciA9IGVsLmNyZWF0ZURpdih7XHJcbiAgICAgIGNsczogXCJmb2xkZXItcm91dGluZXMgZm9sZGVyLXJvdXRpbmVzLW1pbmltYWxcIixcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IHNlY3Rpb24gPSBjb250YWluZXIuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcImZvbGRlci1yb3V0aW5lcy1zZWN0aW9uIGZvbGRlci1yb3V0aW5lcy1yb290XCIsXHJcbiAgICB9KTtcclxuICAgIGNvbnN0IGJvZHkgPSBzZWN0aW9uLmNyZWF0ZURpdih7IGNsczogXCJmb2xkZXItcm91dGluZXMtYm9keVwiIH0pO1xyXG4gICAgY29uc3Qgc3luYzogQmxvY2tTeW5jID0geyBpZDogdGhpcy5uZXh0QmxvY2tJZCgpLCBzZXR0ZXJzOiBuZXcgTWFwKCkgfTtcclxuICAgIGF3YWl0IHRoaXMucmVuZGVyRm9sZGVyKHJvb3QsIGJvZHksIGRhdGVTdHIsIDMsIHN5bmMpO1xyXG5cclxuICAgIHRoaXMucmVnaXN0ZXJCbG9ja0xpc3RlbmVyKGVsLCBjdHgsIChldikgPT4ge1xyXG4gICAgICBpZiAoZXYub3JpZ2luSWQgPT09IHN5bmMuaWQgfHwgZXYuZGF0ZVN0ciAhPT0gZGF0ZVN0cikgcmV0dXJuO1xyXG4gICAgICBzeW5jLnNldHRlcnMuZ2V0KG1ha2VSZWYoZXYucGF0aCwgZXYuc3VidGFzaykpPy4oZXYuY2hlY2tlZCk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgcmVuZGVyRm9sZGVyKFxyXG4gICAgZm9sZGVyOiBURm9sZGVyLFxyXG4gICAgY29udGFpbmVyOiBIVE1MRWxlbWVudCxcclxuICAgIGRhdGVTdHI6IHN0cmluZyxcclxuICAgIGRlcHRoOiBudW1iZXIsXHJcbiAgICBzeW5jOiBCbG9ja1N5bmNcclxuICApIHtcclxuICAgIGNvbnN0IGNoaWxkcmVuID0gWy4uLmZvbGRlci5jaGlsZHJlbl0uc29ydCgoYSwgYikgPT5cclxuICAgICAgYS5uYW1lLmxvY2FsZUNvbXBhcmUoYi5uYW1lKVxyXG4gICAgKTtcclxuICAgIGNvbnN0IGZpbGVzID0gY2hpbGRyZW4uZmlsdGVyKFxyXG4gICAgICAoYyk6IGMgaXMgVEZpbGUgPT4gYyBpbnN0YW5jZW9mIFRGaWxlICYmIGMuZXh0ZW5zaW9uID09PSBcIm1kXCJcclxuICAgICk7XHJcbiAgICBjb25zdCBzdWJmb2xkZXJzID0gY2hpbGRyZW4uZmlsdGVyKFxyXG4gICAgICAoYyk6IGMgaXMgVEZvbGRlciA9PiBjIGluc3RhbmNlb2YgVEZvbGRlclxyXG4gICAgKTtcclxuXHJcbiAgICBsZXQgaW5kZXggPSAwO1xyXG4gICAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XHJcbiAgICAgIGluZGV4Kys7XHJcbiAgICAgIGF3YWl0IHRoaXMucmVuZGVySXRlbShmaWxlLCBjb250YWluZXIsIGRhdGVTdHIsIGluZGV4LCBzeW5jKTtcclxuICAgIH1cclxuXHJcbiAgICBmb3IgKGxldCBzZWN0aW9uSW5kZXggPSAwOyBzZWN0aW9uSW5kZXggPCBzdWJmb2xkZXJzLmxlbmd0aDsgc2VjdGlvbkluZGV4KyspIHtcclxuICAgICAgY29uc3Qgc3ViID0gc3ViZm9sZGVyc1tzZWN0aW9uSW5kZXhdO1xyXG4gICAgICBjb25zdCBzZWN0aW9uID0gY29udGFpbmVyLmNyZWF0ZURpdih7IGNsczogXCJmb2xkZXItcm91dGluZXMtc2VjdGlvblwiIH0pO1xyXG4gICAgICBjb25zdCBjb2xvckluZGV4ID0gc2VjdGlvbkluZGV4ICUgRm9sZGVyUm91dGluZXNQbHVnaW4uU0VDVElPTl9DT0xPUlM7XHJcbiAgICAgIHNlY3Rpb24uYWRkQ2xhc3MoYGZvbGRlci1yb3V0aW5lcy1jb2xvci0ke2NvbG9ySW5kZXggKyAxfWApO1xyXG4gICAgICBjb25zdCB0YWcgPSAoXCJoXCIgKyBNYXRoLm1pbihkZXB0aCwgNikpIGFzIGtleW9mIEhUTUxFbGVtZW50VGFnTmFtZU1hcDtcclxuICAgICAgY29uc3QgaGVhZGVyID0gc2VjdGlvbi5jcmVhdGVFbCh0YWcsIHsgY2xzOiBcImZvbGRlci1yb3V0aW5lcy1oZWFkaW5nXCIgfSk7XHJcbiAgICAgIGhlYWRlci5jcmVhdGVTcGFuKHtcclxuICAgICAgICBjbHM6IFwiZm9sZGVyLXJvdXRpbmVzLWhlYWRpbmctdGl0bGVcIixcclxuICAgICAgICB0ZXh0OiB0aGlzLmRpc3BsYXlOYW1lKHN1Yi5uYW1lKSxcclxuICAgICAgfSk7XHJcbiAgICAgIHRoaXMuY3JlYXRlUHJvZ3Jlc3MoaGVhZGVyKTtcclxuXHJcbiAgICAgIGNvbnN0IGJvZHkgPSBzZWN0aW9uLmNyZWF0ZURpdih7IGNsczogXCJmb2xkZXItcm91dGluZXMtYm9keVwiIH0pO1xyXG4gICAgICBhd2FpdCB0aGlzLnJlbmRlckZvbGRlcihzdWIsIGJvZHksIGRhdGVTdHIsIGRlcHRoICsgMSwgc3luYyk7XHJcbiAgICAgIHRoaXMudXBkYXRlU2VjdGlvblByb2dyZXNzKHNlY3Rpb24pO1xyXG5cclxuICAgICAgaGVhZGVyLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XHJcbiAgICAgICAgc2VjdGlvbi50b2dnbGVDbGFzcyhcImlzLWNvbGxhcHNlZFwiLCAhc2VjdGlvbi5oYXNDbGFzcyhcImlzLWNvbGxhcHNlZFwiKSk7XHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzdGF0aWMgcmVhZG9ubHkgU0VDVElPTl9DT0xPUlMgPSA0O1xyXG5cclxuICBwcml2YXRlIGNyZWF0ZVByb2dyZXNzKGhlYWRlcjogSFRNTEVsZW1lbnQpIHtcclxuICAgIGNvbnN0IHByb2dyZXNzID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJmb2xkZXItcm91dGluZXMtcHJvZ3Jlc3NcIiB9KTtcclxuICAgIGNvbnN0IGJhZGdlID0gcHJvZ3Jlc3MuY3JlYXRlRGl2KHsgY2xzOiBcImZvbGRlci1yb3V0aW5lcy1wcm9ncmVzcy1iYWRnZVwiIH0pO1xyXG4gICAgYmFkZ2UuY3JlYXRlU3Bhbih7IGNsczogXCJmb2xkZXItcm91dGluZXMtcHJvZ3Jlc3MtbGFiZWxcIiwgdGV4dDogXCJQcm9ncmVzc1wiIH0pO1xyXG4gICAgYmFkZ2UuY3JlYXRlU3Bhbih7IGNsczogXCJmb2xkZXItcm91dGluZXMtcHJvZ3Jlc3MtY291bnRcIiwgdGV4dDogXCIwLzBcIiB9KTtcclxuICAgIGNvbnN0IGJhciA9IHByb2dyZXNzLmNyZWF0ZURpdih7IGNsczogXCJmb2xkZXItcm91dGluZXMtcHJvZ3Jlc3MtYmFyXCIgfSk7XHJcbiAgICBiYXIuY3JlYXRlRGl2KHsgY2xzOiBcImZvbGRlci1yb3V0aW5lcy1wcm9ncmVzcy1maWxsXCIgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHVwZGF0ZVNlY3Rpb25Qcm9ncmVzcyhzZWN0aW9uOiBIVE1MRWxlbWVudCkge1xyXG4gICAgY29uc3QgY2hlY2tib3hlcyA9IEFycmF5LmZyb20oXHJcbiAgICAgIHNlY3Rpb24ucXVlcnlTZWxlY3RvckFsbDxIVE1MSW5wdXRFbGVtZW50PihcIi5mb2xkZXItcm91dGluZXMtcHJvZ3Jlc3MtY2hlY2tib3hcIilcclxuICAgICk7XHJcbiAgICBjb25zdCB0b3RhbCA9IGNoZWNrYm94ZXMubGVuZ3RoO1xyXG4gICAgY29uc3QgZG9uZSA9IGNoZWNrYm94ZXMuZmlsdGVyKChjaGVja2JveCkgPT4gY2hlY2tib3guY2hlY2tlZCkubGVuZ3RoO1xyXG4gICAgY29uc3QgcHJvZ3Jlc3MgPSBzZWN0aW9uLnF1ZXJ5U2VsZWN0b3I8SFRNTEVsZW1lbnQ+KFxyXG4gICAgICBcIjpzY29wZSA+IC5mb2xkZXItcm91dGluZXMtaGVhZGluZyAuZm9sZGVyLXJvdXRpbmVzLXByb2dyZXNzXCJcclxuICAgICk7XHJcbiAgICBpZiAoIXByb2dyZXNzKSByZXR1cm47XHJcblxyXG4gICAgY29uc3QgY291bnQgPSBwcm9ncmVzcy5xdWVyeVNlbGVjdG9yPEhUTUxFbGVtZW50PihcIi5mb2xkZXItcm91dGluZXMtcHJvZ3Jlc3MtY291bnRcIik7XHJcbiAgICBpZiAoY291bnQpIGNvdW50LnNldFRleHQoYCR7ZG9uZX0vJHt0b3RhbH1gKTtcclxuXHJcbiAgICBjb25zdCBmaWxsID0gcHJvZ3Jlc3MucXVlcnlTZWxlY3RvcjxIVE1MRWxlbWVudD4oXCIuZm9sZGVyLXJvdXRpbmVzLXByb2dyZXNzLWZpbGxcIik7XHJcbiAgICBjb25zdCByYXRpbyA9IHRvdGFsID09PSAwID8gMCA6IGRvbmUgLyB0b3RhbDtcclxuICAgIGlmIChmaWxsKSBmaWxsLnN0eWxlLnNldFByb3BlcnR5KFwiLS1mci1wcm9ncmVzc1wiLCBgJHtyYXRpbyAqIDEwMH0lYCk7XHJcblxyXG4gICAgY29uc3QgaXNDb21wbGV0ZSA9IHRvdGFsID4gMCAmJiBkb25lID09PSB0b3RhbDtcclxuICAgIHNlY3Rpb24udG9nZ2xlQ2xhc3MoXCJpcy1jb21wbGV0ZVwiLCBpc0NvbXBsZXRlKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgdXBkYXRlQW5jZXN0b3JQcm9ncmVzcyhmcm9tOiBIVE1MRWxlbWVudCkge1xyXG4gICAgbGV0IHNlY3Rpb24gPSBmcm9tLmNsb3Nlc3Q8SFRNTEVsZW1lbnQ+KFwiLmZvbGRlci1yb3V0aW5lcy1zZWN0aW9uXCIpO1xyXG4gICAgd2hpbGUgKHNlY3Rpb24pIHtcclxuICAgICAgdGhpcy51cGRhdGVTZWN0aW9uUHJvZ3Jlc3Moc2VjdGlvbik7XHJcbiAgICAgIHNlY3Rpb24gPSBzZWN0aW9uLnBhcmVudEVsZW1lbnQ/LmNsb3Nlc3Q8SFRNTEVsZW1lbnQ+KFwiLmZvbGRlci1yb3V0aW5lcy1zZWN0aW9uXCIpID8/IG51bGw7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHdpcmVTZWxlY3Rpb24oaXRlbUVsOiBIVE1MRWxlbWVudCkge1xyXG4gICAgY29uc3Qgc2VsZWN0ID0gKCkgPT4ge1xyXG4gICAgICBjb25zdCByb290ID0gaXRlbUVsLmNsb3Nlc3Q8SFRNTEVsZW1lbnQ+KFwiLmZvbGRlci1yb3V0aW5lc1wiKTtcclxuICAgICAgcm9vdFxyXG4gICAgICAgID8ucXVlcnlTZWxlY3RvckFsbChcIi5pcy1zZWxlY3RlZFwiKVxyXG4gICAgICAgIC5mb3JFYWNoKChuKSA9PiBuLnJlbW92ZUNsYXNzKFwiaXMtc2VsZWN0ZWRcIikpO1xyXG4gICAgICBpdGVtRWwuYWRkQ2xhc3MoXCJpcy1zZWxlY3RlZFwiKTtcclxuICAgIH07XHJcbiAgICBpdGVtRWwuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJkb3duXCIsIHNlbGVjdCk7XHJcbiAgICBpdGVtRWwuYWRkRXZlbnRMaXN0ZW5lcihcImZvY3VzaW5cIiwgc2VsZWN0KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgcmVuZGVySXRlbShcclxuICAgIGZpbGU6IFRGaWxlLFxyXG4gICAgY29udGFpbmVyOiBIVE1MRWxlbWVudCxcclxuICAgIGRhdGVTdHI6IHN0cmluZyxcclxuICAgIGluZGV4ID0gMCxcclxuICAgIHN5bmM/OiBCbG9ja1N5bmNcclxuICApIHtcclxuICAgIGNvbnN0IHN1YnRhc2tzID0gdGhpcy5nZXRTdWJ0YXNrcyhmaWxlKTtcclxuICAgIGNvbnN0IGl0ZW1FbCA9IGNvbnRhaW5lci5jcmVhdGVEaXYoeyBjbHM6IFwiZm9sZGVyLXJvdXRpbmVzLWl0ZW1cIiB9KTtcclxuICAgIGl0ZW1FbC50YWJJbmRleCA9IDA7XHJcbiAgICB0aGlzLndpcmVTZWxlY3Rpb24oaXRlbUVsKTtcclxuICAgIGNvbnN0IGxhYmVsID0gaXRlbUVsLmNyZWF0ZUVsKFwibGFiZWxcIiwgeyBjbHM6IFwiZm9sZGVyLXJvdXRpbmVzLWxhYmVsXCIgfSk7XHJcbiAgICBpZiAoaW5kZXggPiAwICYmICF0aGlzLnNldHRpbmdzLmhpZGVSb3V0aW5lTnVtYmVyaW5nKSB7XHJcbiAgICAgIGxhYmVsLmNyZWF0ZVNwYW4oe1xyXG4gICAgICAgIGNsczogXCJmb2xkZXItcm91dGluZXMtaW5kZXhcIixcclxuICAgICAgICB0ZXh0OiBTdHJpbmcoaW5kZXgpLnBhZFN0YXJ0KDIsIFwiMFwiKSxcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICBjb25zdCBjaGVja2JveCA9IGxhYmVsLmNyZWF0ZUVsKFwiaW5wdXRcIiwge1xyXG4gICAgICB0eXBlOiBcImNoZWNrYm94XCIsXHJcbiAgICB9KSBhcyBIVE1MSW5wdXRFbGVtZW50O1xyXG4gICAgY2hlY2tib3guY2xhc3NMaXN0LmFkZChcImZvbGRlci1yb3V0aW5lcy1jaGVja2JveFwiKTtcclxuICAgIGxhYmVsLmNyZWF0ZVNwYW4oe1xyXG4gICAgICB0ZXh0OiB0aGlzLmRpc3BsYXlOYW1lKGZpbGUuYmFzZW5hbWUpLFxyXG4gICAgICBjbHM6IFwiZm9sZGVyLXJvdXRpbmVzLXRleHRcIixcclxuICAgIH0pO1xyXG5cclxuICAgIGlmIChzdWJ0YXNrcy5sZW5ndGggPT09IDApIHtcclxuICAgICAgY2hlY2tib3guY2xhc3NMaXN0LmFkZChcImZvbGRlci1yb3V0aW5lcy1wcm9ncmVzcy1jaGVja2JveFwiKTtcclxuICAgICAgY2hlY2tib3guY2hlY2tlZCA9IHRoaXMuaXNDaGVja2VkKGZpbGUsIGRhdGVTdHIpO1xyXG4gICAgICBpdGVtRWwudG9nZ2xlQ2xhc3MoXCJpcy1jaGVja2VkXCIsIGNoZWNrYm94LmNoZWNrZWQpO1xyXG5cclxuICAgICAgc3luYz8uc2V0dGVycy5zZXQoZmlsZS5wYXRoLCAoY2hlY2tlZCkgPT4ge1xyXG4gICAgICAgIGlmIChjaGVja2JveC5jaGVja2VkID09PSBjaGVja2VkKSByZXR1cm47XHJcbiAgICAgICAgY2hlY2tib3guY2hlY2tlZCA9IGNoZWNrZWQ7XHJcbiAgICAgICAgaXRlbUVsLnRvZ2dsZUNsYXNzKFwiaXMtY2hlY2tlZFwiLCBjaGVja2VkKTtcclxuICAgICAgICB0aGlzLnVwZGF0ZUFuY2VzdG9yUHJvZ3Jlc3MoaXRlbUVsKTtcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjaGVja2JveC5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlXCIsIGFzeW5jICgpID0+IHtcclxuICAgICAgICBjb25zdCB0YXJnZXQgPSBjaGVja2JveC5jaGVja2VkO1xyXG4gICAgICAgIGNoZWNrYm94LmRpc2FibGVkID0gdHJ1ZTtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgYXdhaXQgdGhpcy5zZXRFbnRyeShmaWxlLCBkYXRlU3RyLCB0YXJnZXQpO1xyXG4gICAgICAgICAgaXRlbUVsLnRvZ2dsZUNsYXNzKFwiaXMtY2hlY2tlZFwiLCB0YXJnZXQpO1xyXG4gICAgICAgICAgdGhpcy5lbWl0Um91dGluZUNoYW5nZSh7XHJcbiAgICAgICAgICAgIGRhdGVTdHIsXHJcbiAgICAgICAgICAgIHBhdGg6IGZpbGUucGF0aCxcclxuICAgICAgICAgICAgc3VidGFzazogbnVsbCxcclxuICAgICAgICAgICAgY2hlY2tlZDogdGFyZ2V0LFxyXG4gICAgICAgICAgICBwYXJlbnRDaGVja2VkOiB0YXJnZXQsXHJcbiAgICAgICAgICAgIHN1YnRhc2tzOiBbXSxcclxuICAgICAgICAgICAgb3JpZ2luSWQ6IHN5bmM/LmlkID8/IFwiXCIsXHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmVycm9yKFwiSGFiaXQgQ2hlY2tsaXN0OiBmYWlsZWQgdG8gdXBkYXRlIGZyb250bWF0dGVyXCIsIGUpO1xyXG4gICAgICAgICAgbmV3IE5vdGljZShgSGFiaXQgQ2hlY2tsaXN0OiBmYWlsZWQgdG8gdXBkYXRlICR7ZmlsZS5iYXNlbmFtZX1gKTtcclxuICAgICAgICAgIGNoZWNrYm94LmNoZWNrZWQgPSAhdGFyZ2V0O1xyXG4gICAgICAgIH0gZmluYWxseSB7XHJcbiAgICAgICAgICBjaGVja2JveC5kaXNhYmxlZCA9IGZhbHNlO1xyXG4gICAgICAgICAgdGhpcy51cGRhdGVBbmNlc3RvclByb2dyZXNzKGl0ZW1FbCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9KTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGNoZWNrYm94LmNsYXNzTGlzdC5hZGQoXCJmb2xkZXItcm91dGluZXMtcGFyZW50LWNoZWNrYm94XCIpO1xyXG5cclxuICAgIGNvbnN0IHN1YkNvbnRhaW5lciA9IGNvbnRhaW5lci5jcmVhdGVEaXYoeyBjbHM6IFwiZm9sZGVyLXJvdXRpbmVzLXN1YnRhc2tzXCIgfSk7XHJcbiAgICBjb25zdCBzdWJFbHM6IHsgbmFtZTogc3RyaW5nOyBlbDogSFRNTEVsZW1lbnQ7IGNoZWNrYm94OiBIVE1MSW5wdXRFbGVtZW50IH1bXSA9IFtdO1xyXG5cclxuICAgIGNvbnN0IHJlZnJlc2hQYXJlbnQgPSAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGFsbENoZWNrZWQgPSBzdWJFbHMuZXZlcnkoKHMpID0+IHMuY2hlY2tib3guY2hlY2tlZCk7XHJcbiAgICAgIGNoZWNrYm94LmNoZWNrZWQgPSBhbGxDaGVja2VkO1xyXG4gICAgICBpdGVtRWwudG9nZ2xlQ2xhc3MoXCJpcy1jaGVja2VkXCIsIGFsbENoZWNrZWQpO1xyXG4gICAgfTtcclxuXHJcbiAgICBjb25zdCBzZXRBbGxEaXNhYmxlZCA9IChkaXNhYmxlZDogYm9vbGVhbikgPT4ge1xyXG4gICAgICBjaGVja2JveC5kaXNhYmxlZCA9IGRpc2FibGVkO1xyXG4gICAgICBmb3IgKGNvbnN0IHMgb2Ygc3ViRWxzKSBzLmNoZWNrYm94LmRpc2FibGVkID0gZGlzYWJsZWQ7XHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IHJlc29sdmVkID0gYXdhaXQgdGhpcy5yZWNvbmNpbGVTdWJ0YXNrRW50cmllcyhmaWxlLCBzdWJ0YXNrcyk7XHJcblxyXG4gICAgc3VidGFza3MuZm9yRWFjaCgobmFtZSwgc3ViSW5kZXgpID0+IHtcclxuICAgICAgY29uc3Qgc3ViSXRlbSA9IHN1YkNvbnRhaW5lci5jcmVhdGVEaXYoeyBjbHM6IFwiZm9sZGVyLXJvdXRpbmVzLXN1YnRhc2tcIiB9KTtcclxuICAgICAgc3ViSXRlbS50YWJJbmRleCA9IDA7XHJcbiAgICAgIHRoaXMud2lyZVNlbGVjdGlvbihzdWJJdGVtKTtcclxuICAgICAgaWYgKHN1YkluZGV4ID09PSBzdWJ0YXNrcy5sZW5ndGggLSAxKSBzdWJJdGVtLmFkZENsYXNzKFwiaXMtbGFzdFwiKTtcclxuICAgICAgY29uc3Qgc3ViTGFiZWwgPSBzdWJJdGVtLmNyZWF0ZUVsKFwibGFiZWxcIiwgeyBjbHM6IFwiZm9sZGVyLXJvdXRpbmVzLWxhYmVsXCIgfSk7XHJcbiAgICAgIHN1YkxhYmVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZm9sZGVyLXJvdXRpbmVzLXRyZWVcIiwgdGV4dDogXCJcIiB9KTtcclxuICAgICAgY29uc3Qgc3ViQ2hlY2tib3ggPSBzdWJMYWJlbC5jcmVhdGVFbChcImlucHV0XCIsIHtcclxuICAgICAgICB0eXBlOiBcImNoZWNrYm94XCIsXHJcbiAgICAgIH0pIGFzIEhUTUxJbnB1dEVsZW1lbnQ7XHJcbiAgICAgIHN1YkNoZWNrYm94LmNsYXNzTGlzdC5hZGQoXCJmb2xkZXItcm91dGluZXMtY2hlY2tib3hcIiwgXCJmb2xkZXItcm91dGluZXMtcHJvZ3Jlc3MtY2hlY2tib3hcIik7XHJcbiAgICAgIHN1YkNoZWNrYm94LmNoZWNrZWQgPSAocmVzb2x2ZWRbbmFtZV0gPz8gW10pLmluY2x1ZGVzKGRhdGVTdHIpO1xyXG4gICAgICBzdWJMYWJlbC5jcmVhdGVTcGFuKHsgdGV4dDogbmFtZSwgY2xzOiBcImZvbGRlci1yb3V0aW5lcy10ZXh0XCIgfSk7XHJcbiAgICAgIHN1Ykl0ZW0udG9nZ2xlQ2xhc3MoXCJpcy1jaGVja2VkXCIsIHN1YkNoZWNrYm94LmNoZWNrZWQpO1xyXG4gICAgICBzdWJFbHMucHVzaCh7IG5hbWUsIGVsOiBzdWJJdGVtLCBjaGVja2JveDogc3ViQ2hlY2tib3ggfSk7XHJcblxyXG4gICAgICBzeW5jPy5zZXR0ZXJzLnNldChtYWtlUmVmKGZpbGUucGF0aCwgbmFtZSksIChjaGVja2VkKSA9PiB7XHJcbiAgICAgICAgaWYgKHN1YkNoZWNrYm94LmNoZWNrZWQgPT09IGNoZWNrZWQpIHJldHVybjtcclxuICAgICAgICBzdWJDaGVja2JveC5jaGVja2VkID0gY2hlY2tlZDtcclxuICAgICAgICBzdWJJdGVtLnRvZ2dsZUNsYXNzKFwiaXMtY2hlY2tlZFwiLCBjaGVja2VkKTtcclxuICAgICAgICByZWZyZXNoUGFyZW50KCk7XHJcbiAgICAgICAgdGhpcy51cGRhdGVBbmNlc3RvclByb2dyZXNzKHN1Ykl0ZW0pO1xyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIHN1YkNoZWNrYm94LmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IHRhcmdldCA9IHN1YkNoZWNrYm94LmNoZWNrZWQ7XHJcbiAgICAgICAgc2V0QWxsRGlzYWJsZWQodHJ1ZSk7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgIGNvbnN0IHBhcmVudENoZWNrZWQgPSBhd2FpdCB0aGlzLnNldFN1YnRhc2tFbnRyeShcclxuICAgICAgICAgICAgZmlsZSxcclxuICAgICAgICAgICAgbmFtZSxcclxuICAgICAgICAgICAgZGF0ZVN0cixcclxuICAgICAgICAgICAgdGFyZ2V0LFxyXG4gICAgICAgICAgICBzdWJ0YXNrc1xyXG4gICAgICAgICAgKTtcclxuICAgICAgICAgIHN1Ykl0ZW0udG9nZ2xlQ2xhc3MoXCJpcy1jaGVja2VkXCIsIHRhcmdldCk7XHJcbiAgICAgICAgICByZWZyZXNoUGFyZW50KCk7XHJcbiAgICAgICAgICB0aGlzLmVtaXRSb3V0aW5lQ2hhbmdlKHtcclxuICAgICAgICAgICAgZGF0ZVN0cixcclxuICAgICAgICAgICAgcGF0aDogZmlsZS5wYXRoLFxyXG4gICAgICAgICAgICBzdWJ0YXNrOiBuYW1lLFxyXG4gICAgICAgICAgICBjaGVja2VkOiB0YXJnZXQsXHJcbiAgICAgICAgICAgIHBhcmVudENoZWNrZWQsXHJcbiAgICAgICAgICAgIHN1YnRhc2tzLFxyXG4gICAgICAgICAgICBvcmlnaW5JZDogc3luYz8uaWQgPz8gXCJcIixcclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXCJIYWJpdCBDaGVja2xpc3Q6IGZhaWxlZCB0byB1cGRhdGUgZnJvbnRtYXR0ZXJcIiwgZSk7XHJcbiAgICAgICAgICBuZXcgTm90aWNlKGBIYWJpdCBDaGVja2xpc3Q6IGZhaWxlZCB0byB1cGRhdGUgJHtmaWxlLmJhc2VuYW1lfWApO1xyXG4gICAgICAgICAgc3ViQ2hlY2tib3guY2hlY2tlZCA9ICF0YXJnZXQ7XHJcbiAgICAgICAgfSBmaW5hbGx5IHtcclxuICAgICAgICAgIHNldEFsbERpc2FibGVkKGZhbHNlKTtcclxuICAgICAgICAgIHRoaXMudXBkYXRlQW5jZXN0b3JQcm9ncmVzcyhzdWJJdGVtKTtcclxuICAgICAgICB9XHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcblxyXG4gICAgcmVmcmVzaFBhcmVudCgpO1xyXG5cclxuICAgIHN5bmM/LnNldHRlcnMuc2V0KGZpbGUucGF0aCwgKGNoZWNrZWQpID0+IHtcclxuICAgICAgY2hlY2tib3guY2hlY2tlZCA9IGNoZWNrZWQ7XHJcbiAgICAgIGl0ZW1FbC50b2dnbGVDbGFzcyhcImlzLWNoZWNrZWRcIiwgY2hlY2tlZCk7XHJcbiAgICAgIGZvciAoY29uc3QgcyBvZiBzdWJFbHMpIHtcclxuICAgICAgICBzLmNoZWNrYm94LmNoZWNrZWQgPSBjaGVja2VkO1xyXG4gICAgICAgIHMuZWwudG9nZ2xlQ2xhc3MoXCJpcy1jaGVja2VkXCIsIGNoZWNrZWQpO1xyXG4gICAgICB9XHJcbiAgICAgIHRoaXMudXBkYXRlQW5jZXN0b3JQcm9ncmVzcyhpdGVtRWwpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgY2hlY2tib3guYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IHRhcmdldCA9IGNoZWNrYm94LmNoZWNrZWQ7XHJcbiAgICAgIHNldEFsbERpc2FibGVkKHRydWUpO1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGF3YWl0IHRoaXMuc2V0UGFyZW50VG9nZ2xlQWxsKGZpbGUsIGRhdGVTdHIsIHRhcmdldCwgc3VidGFza3MpO1xyXG4gICAgICAgIGl0ZW1FbC50b2dnbGVDbGFzcyhcImlzLWNoZWNrZWRcIiwgdGFyZ2V0KTtcclxuICAgICAgICBmb3IgKGNvbnN0IHMgb2Ygc3ViRWxzKSB7XHJcbiAgICAgICAgICBzLmNoZWNrYm94LmNoZWNrZWQgPSB0YXJnZXQ7XHJcbiAgICAgICAgICBzLmVsLnRvZ2dsZUNsYXNzKFwiaXMtY2hlY2tlZFwiLCB0YXJnZXQpO1xyXG4gICAgICAgIH1cclxuICAgICAgICB0aGlzLmVtaXRSb3V0aW5lQ2hhbmdlKHtcclxuICAgICAgICAgIGRhdGVTdHIsXHJcbiAgICAgICAgICBwYXRoOiBmaWxlLnBhdGgsXHJcbiAgICAgICAgICBzdWJ0YXNrOiBudWxsLFxyXG4gICAgICAgICAgY2hlY2tlZDogdGFyZ2V0LFxyXG4gICAgICAgICAgcGFyZW50Q2hlY2tlZDogdGFyZ2V0LFxyXG4gICAgICAgICAgc3VidGFza3MsXHJcbiAgICAgICAgICBvcmlnaW5JZDogc3luYz8uaWQgPz8gXCJcIixcclxuICAgICAgICB9KTtcclxuICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoXCJIYWJpdCBDaGVja2xpc3Q6IGZhaWxlZCB0byB1cGRhdGUgZnJvbnRtYXR0ZXJcIiwgZSk7XHJcbiAgICAgICAgbmV3IE5vdGljZShgSGFiaXQgQ2hlY2tsaXN0OiBmYWlsZWQgdG8gdXBkYXRlICR7ZmlsZS5iYXNlbmFtZX1gKTtcclxuICAgICAgICBjaGVja2JveC5jaGVja2VkID0gIXRhcmdldDtcclxuICAgICAgfSBmaW5hbGx5IHtcclxuICAgICAgICBzZXRBbGxEaXNhYmxlZChmYWxzZSk7XHJcbiAgICAgICAgdGhpcy51cGRhdGVBbmNlc3RvclByb2dyZXNzKGl0ZW1FbCk7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbn1cclxuXHJcbmNsYXNzIFJlc2V0VHJhY2tpbmdEYXRhTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XHJcbiAgcHJpdmF0ZSBwbHVnaW46IEZvbGRlclJvdXRpbmVzUGx1Z2luO1xyXG5cclxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgcGx1Z2luOiBGb2xkZXJSb3V0aW5lc1BsdWdpbikge1xyXG4gICAgc3VwZXIoYXBwKTtcclxuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xyXG4gIH1cclxuXHJcbiAgb25PcGVuKCk6IHZvaWQge1xyXG4gICAgdGhpcy5zZXRUaXRsZShcIlJlc2V0IGFsbCB0cmFja2luZyBkYXRhP1wiKTtcclxuICAgIHRoaXMuY29udGVudEVsLmNyZWF0ZUVsKFwicFwiLCB7XHJcbiAgICAgIHRleHQ6IFwiVGhpcyBwZXJtYW5lbnRseSByZW1vdmVzIGhhYml0IGFuZCBzdWJ0YXNrIGNvbXBsZXRpb24gaGlzdG9yeSBmcm9tIGV2ZXJ5IE1hcmtkb3duIGZpbGUgaW4gdGhpcyB2YXVsdC5cIixcclxuICAgIH0pO1xyXG4gICAgdGhpcy5jb250ZW50RWwuY3JlYXRlRWwoXCJwXCIsIHtcclxuICAgICAgdGV4dDogXCJIYWJpdCBkZWZpbml0aW9ucywgbm90ZSBjb250ZW50LCBhbmQgcGx1Z2luIHNldHRpbmdzIGFyZSBrZXB0LiBUaGlzIGNhbm5vdCBiZSB1bmRvbmUuXCIsXHJcbiAgICB9KTtcclxuXHJcbiAgICBsZXQgY2FuY2VsQnV0dG9uOiBIVE1MQnV0dG9uRWxlbWVudCB8IG51bGwgPSBudWxsO1xyXG4gICAgbmV3IFNldHRpbmcodGhpcy5jb250ZW50RWwpXHJcbiAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT4ge1xyXG4gICAgICAgIGNhbmNlbEJ1dHRvbiA9IGJ1dHRvbi5idXR0b25FbDtcclxuICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dChcIkNhbmNlbFwiKS5vbkNsaWNrKCgpID0+IHRoaXMuY2xvc2UoKSk7XHJcbiAgICAgIH0pXHJcbiAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cclxuICAgICAgICBidXR0b25cclxuICAgICAgICAgIC5zZXRCdXR0b25UZXh0KFwiUmVzZXQgdHJhY2tpbmcgZGF0YVwiKVxyXG4gICAgICAgICAgLnNldFdhcm5pbmcoKVxyXG4gICAgICAgICAgLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgICAgICBidXR0b24uc2V0RGlzYWJsZWQodHJ1ZSkuc2V0QnV0dG9uVGV4dChcIlJlc2V0dGluZy4uLlwiKTtcclxuICAgICAgICAgICAgaWYgKGNhbmNlbEJ1dHRvbikgY2FuY2VsQnV0dG9uLmRpc2FibGVkID0gdHJ1ZTtcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnBsdWdpbi5yZXNldFRyYWNraW5nRGF0YSgpO1xyXG4gICAgICAgICAgICAgIHRoaXMuY2xvc2UoKTtcclxuICAgICAgICAgICAgICBpZiAocmVzdWx0LmZhaWxlZEZpbGVzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgICAgICAgIG5ldyBOb3RpY2UoXHJcbiAgICAgICAgICAgICAgICAgIGBIYWJpdCBDaGVja2xpc3Q6IGNsZWFyZWQgJHtyZXN1bHQucHJvcGVydGllc0NsZWFyZWR9IHByb3BlcnRpZXMgZnJvbSAke3Jlc3VsdC5maWxlc0NsZWFyZWR9IGZpbGVzOyAke3Jlc3VsdC5mYWlsZWRGaWxlcy5sZW5ndGh9IGZpbGVzIGNvdWxkIG5vdCBiZSB1cGRhdGVkLiBTZWUgdGhlIGRldmVsb3BlciBjb25zb2xlLmBcclxuICAgICAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgICAgfSBlbHNlIGlmIChyZXN1bHQuZmlsZXNDbGVhcmVkID09PSAwKSB7XHJcbiAgICAgICAgICAgICAgICBuZXcgTm90aWNlKFwiSGFiaXQgQ2hlY2tsaXN0OiBubyB0cmFja2luZyBkYXRhIGZvdW5kLlwiKTtcclxuICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgbmV3IE5vdGljZShcclxuICAgICAgICAgICAgICAgICAgYEhhYml0IENoZWNrbGlzdDogY2xlYXJlZCAke3Jlc3VsdC5wcm9wZXJ0aWVzQ2xlYXJlZH0gcHJvcGVydGllcyBmcm9tICR7cmVzdWx0LmZpbGVzQ2xlYXJlZH0gZmlsZXMuIFJlb3BlbiBhZmZlY3RlZCBub3RlcyB0byByZWZyZXNoIHRoZWlyIHZpZXdzLmBcclxuICAgICAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXCJIYWJpdCBDaGVja2xpc3Q6IGZhaWxlZCB0byByZXNldCB0cmFja2luZyBkYXRhXCIsIGVycm9yKTtcclxuICAgICAgICAgICAgICBuZXcgTm90aWNlKFwiSGFiaXQgQ2hlY2tsaXN0OiBmYWlsZWQgdG8gcmVzZXQgdHJhY2tpbmcgZGF0YS5cIik7XHJcbiAgICAgICAgICAgICAgYnV0dG9uLnNldERpc2FibGVkKGZhbHNlKS5zZXRCdXR0b25UZXh0KFwiUmVzZXQgdHJhY2tpbmcgZGF0YVwiKTtcclxuICAgICAgICAgICAgICBpZiAoY2FuY2VsQnV0dG9uKSBjYW5jZWxCdXR0b24uZGlzYWJsZWQgPSBmYWxzZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgfSlcclxuICAgICAgKTtcclxuICB9XHJcblxyXG4gIG9uQ2xvc2UoKTogdm9pZCB7XHJcbiAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xyXG4gIH1cclxufVxyXG5cclxuY2xhc3MgRm9sZGVyUm91dGluZXNTZXR0aW5nVGFiIGV4dGVuZHMgUGx1Z2luU2V0dGluZ1RhYiB7XHJcbiAgcGx1Z2luOiBGb2xkZXJSb3V0aW5lc1BsdWdpbjtcclxuXHJcbiAgY29uc3RydWN0b3IoYXBwOiBBcHAsIHBsdWdpbjogRm9sZGVyUm91dGluZXNQbHVnaW4pIHtcclxuICAgIHN1cGVyKGFwcCwgcGx1Z2luKTtcclxuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xyXG4gIH1cclxuXHJcbiAgZGlzcGxheSgpOiB2b2lkIHtcclxuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XHJcbiAgICBjb250YWluZXJFbC5lbXB0eSgpO1xyXG5cclxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxyXG4gICAgICAuc2V0TmFtZShcIlJvdXRpbmVzIGZvbGRlclwiKVxyXG4gICAgICAuc2V0RGVzYyhcIkZvbGRlciBob2xkaW5nIHlvdXIgcm91dGluZSBub3Rlcy5cIilcclxuICAgICAgLmFkZERyb3Bkb3duKChkcm9wKSA9PiB7XHJcbiAgICAgICAgY29uc3QgY3VycmVudCA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnJvdXRpbmVzRm9sZGVyO1xyXG4gICAgICAgIGNvbnN0IGZvbGRlcnMgPSB0aGlzLnBsdWdpbi5hbGxGb2xkZXJQYXRocygpO1xyXG4gICAgICAgIC8vIEEgZm9sZGVyIHRoYXQgaGFzIHNpbmNlIGJlZW4gcmVuYW1lZCBvciBkZWxldGVkIHN0aWxsIGdldHMgYW4gZW50cnksXHJcbiAgICAgICAgLy8gc28gdGhlIHBpY2tlciBzaG93cyB3aGF0IGlzIHN0b3JlZCBpbnN0ZWFkIG9mIGEgZGlmZmVyZW50IGZvbGRlci5cclxuICAgICAgICBpZiAoIWZvbGRlcnMuaW5jbHVkZXMoY3VycmVudCkpXHJcbiAgICAgICAgICBkcm9wLmFkZE9wdGlvbihcclxuICAgICAgICAgICAgY3VycmVudCxcclxuICAgICAgICAgICAgY3VycmVudCA9PT0gXCJcIiA/IFwiKG5vbmUgc2VsZWN0ZWQpXCIgOiBgJHtjdXJyZW50fSAobm90IGZvdW5kKWBcclxuICAgICAgICAgICk7XHJcbiAgICAgICAgZm9yIChjb25zdCBwYXRoIG9mIGZvbGRlcnMpXHJcbiAgICAgICAgICBkcm9wLmFkZE9wdGlvbihwYXRoLCBwYXRoID09PSBcIi9cIiA/IFwiLyAodmF1bHQgcm9vdClcIiA6IHBhdGgpO1xyXG4gICAgICAgIGRyb3Auc2V0VmFsdWUoY3VycmVudCkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XHJcbiAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5yb3V0aW5lc0ZvbGRlciA9IHZhbHVlO1xyXG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH0pO1xyXG5cclxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxyXG4gICAgICAuc2V0TmFtZShcIkhpZGUgcm91dGluZSBudW1iZXJpbmdcIilcclxuICAgICAgLnNldERlc2MoXHJcbiAgICAgICAgXCJIaWRlIGNoZWNrbGlzdCBpbmRpY2VzIGFuZCBsZWFkaW5nIGZpbGUgb3IgZm9sZGVyIG51bWJlcmluZyBzdWNoIGFzICcxLiBNZWRpdGF0aW9uJy4gTmFtZXMgb24gZGlzayBhcmUgdW5jaGFuZ2VkOyByZW9wZW4gYWZmZWN0ZWQgbm90ZXMgdG8gYXBwbHkuXCJcclxuICAgICAgKVxyXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XHJcbiAgICAgICAgdG9nZ2xlXHJcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuaGlkZVJvdXRpbmVOdW1iZXJpbmcpXHJcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XHJcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmhpZGVSb3V0aW5lTnVtYmVyaW5nID0gdmFsdWU7XHJcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgICAgfSlcclxuICAgICAgKTtcclxuXHJcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcclxuICAgICAgLnNldE5hbWUoXCJFbnRyaWVzIHByb3BlcnR5XCIpXHJcbiAgICAgIC5zZXREZXNjKFwiRnJvbnRtYXR0ZXIgcHJvcGVydHkgdXBkYXRlZCB3aGVuIGFuIGl0ZW0gaXMgY2hlY2tlZC5cIilcclxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XHJcbiAgICAgICAgdGV4dFxyXG4gICAgICAgICAgLnNldFBsYWNlaG9sZGVyKFwiZW50cmllc1wiKVxyXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmVudHJpZXNQcm9wZXJ0eSlcclxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcclxuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuZW50cmllc1Byb3BlcnR5ID0gdmFsdWUudHJpbSgpIHx8IFwiZW50cmllc1wiO1xyXG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICAgIH0pXHJcbiAgICAgICk7XHJcblxyXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXHJcbiAgICAgIC5zZXROYW1lKFwiU3RvcmVkIGRhdGUgZm9ybWF0XCIpXHJcbiAgICAgIC5zZXREZXNjKFwiTW9tZW50IGZvcm1hdCB1c2VkIGZvciB0aGUgZGF0ZSB3cml0dGVuIGludG8gJ2VudHJpZXMnLlwiKVxyXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cclxuICAgICAgICB0ZXh0XHJcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoXCJZWVlZLU1NLUREXCIpXHJcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3Muc3RvcmVEYXRlRm9ybWF0KVxyXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5zdG9yZURhdGVGb3JtYXQgPSB2YWx1ZS50cmltKCkgfHwgXCJZWVlZLU1NLUREXCI7XHJcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgICAgfSlcclxuICAgICAgKTtcclxuXHJcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcclxuICAgICAgLnNldE5hbWUoXCJTdWJ0YXNrcyBwcm9wZXJ0eVwiKVxyXG4gICAgICAuc2V0RGVzYyhcIkZyb250bWF0dGVyIHByb3BlcnR5IHRoYXQgbGlzdHMgYSBub3RlJ3Mgc3VidGFza3MuXCIpXHJcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxyXG4gICAgICAgIHRleHRcclxuICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcihcInN1YnRhc2tzXCIpXHJcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3Muc3VidGFza3NQcm9wZXJ0eSlcclxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcclxuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Muc3VidGFza3NQcm9wZXJ0eSA9IHZhbHVlLnRyaW0oKSB8fCBcInN1YnRhc2tzXCI7XHJcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgICAgfSlcclxuICAgICAgKTtcclxuXHJcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcclxuICAgICAgLnNldE5hbWUoXCJTdWJ0YXNrIGVudHJpZXMgcHJvcGVydHlcIilcclxuICAgICAgLnNldERlc2MoXCJGcm9udG1hdHRlciBwcm9wZXJ0eSB3aGVyZSBwZXItc3VidGFzayBjb21wbGV0aW9uIGRhdGVzIGFyZSBzdG9yZWQuXCIpXHJcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxyXG4gICAgICAgIHRleHRcclxuICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcihcInN1YnRhc2tFbnRyaWVzXCIpXHJcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3Muc3VidGFza0VudHJpZXNQcm9wZXJ0eSlcclxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcclxuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Muc3VidGFza0VudHJpZXNQcm9wZXJ0eSA9XHJcbiAgICAgICAgICAgICAgdmFsdWUudHJpbSgpIHx8IFwic3VidGFza0VudHJpZXNcIjtcclxuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgICB9KVxyXG4gICAgICApO1xyXG5cclxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxyXG4gICAgICAuc2V0TmFtZShcIlJlc2V0IGFsbCB0cmFja2luZyBkYXRhXCIpXHJcbiAgICAgIC5zZXREZXNjKFxyXG4gICAgICAgIFwiUGVybWFuZW50bHkgZGVsZXRlIGhhYml0IGFuZCBzdWJ0YXNrIGNvbXBsZXRpb24gaGlzdG9yeSBmcm9tIGV2ZXJ5IE1hcmtkb3duIGZpbGUgaW4gdGhpcyB2YXVsdC5cIlxyXG4gICAgICApXHJcbiAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cclxuICAgICAgICBidXR0b25cclxuICAgICAgICAgIC5zZXRCdXR0b25UZXh0KFwiUmVzZXQgdHJhY2tpbmcgZGF0YVwiKVxyXG4gICAgICAgICAgLnNldFdhcm5pbmcoKVxyXG4gICAgICAgICAgLm9uQ2xpY2soKCkgPT4gbmV3IFJlc2V0VHJhY2tpbmdEYXRhTW9kYWwodGhpcy5hcHAsIHRoaXMucGx1Z2luKS5vcGVuKCkpXHJcbiAgICAgICk7XHJcbiAgfVxyXG59XHJcbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsc0JBY087QUFXUCxJQUFNLG1CQUEyQztBQUFBLEVBQy9DLGdCQUFnQjtBQUFBLEVBQ2hCLHNCQUFzQjtBQUFBLEVBQ3RCLGlCQUFpQjtBQUFBLEVBQ2pCLGlCQUFpQjtBQUFBLEVBQ2pCLGtCQUFrQjtBQUFBLEVBQ2xCLHdCQUF3QjtBQUMxQjtBQUVBLElBQU0sY0FBYztBQTJCcEIsU0FBUyxRQUFRLE1BQWMsU0FBaUM7QUFDOUQsU0FBTyxXQUFXLFFBQVEsWUFBWSxLQUFLLE9BQU8sY0FBYyxVQUFVO0FBQzVFO0FBRUEsU0FBUyxtQkFBbUIsS0FBa0I7QUFDNUMsUUFBTSxTQUFTO0FBQ2YsTUFBSTtBQUNGLFVBQU0sS0FBSyxPQUFPLGlCQUFpQixnQkFBZ0IsYUFBYTtBQUNoRSxVQUFNLE1BQU0sSUFBSSxVQUFVLFNBQVM7QUFDbkMsUUFBSTtBQUFLLGFBQU87QUFBQSxFQUNsQixTQUFTLEdBQUc7QUFBQSxFQUVaO0FBQ0EsTUFBSTtBQUNGLFVBQU0sS0FBSyxPQUFPLFNBQVMsWUFBWSxnQkFBZ0I7QUFDdkQsVUFBTSxNQUFNLElBQUksVUFBVSxPQUFPO0FBQ2pDLFFBQUk7QUFBSyxhQUFPO0FBQUEsRUFDbEIsU0FBUyxHQUFHO0FBQUEsRUFFWjtBQUNBLFNBQU87QUFDVDtBQUVBLElBQXFCLHdCQUFyQixNQUFxQiw4QkFBNkIsdUJBQU87QUFBQSxFQUF6RDtBQUFBO0FBbUhFO0FBQUE7QUFBQTtBQUFBLFNBQVEsa0JBQWtCLG9CQUFJLElBQXFDO0FBQ25FLFNBQVEsV0FBVztBQUFBO0FBQUEsRUFqSG5CLE1BQU0sU0FBUztBQUNiLFVBQU0sS0FBSyxhQUFhO0FBRXhCLFNBQUs7QUFBQSxNQUNIO0FBQUEsTUFDQSxDQUFDLFFBQVEsSUFBSSxRQUFRLEtBQUssZUFBZSxJQUFJLEdBQUc7QUFBQSxJQUNsRDtBQUVBLFNBQUssV0FBVztBQUFBLE1BQ2QsSUFBSTtBQUFBLE1BQ0osTUFBTTtBQUFBLE1BQ04sZ0JBQWdCLENBQUMsUUFBZ0IsVUFBd0I7QUFDdkQsZUFBTyxpQkFBaUIsb0JBQW9CO0FBQUEsTUFDOUM7QUFBQSxJQUNGLENBQUM7QUFFRCxTQUFLLGNBQWMsSUFBSSx5QkFBeUIsS0FBSyxLQUFLLElBQUksQ0FBQztBQUFBLEVBQ2pFO0FBQUEsRUFFQSxNQUFNLGVBQWU7QUFDbkIsU0FBSyxXQUFXLE9BQU8sT0FBTyxDQUFDLEdBQUcsa0JBQWtCLE1BQU0sS0FBSyxTQUFTLENBQUM7QUFBQSxFQUMzRTtBQUFBLEVBRUEsTUFBTSxlQUFlO0FBQ25CLFVBQU0sS0FBSyxTQUFTLEtBQUssUUFBUTtBQUFBLEVBQ25DO0FBQUEsRUFFUSx3QkFBa0M7QUFDeEMsV0FBTztBQUFBLE1BQ0wsS0FBSyxTQUFTO0FBQUEsTUFDZCxLQUFLLFNBQVM7QUFBQSxJQUNoQixFQUFFLE9BQU8sQ0FBQyxNQUFNLE9BQU8sVUFBVSxLQUFLLFNBQVMsS0FBSyxNQUFNLFFBQVEsSUFBSSxNQUFNLEtBQUs7QUFBQSxFQUNuRjtBQUFBLEVBRUEsTUFBTSxvQkFBa0Q7QUFDdEQsVUFBTSxhQUFhLEtBQUssc0JBQXNCO0FBQzlDLFVBQU0sUUFBUSxLQUFLLElBQUksTUFBTSxpQkFBaUIsRUFBRSxPQUFPLENBQUMsU0FBUztBQUMvRCxZQUFNLGNBQWMsS0FBSyxJQUFJLGNBQWMsYUFBYSxJQUFJLEdBQUc7QUFDL0QsYUFDRSxlQUFlLFFBQ2YsV0FBVztBQUFBLFFBQUssQ0FBQyxhQUNmLE9BQU8sVUFBVSxlQUFlLEtBQUssYUFBYSxRQUFRO0FBQUEsTUFDNUQ7QUFBQSxJQUVKLENBQUM7QUFFRCxRQUFJLGVBQWU7QUFDbkIsUUFBSSxvQkFBb0I7QUFDeEIsVUFBTSxjQUF3QixDQUFDO0FBRS9CLGVBQVcsUUFBUSxPQUFPO0FBQ3hCLFVBQUksa0JBQWtCO0FBQ3RCLFVBQUk7QUFDRixjQUFNLEtBQUssSUFBSSxZQUFZLG1CQUFtQixNQUFNLENBQUMsZ0JBQWdCO0FBQ25FLHFCQUFXLFlBQVksWUFBWTtBQUNqQyxnQkFBSSxDQUFDLE9BQU8sVUFBVSxlQUFlLEtBQUssYUFBYSxRQUFRO0FBQzdEO0FBQ0YsbUJBQU8sWUFBWSxRQUFRO0FBQzNCLCtCQUFtQjtBQUFBLFVBQ3JCO0FBQUEsUUFDRixDQUFDO0FBQ0QsWUFBSSxrQkFBa0IsR0FBRztBQUN2QiwwQkFBZ0I7QUFDaEIsK0JBQXFCO0FBQUEsUUFDdkI7QUFBQSxNQUNGLFNBQVMsT0FBTztBQUNkLG9CQUFZLEtBQUssS0FBSyxJQUFJO0FBQzFCLGdCQUFRO0FBQUEsVUFDTixxREFBcUQsS0FBSyxJQUFJO0FBQUEsVUFDOUQ7QUFBQSxRQUNGO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFFQSxXQUFPLEVBQUUsY0FBYyxtQkFBbUIsWUFBWTtBQUFBLEVBQ3hEO0FBQUE7QUFBQTtBQUFBLEVBSUEsZUFBK0I7QUFDN0IsVUFBTSxPQUFPLEtBQUssU0FBUztBQUMzQixVQUFNLFlBQVksS0FBSyxJQUFJLE1BQU0sUUFBUTtBQUN6QyxRQUFJLFNBQVMsT0FBTyxTQUFTLFVBQVU7QUFBTSxhQUFPO0FBQ3BELFVBQU0sU0FBUyxLQUFLLElBQUksTUFBTSxzQkFBc0IsSUFBSTtBQUN4RCxXQUFPLGtCQUFrQiwwQkFBVSxTQUFTO0FBQUEsRUFDOUM7QUFBQTtBQUFBO0FBQUEsRUFJQSxpQkFBMkI7QUFDekIsVUFBTSxNQUFnQixDQUFDO0FBQ3ZCLFVBQU0sT0FBTyxDQUFDLFdBQW9CO0FBQ2hDLFVBQUksS0FBSyxPQUFPLElBQUk7QUFDcEIsWUFBTSxPQUFPLE9BQU8sU0FDakIsT0FBTyxDQUFDLE1BQW9CLGFBQWEsdUJBQU8sRUFDaEQsS0FBSyxDQUFDLEdBQUcsTUFBTSxFQUFFLEtBQUssY0FBYyxFQUFFLElBQUksQ0FBQztBQUM5QyxpQkFBVyxPQUFPO0FBQU0sYUFBSyxHQUFHO0FBQUEsSUFDbEM7QUFDQSxTQUFLLEtBQUssSUFBSSxNQUFNLFFBQVEsQ0FBQztBQUM3QixXQUFPO0FBQUEsRUFDVDtBQUFBLEVBRVEsWUFBWSxNQUFzQjtBQUN4QyxRQUFJLENBQUMsS0FBSyxTQUFTO0FBQXNCLGFBQU87QUFDaEQsVUFBTSxtQkFBbUIsS0FBSyxRQUFRLGtCQUFrQixFQUFFO0FBQzFELFdBQU8sb0JBQW9CO0FBQUEsRUFDN0I7QUFBQSxFQVNRLGNBQXNCO0FBQzVCLFNBQUssWUFBWTtBQUNqQixXQUFPLFlBQVksS0FBSyxRQUFRO0FBQUEsRUFDbEM7QUFBQTtBQUFBO0FBQUEsRUFJUSxzQkFDTixJQUNBLEtBQ0EsVUFDQTtBQUNBLFNBQUssZ0JBQWdCLElBQUksUUFBUTtBQUNqQyxVQUFNLFFBQVEsSUFBSSxvQ0FBb0IsRUFBRTtBQUN4QyxVQUFNLFNBQVMsTUFBTSxLQUFLLGdCQUFnQixPQUFPLFFBQVEsQ0FBQztBQUMxRCxRQUFJLFNBQVMsS0FBSztBQUFBLEVBQ3BCO0FBQUEsRUFFUSxrQkFBa0IsR0FBdUI7QUFDL0MsZUFBVyxZQUFZLENBQUMsR0FBRyxLQUFLLGVBQWUsR0FBRztBQUNoRCxVQUFJO0FBQ0YsaUJBQVMsQ0FBQztBQUFBLE1BQ1osU0FBUyxLQUFLO0FBQ1osZ0JBQVEsTUFBTSx5Q0FBeUMsR0FBRztBQUFBLE1BQzVEO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFBQSxFQUVRLGlCQUFpQixLQUF3QjtBQUMvQyxRQUFJLE9BQU87QUFBTSxhQUFPLENBQUM7QUFDekIsUUFBSSxNQUFNLFFBQVEsR0FBRztBQUFHLGFBQU8sSUFBSSxJQUFJLENBQUMsTUFBTSxPQUFPLENBQUMsQ0FBQztBQUN2RCxXQUFPLENBQUMsT0FBTyxHQUFHLENBQUM7QUFBQSxFQUNyQjtBQUFBLEVBRVEsWUFBWSxZQUFzRDtBQUN4RSxVQUFNLFFBQVEsV0FBVyxNQUFNLEdBQUcsRUFBRSxJQUFJLEtBQUssSUFBSSxRQUFRLFNBQVMsRUFBRTtBQUNwRSxVQUFNLE1BQU0sbUJBQW1CLEtBQUssR0FBRztBQUN2QyxVQUFNLFFBQUksd0JBQU8sTUFBTSxLQUFLLElBQUk7QUFDaEMsV0FBTyxFQUFFLFFBQVEsSUFBSSxJQUFJO0FBQUEsRUFDM0I7QUFBQSxFQUVRLFVBQVUsTUFBYSxTQUEwQjtBQUN2RCxVQUFNLEtBQUssS0FBSyxJQUFJLGNBQWMsYUFBYSxJQUFJLEdBQUc7QUFDdEQsVUFBTSxVQUFVLEtBQUssaUJBQWlCLEtBQUssS0FBSyxTQUFTLGVBQWUsQ0FBQztBQUN6RSxXQUFPLFFBQVEsU0FBUyxPQUFPO0FBQUEsRUFDakM7QUFBQSxFQUVRLFlBQVksTUFBdUI7QUFDekMsVUFBTSxLQUFLLEtBQUssSUFBSSxjQUFjLGFBQWEsSUFBSSxHQUFHO0FBQ3RELFdBQU8sS0FBSyxpQkFBaUIsS0FBSyxLQUFLLFNBQVMsZ0JBQWdCLENBQUMsRUFDOUQsSUFBSSxDQUFDLE1BQU0sRUFBRSxLQUFLLENBQUMsRUFDbkIsT0FBTyxDQUFDLE1BQU0sRUFBRSxTQUFTLENBQUM7QUFBQSxFQUMvQjtBQUFBLEVBRVEsd0JBQXdCLEtBQXdDO0FBQ3RFLFVBQU0sTUFBZ0MsQ0FBQztBQUN2QyxRQUFJLE9BQU8sUUFBUSxPQUFPLFFBQVEsWUFBWSxNQUFNLFFBQVEsR0FBRztBQUFHLGFBQU87QUFDekUsZUFBVyxDQUFDLEtBQUssQ0FBQyxLQUFLLE9BQU8sUUFBUSxHQUE4QixHQUFHO0FBQ3JFLFVBQUksR0FBRyxJQUFJLEtBQUssaUJBQWlCLENBQUM7QUFBQSxJQUNwQztBQUNBLFdBQU87QUFBQSxFQUNUO0FBQUEsRUFFUSxpQkFBaUIsTUFBYSxNQUFjLFNBQTBCO0FBQzVFLFVBQU0sS0FBSyxLQUFLLElBQUksY0FBYyxhQUFhLElBQUksR0FBRztBQUN0RCxVQUFNLE1BQU0sS0FBSyx3QkFBd0IsS0FBSyxLQUFLLFNBQVMsc0JBQXNCLENBQUM7QUFDbkYsWUFBUSxJQUFJLElBQUksS0FBSyxDQUFDLEdBQUcsU0FBUyxPQUFPO0FBQUEsRUFDM0M7QUFBQSxFQUVBLE1BQWMsd0JBQ1osTUFDQSxVQUNtQztBQUNuQyxVQUFNLGNBQWMsS0FBSyxTQUFTO0FBQ2xDLFVBQU0sVUFBVSxLQUFLLFNBQVM7QUFFOUIsVUFBTSxLQUFLLEtBQUssSUFBSSxjQUFjLGFBQWEsSUFBSSxHQUFHO0FBQ3RELFVBQU0sY0FBYyxLQUFLLGlCQUFpQixLQUFLLFdBQVcsQ0FBQztBQUMzRCxVQUFNLFVBQVUsS0FBSyx3QkFBd0IsS0FBSyxPQUFPLENBQUM7QUFFMUQsVUFBTSxXQUFxQyxDQUFDO0FBQzVDLFFBQUksVUFBVTtBQUNkLGVBQVcsUUFBUSxVQUFVO0FBQzNCLFlBQU0sTUFBTSxJQUFJLElBQUksUUFBUSxJQUFJLEtBQUssQ0FBQyxDQUFDO0FBQ3ZDLFlBQU0sU0FBUyxJQUFJO0FBQ25CLGlCQUFXLEtBQUs7QUFBYSxZQUFJLElBQUksQ0FBQztBQUN0QyxVQUFJLElBQUksU0FBUztBQUFRLGtCQUFVO0FBQ25DLGVBQVMsSUFBSSxJQUFJLENBQUMsR0FBRyxHQUFHLEVBQUUsS0FBSztBQUFBLElBQ2pDO0FBRUEsUUFBSSxTQUFTO0FBQ1gsWUFBTSxLQUFLLElBQUksWUFBWSxtQkFBbUIsTUFBTSxDQUFDLFFBQVE7QUFDM0QsY0FBTSxTQUFTLEtBQUssaUJBQWlCLElBQUksV0FBVyxDQUFDO0FBQ3JELGNBQU0sTUFBTSxLQUFLLHdCQUF3QixJQUFJLE9BQU8sQ0FBQztBQUNyRCxtQkFBVyxRQUFRLFVBQVU7QUFDM0IsZ0JBQU0sTUFBTSxJQUFJLElBQUksSUFBSSxJQUFJLEtBQUssQ0FBQyxDQUFDO0FBQ25DLHFCQUFXLEtBQUs7QUFBUSxnQkFBSSxJQUFJLENBQUM7QUFDakMsY0FBSSxJQUFJLElBQUksQ0FBQyxHQUFHLEdBQUcsRUFBRSxLQUFLO0FBQUEsUUFDNUI7QUFDQSxZQUFJLE9BQU8sSUFBSTtBQUFBLE1BQ2pCLENBQUM7QUFBQSxJQUNIO0FBRUEsV0FBTztBQUFBLEVBQ1Q7QUFBQSxFQUVBLE1BQWMsU0FBUyxNQUFhLFNBQWlCLFNBQWtCO0FBQ3JFLFVBQU0sT0FBTyxLQUFLLFNBQVM7QUFDM0IsVUFBTSxLQUFLLElBQUksWUFBWSxtQkFBbUIsTUFBTSxDQUFDLE9BQU87QUFDMUQsVUFBSSxVQUFVLEtBQUssaUJBQWlCLEdBQUcsSUFBSSxDQUFDO0FBQzVDLFVBQUksU0FBUztBQUNYLFlBQUksQ0FBQyxRQUFRLFNBQVMsT0FBTztBQUFHLGtCQUFRLEtBQUssT0FBTztBQUFBLE1BQ3RELE9BQU87QUFDTCxrQkFBVSxRQUFRLE9BQU8sQ0FBQyxNQUFNLE1BQU0sT0FBTztBQUFBLE1BQy9DO0FBQ0EsY0FBUSxLQUFLO0FBQ2IsU0FBRyxJQUFJLElBQUk7QUFBQSxJQUNiLENBQUM7QUFBQSxFQUNIO0FBQUEsRUFFQSxNQUFjLGdCQUNaLE1BQ0EsTUFDQSxTQUNBLFNBQ0EsYUFDa0I7QUFDbEIsVUFBTSxjQUFjLEtBQUssU0FBUztBQUNsQyxVQUFNLFVBQVUsS0FBSyxTQUFTO0FBQzlCLFFBQUksZ0JBQWdCO0FBQ3BCLFVBQU0sS0FBSyxJQUFJLFlBQVksbUJBQW1CLE1BQU0sQ0FBQyxPQUFPO0FBQzFELFlBQU0sTUFBTSxLQUFLLHdCQUF3QixHQUFHLE9BQU8sQ0FBQztBQUNwRCxVQUFJLFFBQVEsSUFBSSxJQUFJLEtBQUssQ0FBQztBQUMxQixVQUFJLFNBQVM7QUFDWCxZQUFJLENBQUMsTUFBTSxTQUFTLE9BQU87QUFBRyxnQkFBTSxLQUFLLE9BQU87QUFBQSxNQUNsRCxPQUFPO0FBQ0wsZ0JBQVEsTUFBTSxPQUFPLENBQUMsTUFBTSxNQUFNLE9BQU87QUFBQSxNQUMzQztBQUNBLFlBQU0sS0FBSztBQUNYLFVBQUksSUFBSSxJQUFJO0FBRVosWUFBTSxVQUFVLFlBQVksTUFBTSxDQUFDLE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLFNBQVMsT0FBTyxDQUFDO0FBQ3pFLHNCQUFnQjtBQUNoQixVQUFJLFVBQVUsS0FBSyxpQkFBaUIsR0FBRyxXQUFXLENBQUM7QUFDbkQsVUFBSSxTQUFTO0FBQ1gsWUFBSSxDQUFDLFFBQVEsU0FBUyxPQUFPO0FBQUcsa0JBQVEsS0FBSyxPQUFPO0FBQUEsTUFDdEQsT0FBTztBQUNMLGtCQUFVLFFBQVEsT0FBTyxDQUFDLE1BQU0sTUFBTSxPQUFPO0FBQUEsTUFDL0M7QUFDQSxjQUFRLEtBQUs7QUFDYixTQUFHLFdBQVcsSUFBSTtBQUVsQixVQUFJLE9BQU8sS0FBSyxHQUFHLEVBQUUsV0FBVyxHQUFHO0FBQ2pDLGVBQU8sR0FBRyxPQUFPO0FBQUEsTUFDbkIsT0FBTztBQUNMLFdBQUcsT0FBTyxJQUFJO0FBQUEsTUFDaEI7QUFBQSxJQUNGLENBQUM7QUFDRCxXQUFPO0FBQUEsRUFDVDtBQUFBLEVBRUEsTUFBYyxtQkFDWixNQUNBLFNBQ0EsU0FDQSxhQUNBO0FBQ0EsVUFBTSxjQUFjLEtBQUssU0FBUztBQUNsQyxVQUFNLFVBQVUsS0FBSyxTQUFTO0FBQzlCLFVBQU0sS0FBSyxJQUFJLFlBQVksbUJBQW1CLE1BQU0sQ0FBQyxPQUFPO0FBQzFELFlBQU0sTUFBTSxLQUFLLHdCQUF3QixHQUFHLE9BQU8sQ0FBQztBQUNwRCxpQkFBVyxRQUFRLGFBQWE7QUFDOUIsWUFBSSxRQUFRLElBQUksSUFBSSxLQUFLLENBQUM7QUFDMUIsWUFBSSxTQUFTO0FBQ1gsY0FBSSxDQUFDLE1BQU0sU0FBUyxPQUFPO0FBQUcsa0JBQU0sS0FBSyxPQUFPO0FBQUEsUUFDbEQsT0FBTztBQUNMLGtCQUFRLE1BQU0sT0FBTyxDQUFDLE1BQU0sTUFBTSxPQUFPO0FBQUEsUUFDM0M7QUFDQSxjQUFNLEtBQUs7QUFDWCxZQUFJLElBQUksSUFBSTtBQUFBLE1BQ2Q7QUFFQSxVQUFJLFVBQVUsS0FBSyxpQkFBaUIsR0FBRyxXQUFXLENBQUM7QUFDbkQsVUFBSSxTQUFTO0FBQ1gsWUFBSSxDQUFDLFFBQVEsU0FBUyxPQUFPO0FBQUcsa0JBQVEsS0FBSyxPQUFPO0FBQUEsTUFDdEQsT0FBTztBQUNMLGtCQUFVLFFBQVEsT0FBTyxDQUFDLE1BQU0sTUFBTSxPQUFPO0FBQUEsTUFDL0M7QUFDQSxjQUFRLEtBQUs7QUFDYixTQUFHLFdBQVcsSUFBSTtBQUVsQixVQUFJLE9BQU8sS0FBSyxHQUFHLEVBQUUsV0FBVyxHQUFHO0FBQ2pDLGVBQU8sR0FBRyxPQUFPO0FBQUEsTUFDbkIsT0FBTztBQUNMLFdBQUcsT0FBTyxJQUFJO0FBQUEsTUFDaEI7QUFBQSxJQUNGLENBQUM7QUFBQSxFQUNIO0FBQUEsRUFFQSxNQUFjLGVBQWUsSUFBaUIsS0FBbUM7QUFDL0UsT0FBRyxNQUFNO0FBRVQsVUFBTSxPQUFPLEtBQUssYUFBYTtBQUMvQixRQUFJLENBQUMsTUFBTTtBQUNULFNBQUcsVUFBVTtBQUFBLFFBQ1gsS0FBSztBQUFBLFFBQ0wsTUFBTSw0QkFBNEIsS0FBSyxTQUFTLGNBQWM7QUFBQSxNQUNoRSxDQUFDO0FBQ0Q7QUFBQSxJQUNGO0FBRUEsVUFBTSxPQUFPLEtBQUssWUFBWSxJQUFJLFVBQVU7QUFDNUMsUUFBSSxDQUFDLE1BQU07QUFDVCxTQUFHLFVBQVU7QUFBQSxRQUNYLEtBQUs7QUFBQSxRQUNMLE1BQU07QUFBQSxNQUNSLENBQUM7QUFDRDtBQUFBLElBQ0Y7QUFFQSxVQUFNLFVBQVUsS0FBSyxPQUFPLEtBQUssU0FBUyxtQkFBbUIsWUFBWTtBQUN6RSxVQUFNLFlBQVksR0FBRyxVQUFVO0FBQUEsTUFDN0IsS0FBSztBQUFBLElBQ1AsQ0FBQztBQUVELFVBQU0sVUFBVSxVQUFVLFVBQVU7QUFBQSxNQUNsQyxLQUFLO0FBQUEsSUFDUCxDQUFDO0FBQ0QsVUFBTSxPQUFPLFFBQVEsVUFBVSxFQUFFLEtBQUssdUJBQXVCLENBQUM7QUFDOUQsVUFBTSxPQUFrQixFQUFFLElBQUksS0FBSyxZQUFZLEdBQUcsU0FBUyxvQkFBSSxJQUFJLEVBQUU7QUFDckUsVUFBTSxLQUFLLGFBQWEsTUFBTSxNQUFNLFNBQVMsR0FBRyxJQUFJO0FBRXBELFNBQUssc0JBQXNCLElBQUksS0FBSyxDQUFDLE9BQU87QUFDMUMsVUFBSSxHQUFHLGFBQWEsS0FBSyxNQUFNLEdBQUcsWUFBWTtBQUFTO0FBQ3ZELFdBQUssUUFBUSxJQUFJLFFBQVEsR0FBRyxNQUFNLEdBQUcsT0FBTyxDQUFDLElBQUksR0FBRyxPQUFPO0FBQUEsSUFDN0QsQ0FBQztBQUFBLEVBQ0g7QUFBQSxFQUVBLE1BQWMsYUFDWixRQUNBLFdBQ0EsU0FDQSxPQUNBLE1BQ0E7QUFDQSxVQUFNLFdBQVcsQ0FBQyxHQUFHLE9BQU8sUUFBUSxFQUFFO0FBQUEsTUFBSyxDQUFDLEdBQUcsTUFDN0MsRUFBRSxLQUFLLGNBQWMsRUFBRSxJQUFJO0FBQUEsSUFDN0I7QUFDQSxVQUFNLFFBQVEsU0FBUztBQUFBLE1BQ3JCLENBQUMsTUFBa0IsYUFBYSx5QkFBUyxFQUFFLGNBQWM7QUFBQSxJQUMzRDtBQUNBLFVBQU0sYUFBYSxTQUFTO0FBQUEsTUFDMUIsQ0FBQyxNQUFvQixhQUFhO0FBQUEsSUFDcEM7QUFFQSxRQUFJLFFBQVE7QUFDWixlQUFXLFFBQVEsT0FBTztBQUN4QjtBQUNBLFlBQU0sS0FBSyxXQUFXLE1BQU0sV0FBVyxTQUFTLE9BQU8sSUFBSTtBQUFBLElBQzdEO0FBRUEsYUFBUyxlQUFlLEdBQUcsZUFBZSxXQUFXLFFBQVEsZ0JBQWdCO0FBQzNFLFlBQU0sTUFBTSxXQUFXLFlBQVk7QUFDbkMsWUFBTSxVQUFVLFVBQVUsVUFBVSxFQUFFLEtBQUssMEJBQTBCLENBQUM7QUFDdEUsWUFBTSxhQUFhLGVBQWUsc0JBQXFCO0FBQ3ZELGNBQVEsU0FBUyx5QkFBeUIsYUFBYSxDQUFDLEVBQUU7QUFDMUQsWUFBTSxNQUFPLE1BQU0sS0FBSyxJQUFJLE9BQU8sQ0FBQztBQUNwQyxZQUFNLFNBQVMsUUFBUSxTQUFTLEtBQUssRUFBRSxLQUFLLDBCQUEwQixDQUFDO0FBQ3ZFLGFBQU8sV0FBVztBQUFBLFFBQ2hCLEtBQUs7QUFBQSxRQUNMLE1BQU0sS0FBSyxZQUFZLElBQUksSUFBSTtBQUFBLE1BQ2pDLENBQUM7QUFDRCxXQUFLLGVBQWUsTUFBTTtBQUUxQixZQUFNLE9BQU8sUUFBUSxVQUFVLEVBQUUsS0FBSyx1QkFBdUIsQ0FBQztBQUM5RCxZQUFNLEtBQUssYUFBYSxLQUFLLE1BQU0sU0FBUyxRQUFRLEdBQUcsSUFBSTtBQUMzRCxXQUFLLHNCQUFzQixPQUFPO0FBRWxDLGFBQU8saUJBQWlCLFNBQVMsTUFBTTtBQUNyQyxnQkFBUSxZQUFZLGdCQUFnQixDQUFDLFFBQVEsU0FBUyxjQUFjLENBQUM7QUFBQSxNQUN2RSxDQUFDO0FBQUEsSUFDSDtBQUFBLEVBQ0Y7QUFBQSxFQUlRLGVBQWUsUUFBcUI7QUFDMUMsVUFBTSxXQUFXLE9BQU8sVUFBVSxFQUFFLEtBQUssMkJBQTJCLENBQUM7QUFDckUsVUFBTSxRQUFRLFNBQVMsVUFBVSxFQUFFLEtBQUssaUNBQWlDLENBQUM7QUFDMUUsVUFBTSxXQUFXLEVBQUUsS0FBSyxrQ0FBa0MsTUFBTSxXQUFXLENBQUM7QUFDNUUsVUFBTSxXQUFXLEVBQUUsS0FBSyxrQ0FBa0MsTUFBTSxNQUFNLENBQUM7QUFDdkUsVUFBTSxNQUFNLFNBQVMsVUFBVSxFQUFFLEtBQUssK0JBQStCLENBQUM7QUFDdEUsUUFBSSxVQUFVLEVBQUUsS0FBSyxnQ0FBZ0MsQ0FBQztBQUFBLEVBQ3hEO0FBQUEsRUFFUSxzQkFBc0IsU0FBc0I7QUFDbEQsVUFBTSxhQUFhLE1BQU07QUFBQSxNQUN2QixRQUFRLGlCQUFtQyxvQ0FBb0M7QUFBQSxJQUNqRjtBQUNBLFVBQU0sUUFBUSxXQUFXO0FBQ3pCLFVBQU0sT0FBTyxXQUFXLE9BQU8sQ0FBQyxhQUFhLFNBQVMsT0FBTyxFQUFFO0FBQy9ELFVBQU0sV0FBVyxRQUFRO0FBQUEsTUFDdkI7QUFBQSxJQUNGO0FBQ0EsUUFBSSxDQUFDO0FBQVU7QUFFZixVQUFNLFFBQVEsU0FBUyxjQUEyQixpQ0FBaUM7QUFDbkYsUUFBSTtBQUFPLFlBQU0sUUFBUSxHQUFHLElBQUksSUFBSSxLQUFLLEVBQUU7QUFFM0MsVUFBTSxPQUFPLFNBQVMsY0FBMkIsZ0NBQWdDO0FBQ2pGLFVBQU0sUUFBUSxVQUFVLElBQUksSUFBSSxPQUFPO0FBQ3ZDLFFBQUk7QUFBTSxXQUFLLE1BQU0sWUFBWSxpQkFBaUIsR0FBRyxRQUFRLEdBQUcsR0FBRztBQUVuRSxVQUFNLGFBQWEsUUFBUSxLQUFLLFNBQVM7QUFDekMsWUFBUSxZQUFZLGVBQWUsVUFBVTtBQUFBLEVBQy9DO0FBQUEsRUFFUSx1QkFBdUIsTUFBbUI7QUFDaEQsUUFBSSxVQUFVLEtBQUssUUFBcUIsMEJBQTBCO0FBQ2xFLFdBQU8sU0FBUztBQUNkLFdBQUssc0JBQXNCLE9BQU87QUFDbEMsZ0JBQVUsUUFBUSxlQUFlLFFBQXFCLDBCQUEwQixLQUFLO0FBQUEsSUFDdkY7QUFBQSxFQUNGO0FBQUEsRUFFUSxjQUFjLFFBQXFCO0FBQ3pDLFVBQU0sU0FBUyxNQUFNO0FBQ25CLFlBQU0sT0FBTyxPQUFPLFFBQXFCLGtCQUFrQjtBQUMzRCxZQUNJLGlCQUFpQixjQUFjLEVBQ2hDLFFBQVEsQ0FBQyxNQUFNLEVBQUUsWUFBWSxhQUFhLENBQUM7QUFDOUMsYUFBTyxTQUFTLGFBQWE7QUFBQSxJQUMvQjtBQUNBLFdBQU8saUJBQWlCLGVBQWUsTUFBTTtBQUM3QyxXQUFPLGlCQUFpQixXQUFXLE1BQU07QUFBQSxFQUMzQztBQUFBLEVBRUEsTUFBYyxXQUNaLE1BQ0EsV0FDQSxTQUNBLFFBQVEsR0FDUixNQUNBO0FBQ0EsVUFBTSxXQUFXLEtBQUssWUFBWSxJQUFJO0FBQ3RDLFVBQU0sU0FBUyxVQUFVLFVBQVUsRUFBRSxLQUFLLHVCQUF1QixDQUFDO0FBQ2xFLFdBQU8sV0FBVztBQUNsQixTQUFLLGNBQWMsTUFBTTtBQUN6QixVQUFNLFFBQVEsT0FBTyxTQUFTLFNBQVMsRUFBRSxLQUFLLHdCQUF3QixDQUFDO0FBQ3ZFLFFBQUksUUFBUSxLQUFLLENBQUMsS0FBSyxTQUFTLHNCQUFzQjtBQUNwRCxZQUFNLFdBQVc7QUFBQSxRQUNmLEtBQUs7QUFBQSxRQUNMLE1BQU0sT0FBTyxLQUFLLEVBQUUsU0FBUyxHQUFHLEdBQUc7QUFBQSxNQUNyQyxDQUFDO0FBQUEsSUFDSDtBQUNBLFVBQU0sV0FBVyxNQUFNLFNBQVMsU0FBUztBQUFBLE1BQ3ZDLE1BQU07QUFBQSxJQUNSLENBQUM7QUFDRCxhQUFTLFVBQVUsSUFBSSwwQkFBMEI7QUFDakQsVUFBTSxXQUFXO0FBQUEsTUFDZixNQUFNLEtBQUssWUFBWSxLQUFLLFFBQVE7QUFBQSxNQUNwQyxLQUFLO0FBQUEsSUFDUCxDQUFDO0FBRUQsUUFBSSxTQUFTLFdBQVcsR0FBRztBQUN6QixlQUFTLFVBQVUsSUFBSSxtQ0FBbUM7QUFDMUQsZUFBUyxVQUFVLEtBQUssVUFBVSxNQUFNLE9BQU87QUFDL0MsYUFBTyxZQUFZLGNBQWMsU0FBUyxPQUFPO0FBRWpELFlBQU0sUUFBUSxJQUFJLEtBQUssTUFBTSxDQUFDLFlBQVk7QUFDeEMsWUFBSSxTQUFTLFlBQVk7QUFBUztBQUNsQyxpQkFBUyxVQUFVO0FBQ25CLGVBQU8sWUFBWSxjQUFjLE9BQU87QUFDeEMsYUFBSyx1QkFBdUIsTUFBTTtBQUFBLE1BQ3BDLENBQUM7QUFFRCxlQUFTLGlCQUFpQixVQUFVLFlBQVk7QUFDOUMsY0FBTSxTQUFTLFNBQVM7QUFDeEIsaUJBQVMsV0FBVztBQUNwQixZQUFJO0FBQ0YsZ0JBQU0sS0FBSyxTQUFTLE1BQU0sU0FBUyxNQUFNO0FBQ3pDLGlCQUFPLFlBQVksY0FBYyxNQUFNO0FBQ3ZDLGVBQUssa0JBQWtCO0FBQUEsWUFDckI7QUFBQSxZQUNBLE1BQU0sS0FBSztBQUFBLFlBQ1gsU0FBUztBQUFBLFlBQ1QsU0FBUztBQUFBLFlBQ1QsZUFBZTtBQUFBLFlBQ2YsVUFBVSxDQUFDO0FBQUEsWUFDWCxVQUFVLE1BQU0sTUFBTTtBQUFBLFVBQ3hCLENBQUM7QUFBQSxRQUNILFNBQVMsR0FBRztBQUNWLGtCQUFRLE1BQU0saURBQWlELENBQUM7QUFDaEUsY0FBSSx1QkFBTyxxQ0FBcUMsS0FBSyxRQUFRLEVBQUU7QUFDL0QsbUJBQVMsVUFBVSxDQUFDO0FBQUEsUUFDdEIsVUFBRTtBQUNBLG1CQUFTLFdBQVc7QUFDcEIsZUFBSyx1QkFBdUIsTUFBTTtBQUFBLFFBQ3BDO0FBQUEsTUFDRixDQUFDO0FBQ0Q7QUFBQSxJQUNGO0FBRUEsYUFBUyxVQUFVLElBQUksaUNBQWlDO0FBRXhELFVBQU0sZUFBZSxVQUFVLFVBQVUsRUFBRSxLQUFLLDJCQUEyQixDQUFDO0FBQzVFLFVBQU0sU0FBMEUsQ0FBQztBQUVqRixVQUFNLGdCQUFnQixNQUFNO0FBQzFCLFlBQU0sYUFBYSxPQUFPLE1BQU0sQ0FBQyxNQUFNLEVBQUUsU0FBUyxPQUFPO0FBQ3pELGVBQVMsVUFBVTtBQUNuQixhQUFPLFlBQVksY0FBYyxVQUFVO0FBQUEsSUFDN0M7QUFFQSxVQUFNLGlCQUFpQixDQUFDLGFBQXNCO0FBQzVDLGVBQVMsV0FBVztBQUNwQixpQkFBVyxLQUFLO0FBQVEsVUFBRSxTQUFTLFdBQVc7QUFBQSxJQUNoRDtBQUVBLFVBQU0sV0FBVyxNQUFNLEtBQUssd0JBQXdCLE1BQU0sUUFBUTtBQUVsRSxhQUFTLFFBQVEsQ0FBQyxNQUFNLGFBQWE7QUFDbkMsWUFBTSxVQUFVLGFBQWEsVUFBVSxFQUFFLEtBQUssMEJBQTBCLENBQUM7QUFDekUsY0FBUSxXQUFXO0FBQ25CLFdBQUssY0FBYyxPQUFPO0FBQzFCLFVBQUksYUFBYSxTQUFTLFNBQVM7QUFBRyxnQkFBUSxTQUFTLFNBQVM7QUFDaEUsWUFBTSxXQUFXLFFBQVEsU0FBUyxTQUFTLEVBQUUsS0FBSyx3QkFBd0IsQ0FBQztBQUMzRSxlQUFTLFdBQVcsRUFBRSxLQUFLLHdCQUF3QixNQUFNLEdBQUcsQ0FBQztBQUM3RCxZQUFNLGNBQWMsU0FBUyxTQUFTLFNBQVM7QUFBQSxRQUM3QyxNQUFNO0FBQUEsTUFDUixDQUFDO0FBQ0Qsa0JBQVksVUFBVSxJQUFJLDRCQUE0QixtQ0FBbUM7QUFDekYsa0JBQVksV0FBVyxTQUFTLElBQUksS0FBSyxDQUFDLEdBQUcsU0FBUyxPQUFPO0FBQzdELGVBQVMsV0FBVyxFQUFFLE1BQU0sTUFBTSxLQUFLLHVCQUF1QixDQUFDO0FBQy9ELGNBQVEsWUFBWSxjQUFjLFlBQVksT0FBTztBQUNyRCxhQUFPLEtBQUssRUFBRSxNQUFNLElBQUksU0FBUyxVQUFVLFlBQVksQ0FBQztBQUV4RCxZQUFNLFFBQVEsSUFBSSxRQUFRLEtBQUssTUFBTSxJQUFJLEdBQUcsQ0FBQyxZQUFZO0FBQ3ZELFlBQUksWUFBWSxZQUFZO0FBQVM7QUFDckMsb0JBQVksVUFBVTtBQUN0QixnQkFBUSxZQUFZLGNBQWMsT0FBTztBQUN6QyxzQkFBYztBQUNkLGFBQUssdUJBQXVCLE9BQU87QUFBQSxNQUNyQyxDQUFDO0FBRUQsa0JBQVksaUJBQWlCLFVBQVUsWUFBWTtBQUNqRCxjQUFNLFNBQVMsWUFBWTtBQUMzQix1QkFBZSxJQUFJO0FBQ25CLFlBQUk7QUFDRixnQkFBTSxnQkFBZ0IsTUFBTSxLQUFLO0FBQUEsWUFDL0I7QUFBQSxZQUNBO0FBQUEsWUFDQTtBQUFBLFlBQ0E7QUFBQSxZQUNBO0FBQUEsVUFDRjtBQUNBLGtCQUFRLFlBQVksY0FBYyxNQUFNO0FBQ3hDLHdCQUFjO0FBQ2QsZUFBSyxrQkFBa0I7QUFBQSxZQUNyQjtBQUFBLFlBQ0EsTUFBTSxLQUFLO0FBQUEsWUFDWCxTQUFTO0FBQUEsWUFDVCxTQUFTO0FBQUEsWUFDVDtBQUFBLFlBQ0E7QUFBQSxZQUNBLFVBQVUsTUFBTSxNQUFNO0FBQUEsVUFDeEIsQ0FBQztBQUFBLFFBQ0gsU0FBUyxHQUFHO0FBQ1Ysa0JBQVEsTUFBTSxpREFBaUQsQ0FBQztBQUNoRSxjQUFJLHVCQUFPLHFDQUFxQyxLQUFLLFFBQVEsRUFBRTtBQUMvRCxzQkFBWSxVQUFVLENBQUM7QUFBQSxRQUN6QixVQUFFO0FBQ0EseUJBQWUsS0FBSztBQUNwQixlQUFLLHVCQUF1QixPQUFPO0FBQUEsUUFDckM7QUFBQSxNQUNGLENBQUM7QUFBQSxJQUNILENBQUM7QUFFRCxrQkFBYztBQUVkLFVBQU0sUUFBUSxJQUFJLEtBQUssTUFBTSxDQUFDLFlBQVk7QUFDeEMsZUFBUyxVQUFVO0FBQ25CLGFBQU8sWUFBWSxjQUFjLE9BQU87QUFDeEMsaUJBQVcsS0FBSyxRQUFRO0FBQ3RCLFVBQUUsU0FBUyxVQUFVO0FBQ3JCLFVBQUUsR0FBRyxZQUFZLGNBQWMsT0FBTztBQUFBLE1BQ3hDO0FBQ0EsV0FBSyx1QkFBdUIsTUFBTTtBQUFBLElBQ3BDLENBQUM7QUFFRCxhQUFTLGlCQUFpQixVQUFVLFlBQVk7QUFDOUMsWUFBTSxTQUFTLFNBQVM7QUFDeEIscUJBQWUsSUFBSTtBQUNuQixVQUFJO0FBQ0YsY0FBTSxLQUFLLG1CQUFtQixNQUFNLFNBQVMsUUFBUSxRQUFRO0FBQzdELGVBQU8sWUFBWSxjQUFjLE1BQU07QUFDdkMsbUJBQVcsS0FBSyxRQUFRO0FBQ3RCLFlBQUUsU0FBUyxVQUFVO0FBQ3JCLFlBQUUsR0FBRyxZQUFZLGNBQWMsTUFBTTtBQUFBLFFBQ3ZDO0FBQ0EsYUFBSyxrQkFBa0I7QUFBQSxVQUNyQjtBQUFBLFVBQ0EsTUFBTSxLQUFLO0FBQUEsVUFDWCxTQUFTO0FBQUEsVUFDVCxTQUFTO0FBQUEsVUFDVCxlQUFlO0FBQUEsVUFDZjtBQUFBLFVBQ0EsVUFBVSxNQUFNLE1BQU07QUFBQSxRQUN4QixDQUFDO0FBQUEsTUFDSCxTQUFTLEdBQUc7QUFDVixnQkFBUSxNQUFNLGlEQUFpRCxDQUFDO0FBQ2hFLFlBQUksdUJBQU8scUNBQXFDLEtBQUssUUFBUSxFQUFFO0FBQy9ELGlCQUFTLFVBQVUsQ0FBQztBQUFBLE1BQ3RCLFVBQUU7QUFDQSx1QkFBZSxLQUFLO0FBQ3BCLGFBQUssdUJBQXVCLE1BQU07QUFBQSxNQUNwQztBQUFBLElBQ0YsQ0FBQztBQUFBLEVBQ0g7QUFFRjtBQTluQnFCLHNCQWtaSyxpQkFBaUI7QUFsWjNDLElBQXFCLHVCQUFyQjtBQWdvQkEsSUFBTSx5QkFBTixjQUFxQyxzQkFBTTtBQUFBLEVBR3pDLFlBQVksS0FBVSxRQUE4QjtBQUNsRCxVQUFNLEdBQUc7QUFDVCxTQUFLLFNBQVM7QUFBQSxFQUNoQjtBQUFBLEVBRUEsU0FBZTtBQUNiLFNBQUssU0FBUywwQkFBMEI7QUFDeEMsU0FBSyxVQUFVLFNBQVMsS0FBSztBQUFBLE1BQzNCLE1BQU07QUFBQSxJQUNSLENBQUM7QUFDRCxTQUFLLFVBQVUsU0FBUyxLQUFLO0FBQUEsTUFDM0IsTUFBTTtBQUFBLElBQ1IsQ0FBQztBQUVELFFBQUksZUFBeUM7QUFDN0MsUUFBSSx3QkFBUSxLQUFLLFNBQVMsRUFDdkIsVUFBVSxDQUFDLFdBQVc7QUFDckIscUJBQWUsT0FBTztBQUN0QixhQUFPLGNBQWMsUUFBUSxFQUFFLFFBQVEsTUFBTSxLQUFLLE1BQU0sQ0FBQztBQUFBLElBQzNELENBQUMsRUFDQTtBQUFBLE1BQVUsQ0FBQyxXQUNWLE9BQ0csY0FBYyxxQkFBcUIsRUFDbkMsV0FBVyxFQUNYLFFBQVEsWUFBWTtBQUNuQixlQUFPLFlBQVksSUFBSSxFQUFFLGNBQWMsY0FBYztBQUNyRCxZQUFJO0FBQWMsdUJBQWEsV0FBVztBQUMxQyxZQUFJO0FBQ0YsZ0JBQU0sU0FBUyxNQUFNLEtBQUssT0FBTyxrQkFBa0I7QUFDbkQsZUFBSyxNQUFNO0FBQ1gsY0FBSSxPQUFPLFlBQVksU0FBUyxHQUFHO0FBQ2pDLGdCQUFJO0FBQUEsY0FDRiw0QkFBNEIsT0FBTyxpQkFBaUIsb0JBQW9CLE9BQU8sWUFBWSxXQUFXLE9BQU8sWUFBWSxNQUFNO0FBQUEsWUFDakk7QUFBQSxVQUNGLFdBQVcsT0FBTyxpQkFBaUIsR0FBRztBQUNwQyxnQkFBSSx1QkFBTywwQ0FBMEM7QUFBQSxVQUN2RCxPQUFPO0FBQ0wsZ0JBQUk7QUFBQSxjQUNGLDRCQUE0QixPQUFPLGlCQUFpQixvQkFBb0IsT0FBTyxZQUFZO0FBQUEsWUFDN0Y7QUFBQSxVQUNGO0FBQUEsUUFDRixTQUFTLE9BQU87QUFDZCxrQkFBUSxNQUFNLGtEQUFrRCxLQUFLO0FBQ3JFLGNBQUksdUJBQU8saURBQWlEO0FBQzVELGlCQUFPLFlBQVksS0FBSyxFQUFFLGNBQWMscUJBQXFCO0FBQzdELGNBQUk7QUFBYyx5QkFBYSxXQUFXO0FBQUEsUUFDNUM7QUFBQSxNQUNGLENBQUM7QUFBQSxJQUNMO0FBQUEsRUFDSjtBQUFBLEVBRUEsVUFBZ0I7QUFDZCxTQUFLLFVBQVUsTUFBTTtBQUFBLEVBQ3ZCO0FBQ0Y7QUFFQSxJQUFNLDJCQUFOLGNBQXVDLGlDQUFpQjtBQUFBLEVBR3RELFlBQVksS0FBVSxRQUE4QjtBQUNsRCxVQUFNLEtBQUssTUFBTTtBQUNqQixTQUFLLFNBQVM7QUFBQSxFQUNoQjtBQUFBLEVBRUEsVUFBZ0I7QUFDZCxVQUFNLEVBQUUsWUFBWSxJQUFJO0FBQ3hCLGdCQUFZLE1BQU07QUFFbEIsUUFBSSx3QkFBUSxXQUFXLEVBQ3BCLFFBQVEsaUJBQWlCLEVBQ3pCLFFBQVEsb0NBQW9DLEVBQzVDLFlBQVksQ0FBQyxTQUFTO0FBQ3JCLFlBQU0sVUFBVSxLQUFLLE9BQU8sU0FBUztBQUNyQyxZQUFNLFVBQVUsS0FBSyxPQUFPLGVBQWU7QUFHM0MsVUFBSSxDQUFDLFFBQVEsU0FBUyxPQUFPO0FBQzNCLGFBQUs7QUFBQSxVQUNIO0FBQUEsVUFDQSxZQUFZLEtBQUssb0JBQW9CLEdBQUcsT0FBTztBQUFBLFFBQ2pEO0FBQ0YsaUJBQVcsUUFBUTtBQUNqQixhQUFLLFVBQVUsTUFBTSxTQUFTLE1BQU0sbUJBQW1CLElBQUk7QUFDN0QsV0FBSyxTQUFTLE9BQU8sRUFBRSxTQUFTLE9BQU8sVUFBVTtBQUMvQyxhQUFLLE9BQU8sU0FBUyxpQkFBaUI7QUFDdEMsY0FBTSxLQUFLLE9BQU8sYUFBYTtBQUFBLE1BQ2pDLENBQUM7QUFBQSxJQUNILENBQUM7QUFFSCxRQUFJLHdCQUFRLFdBQVcsRUFDcEIsUUFBUSx3QkFBd0IsRUFDaEM7QUFBQSxNQUNDO0FBQUEsSUFDRixFQUNDO0FBQUEsTUFBVSxDQUFDLFdBQ1YsT0FDRyxTQUFTLEtBQUssT0FBTyxTQUFTLG9CQUFvQixFQUNsRCxTQUFTLE9BQU8sVUFBVTtBQUN6QixhQUFLLE9BQU8sU0FBUyx1QkFBdUI7QUFDNUMsY0FBTSxLQUFLLE9BQU8sYUFBYTtBQUFBLE1BQ2pDLENBQUM7QUFBQSxJQUNMO0FBRUYsUUFBSSx3QkFBUSxXQUFXLEVBQ3BCLFFBQVEsa0JBQWtCLEVBQzFCLFFBQVEsdURBQXVELEVBQy9EO0FBQUEsTUFBUSxDQUFDLFNBQ1IsS0FDRyxlQUFlLFNBQVMsRUFDeEIsU0FBUyxLQUFLLE9BQU8sU0FBUyxlQUFlLEVBQzdDLFNBQVMsT0FBTyxVQUFVO0FBQ3pCLGFBQUssT0FBTyxTQUFTLGtCQUFrQixNQUFNLEtBQUssS0FBSztBQUN2RCxjQUFNLEtBQUssT0FBTyxhQUFhO0FBQUEsTUFDakMsQ0FBQztBQUFBLElBQ0w7QUFFRixRQUFJLHdCQUFRLFdBQVcsRUFDcEIsUUFBUSxvQkFBb0IsRUFDNUIsUUFBUSx5REFBeUQsRUFDakU7QUFBQSxNQUFRLENBQUMsU0FDUixLQUNHLGVBQWUsWUFBWSxFQUMzQixTQUFTLEtBQUssT0FBTyxTQUFTLGVBQWUsRUFDN0MsU0FBUyxPQUFPLFVBQVU7QUFDekIsYUFBSyxPQUFPLFNBQVMsa0JBQWtCLE1BQU0sS0FBSyxLQUFLO0FBQ3ZELGNBQU0sS0FBSyxPQUFPLGFBQWE7QUFBQSxNQUNqQyxDQUFDO0FBQUEsSUFDTDtBQUVGLFFBQUksd0JBQVEsV0FBVyxFQUNwQixRQUFRLG1CQUFtQixFQUMzQixRQUFRLG9EQUFvRCxFQUM1RDtBQUFBLE1BQVEsQ0FBQyxTQUNSLEtBQ0csZUFBZSxVQUFVLEVBQ3pCLFNBQVMsS0FBSyxPQUFPLFNBQVMsZ0JBQWdCLEVBQzlDLFNBQVMsT0FBTyxVQUFVO0FBQ3pCLGFBQUssT0FBTyxTQUFTLG1CQUFtQixNQUFNLEtBQUssS0FBSztBQUN4RCxjQUFNLEtBQUssT0FBTyxhQUFhO0FBQUEsTUFDakMsQ0FBQztBQUFBLElBQ0w7QUFFRixRQUFJLHdCQUFRLFdBQVcsRUFDcEIsUUFBUSwwQkFBMEIsRUFDbEMsUUFBUSxxRUFBcUUsRUFDN0U7QUFBQSxNQUFRLENBQUMsU0FDUixLQUNHLGVBQWUsZ0JBQWdCLEVBQy9CLFNBQVMsS0FBSyxPQUFPLFNBQVMsc0JBQXNCLEVBQ3BELFNBQVMsT0FBTyxVQUFVO0FBQ3pCLGFBQUssT0FBTyxTQUFTLHlCQUNuQixNQUFNLEtBQUssS0FBSztBQUNsQixjQUFNLEtBQUssT0FBTyxhQUFhO0FBQUEsTUFDakMsQ0FBQztBQUFBLElBQ0w7QUFFRixRQUFJLHdCQUFRLFdBQVcsRUFDcEIsUUFBUSx5QkFBeUIsRUFDakM7QUFBQSxNQUNDO0FBQUEsSUFDRixFQUNDO0FBQUEsTUFBVSxDQUFDLFdBQ1YsT0FDRyxjQUFjLHFCQUFxQixFQUNuQyxXQUFXLEVBQ1gsUUFBUSxNQUFNLElBQUksdUJBQXVCLEtBQUssS0FBSyxLQUFLLE1BQU0sRUFBRSxLQUFLLENBQUM7QUFBQSxJQUMzRTtBQUFBLEVBQ0o7QUFDRjsiLAogICJuYW1lcyI6IFtdCn0K
