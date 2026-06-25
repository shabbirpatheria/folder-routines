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
}

const DEFAULT_SETTINGS: FolderRoutinesSettings = {
  routinesFolder: "Routines",
  entriesProperty: "entries",
  storeDateFormat: "YYYY-MM-DD",
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

  private renderRoutines(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
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
    header.createSpan({ cls: "folder-routines-collapse-icon", text: "▾" });
    header.createSpan({ text: "Habits" });

    const body = section.createDiv({ cls: "folder-routines-body" });
    this.renderFolder(root, body, dateStr, 3);

    header.addEventListener("click", () => {
      section.toggleClass("is-collapsed", !section.hasClass("is-collapsed"));
    });
  }

  private renderFolder(
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

    for (const file of files) {
      this.renderItem(file, container, dateStr);
    }

    for (const sub of subfolders) {
      const section = container.createDiv({ cls: "folder-routines-section" });
      const tag = ("h" + Math.min(depth, 6)) as keyof HTMLElementTagNameMap;
      const header = section.createEl(tag, { cls: "folder-routines-heading" });
      header.createSpan({ cls: "folder-routines-collapse-icon", text: "▾" });
      header.createSpan({ text: sub.name });

      const body = section.createDiv({ cls: "folder-routines-body" });
      this.renderFolder(sub, body, dateStr, depth + 1);

      header.addEventListener("click", () => {
        section.toggleClass("is-collapsed", !section.hasClass("is-collapsed"));
      });
    }
  }

  private renderItem(file: TFile, container: HTMLElement, dateStr: string) {
    const itemEl = container.createDiv({ cls: "folder-routines-item" });
    const label = itemEl.createEl("label", { cls: "folder-routines-label" });
    const checkbox = label.createEl("input", {
      type: "checkbox",
    }) as HTMLInputElement;
    checkbox.checked = this.isChecked(file, dateStr);
    label.createSpan({ text: file.basename, cls: "folder-routines-text" });
    itemEl.toggleClass("is-checked", checkbox.checked);

    checkbox.addEventListener("change", async () => {
      const target = checkbox.checked;
      checkbox.disabled = true;
      try {
        await this.setEntry(file, dateStr, target);
        itemEl.toggleClass("is-checked", target);
      } catch (e) {
        console.error("Folder Routines: failed to update frontmatter", e);
        new Notice(`Folder Routines: failed to update ${file.basename}`);
        checkbox.checked = !target;
      } finally {
        checkbox.disabled = false;
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
  }
}
