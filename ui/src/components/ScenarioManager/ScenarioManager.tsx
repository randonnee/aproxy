import { useState, useEffect, useCallback, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { useAppStore } from "../../stores/appStore";
import * as api from "../../lib/api";
import type { ScenarioFile } from "../../lib/api";
import rulesSource from "@aproxy/shared/rules.ts?raw";

// Extract just the scenario-related types (from start to the Views marker)
const VIEWS_MARKER = "// ── Views";
const viewsIdx = rulesSource.indexOf(VIEWS_MARKER);
const scenarioTypesSource =
  viewsIdx >= 0 ? rulesSource.slice(0, viewsIdx).trimEnd() : rulesSource;

function TypeReferencePanel({ theme }: { theme: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="vm-typeref">
      <button
        className="vm-typeref-toggle"
        onClick={() => setOpen(!open)}
        title="Show type definitions for scenario files"
      >
        <svg
          className={`vm-typeref-chevron${open ? " open" : ""}`}
          width="10"
          height="10"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 3l5 5-5 5" />
        </svg>
        Type Reference
      </button>
      {open && (
        <div className="vm-typeref-body">
          <CodeMirror
            value={scenarioTypesSource}
            readOnly
            editable={false}
            extensions={[javascript({ typescript: true })]}
            theme={theme === "dark" ? oneDark : "light"}
            basicSetup={{
              lineNumbers: false,
              foldGutter: false,
              highlightActiveLine: false,
              bracketMatching: false,
              closeBrackets: false,
              autocompletion: false,
              indentOnInput: false,
            }}
          />
        </div>
      )}
    </div>
  );
}

const DEFAULT_SCENARIO_TEMPLATE = `import type { ScenarioFactory } from "../../shared/rules";

export const scenarios: ScenarioFactory[] = [
  () => ({
    id: "my-scenario",
    name: "My Scenario",
    description: "Description of what this scenario does",
    rules: [
      {
        id: "my-rule",
        name: "My Rule",
        description: "Intercepts matching requests and returns a mock response",
        handle: (ctx) => {
          // Return null to pass through, or a Response to mock
          // Available fields: ctx.id, ctx.url, ctx.method, ctx.headers
          if (!/example\\.com\\/api/.test(ctx.url)) return null;
          return new Response(
            JSON.stringify({ mock: true }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        },
      },
    ],
  }),
];
`;

export function ScenarioManager() {
  const setCurrentScreen = useAppStore((s) => s.setCurrentScreen);
  const theme = useAppStore((s) => s.theme);

  const [files, setFiles] = useState<ScenarioFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newFilename, setNewFilename] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const newFileInputRef = useRef<HTMLInputElement>(null);

  const loadFiles = useCallback(async () => {
    try {
      const data = await api.getScenarioFiles();
      setFiles(data.files);
      return data.files;
    } catch {
      setError("Failed to load scenario files");
      return [];
    }
  }, []);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const selectFile = useCallback(
    (filename: string) => {
      const file = files.find((f) => f.filename === filename);
      if (file) {
        setSelectedFile(filename);
        setEditorContent(file.content);
        setDirty(false);
        setError(null);
        setCreating(false);
        setConfirmingDelete(false);
      }
    },
    [files]
  );

  const handleEditorChange = useCallback(
    (value: string) => {
      setEditorContent(value);
      const file = files.find((f) => f.filename === selectedFile);
      setDirty(file ? value !== file.content : true);
    },
    [files, selectedFile]
  );

  const handleSave = useCallback(async () => {
    if (!selectedFile || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      await api.updateScenarioFile(selectedFile, editorContent);
      const updatedFiles = await loadFiles();
      const updated = updatedFiles.find(
        (f: ScenarioFile) => f.filename === selectedFile
      );
      if (updated) {
        setEditorContent(updated.content);
      }
      setDirty(false);
      // Refresh the scenarios list in the main app
      const scenarioData = await api.getScenarios();
      useAppStore
        .getState()
        .setScenarios(scenarioData.scenarios, scenarioData.activeScenarioIds);
    } catch (e: any) {
      setError(e?.message || "Failed to save file");
    } finally {
      setSaving(false);
    }
  }, [selectedFile, dirty, editorContent, loadFiles]);

  const handleDelete = useCallback(async () => {
    if (!selectedFile) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setConfirmingDelete(false);
    setError(null);
    try {
      await api.deleteScenarioFile(selectedFile);
      setSelectedFile(null);
      setEditorContent("");
      setDirty(false);
      await loadFiles();
      // Refresh the scenarios list in the main app
      const scenarioData = await api.getScenarios();
      useAppStore
        .getState()
        .setScenarios(scenarioData.scenarios, scenarioData.activeScenarioIds);
    } catch (e: any) {
      setError(e?.message || "Failed to delete file");
    }
  }, [selectedFile, confirmingDelete, loadFiles]);

  const handleCreate = useCallback(async () => {
    const name = newFilename.trim();
    if (!name) return;
    const filename = name.endsWith(".ts") || name.endsWith(".js") ? name : `${name}.ts`;
    setError(null);
    try {
      await api.createScenarioFile(filename, DEFAULT_SCENARIO_TEMPLATE);
      const updatedFiles = await loadFiles();
      const created = updatedFiles.find(
        (f: ScenarioFile) => f.filename === filename
      );
      if (created) {
        setSelectedFile(created.filename);
        setEditorContent(created.content);
        setDirty(false);
      }
      setCreating(false);
      setNewFilename("");
    } catch (e: any) {
      setError(e?.message || "Failed to create file");
    }
  }, [newFilename, loadFiles]);

  const startCreating = useCallback(() => {
    setCreating(true);
    setNewFilename("");
    setTimeout(() => newFileInputRef.current?.focus(), 0);
  }, []);

  // Keyboard shortcut: Cmd/Ctrl+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

  const extensions = [javascript({ typescript: true, jsx: true })];

  return (
    <div className="vm-container">
      <div className="vm-header">
        <button className="vm-back-btn" onClick={() => setCurrentScreen("main")}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 3L5 8l5 5" />
          </svg>
          Back
        </button>
        <h2 className="vm-title">Manage Scenarios</h2>
        <div className="vm-header-spacer" />
      </div>

      <div className="vm-body">
        <div className="vm-file-list">
          <div className="vm-file-list-header">
            <span className="vm-file-list-title">Files</span>
            <button className="sidebar-icon-btn" onClick={startCreating} title="New scenario file">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M8 3v10M3 8h10" />
              </svg>
            </button>
          </div>

          {creating && (
            <div className="vm-new-file">
              <input
                ref={newFileInputRef}
                className="vm-new-file-input"
                value={newFilename}
                onChange={(e) => setNewFilename(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") {
                    setCreating(false);
                    setNewFilename("");
                  }
                }}
                placeholder="filename.ts"
              />
              <button className="vm-new-file-ok" onClick={handleCreate}>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 8l4 4 6-7" />
                </svg>
              </button>
            </div>
          )}

          <div className="vm-file-entries">
            {files.length === 0 && !creating && (
              <div className="vm-file-empty">No scenario files</div>
            )}
            {files.map((f) => (
              <div
                key={f.filename}
                className={`vm-file-entry${f.filename === selectedFile ? " selected" : ""}`}
                onClick={() => selectFile(f.filename)}
              >
                <svg className="vm-file-icon" width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M3 1.5A1.5 1.5 0 0 1 4.5 0h5.379a1.5 1.5 0 0 1 1.06.44l2.122 2.12A1.5 1.5 0 0 1 13.5 3.622V14.5A1.5 1.5 0 0 1 12 16H4.5A1.5 1.5 0 0 1 3 14.5V1.5Zm1.5-.25a.25.25 0 0 0-.25.25v13a.25.25 0 0 0 .25.25H12a.25.25 0 0 0 .25-.25V3.622a.25.25 0 0 0-.073-.177L10.055 1.323A.25.25 0 0 0 9.879 1.25H4.5Z" />
                </svg>
                <span className="vm-file-name">{f.filename}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="vm-editor-area">
          {selectedFile ? (
            <>
              <div className="vm-editor-toolbar">
                <span className="vm-editor-filename">
                  {selectedFile}
                  {dirty && <span className="vm-dirty-dot" />}
                </span>
                <div className="vm-editor-actions">
                  <button
                    className="vm-save-btn primary"
                    onClick={handleSave}
                    disabled={!dirty || saving}
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>
                  <button className="vm-delete-btn danger" onClick={handleDelete}>
                    {confirmingDelete ? "Confirm?" : "Delete"}
                  </button>
                  {confirmingDelete && (
                    <button className="vm-delete-btn" onClick={() => setConfirmingDelete(false)}>
                      Cancel
                    </button>
                  )}
                </div>
              </div>
              <TypeReferencePanel theme={theme} />
              {error && <div className="vm-error">{error}</div>}
              <div className="vm-editor-wrap">
                <CodeMirror
                  value={editorContent}
                  onChange={handleEditorChange}
                  extensions={extensions}
                  theme={theme === "dark" ? oneDark : "light"}
                  height="100%"
                  basicSetup={{
                    lineNumbers: true,
                    foldGutter: true,
                    highlightActiveLine: true,
                    bracketMatching: true,
                    closeBrackets: true,
                    autocompletion: true,
                    indentOnInput: true,
                  }}
                />
              </div>
            </>
          ) : (
            <div className="vm-editor-empty">
              <div className="vm-editor-empty-icon">
                <svg width="40" height="40" viewBox="0 0 16 16" fill="currentColor" opacity="0.15">
                  <path d="M3 1.5A1.5 1.5 0 0 1 4.5 0h5.379a1.5 1.5 0 0 1 1.06.44l2.122 2.12A1.5 1.5 0 0 1 13.5 3.622V14.5A1.5 1.5 0 0 1 12 16H4.5A1.5 1.5 0 0 1 3 14.5V1.5Zm1.5-.25a.25.25 0 0 0-.25.25v13a.25.25 0 0 0 .25.25H12a.25.25 0 0 0 .25-.25V3.622a.25.25 0 0 0-.073-.177L10.055 1.323A.25.25 0 0 0 9.879 1.25H4.5Z" />
                </svg>
              </div>
              <span>Select a scenario file to edit</span>
              {files.length === 0 && (
                <button className="primary" onClick={startCreating}>
                  Create your first scenario
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
