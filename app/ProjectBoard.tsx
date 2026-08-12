"use client";

import { ChangeEvent, CSSProperties, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AppSettings,
  ImageRecord,
  MilestoneDefinition,
  MilestoneEntry,
  MilestoneState,
  Project,
  ProjectStatus,
  STATE_LABELS,
  STATUS_LABELS,
  SubItem,
  createEmptySettings,
  emptyMilestones,
} from "./types";
import {
  deleteImageRecord,
  deleteProjectRecord,
  loadAppData,
  replaceAllData,
  saveImageRecord,
  saveProject,
  saveSettings,
} from "./lib/db";
import { exportExcelBackup, importExcelBackup, exportTrackingSheet } from "./lib/excel";
import { importLegacyXls } from "./lib/legacy-xls";
import { formatCheckDate, getReminder, parseCheckDate, reminderLabel } from "./lib/reminder";

type SaveState = "loading" | "saved" | "saving" | "error";
type MilestoneEditorState = { projectId: string; subItemId: string; milestoneId: string } | null;
type BoardView = "active" | "completed";

const ACCENT_COLORS = ["", "#FFCC00", "#F59E0B", "#EF4444", "#8B5CF6", "#0EA5E9", "#14B8A6"];
const STATE_SYMBOLS: Record<MilestoneState, string> = {
  not_started: "",
  in_progress: "●",
  done: "✓",
  blocked: "!",
};

function progressPercent(subItem: SubItem): number {
  return Math.round((subItem.milestones.filter((item) => item.state === "done").length / 15) * 100);
}

function projectProgressPercent(project: Project): number {
  const milestones = project.subItems.flatMap((subItem) => subItem.milestones);
  if (!milestones.length) return 0;
  return Math.round((milestones.filter((item) => item.state === "done").length / milestones.length) * 100);
}

function canMoveToCompleted(project: Project): boolean {
  return project.subItems.length > 0 && project.subItems.every((subItem) => progressPercent(subItem) === 100);
}

function formatTime(value: string | null): string {
  if (!value) return "尚未备份";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function newSubItem(settings: AppSettings, name = "新子项"): SubItem {
  const now = new Date().toISOString();
  return {
    id: makeId("sub"),
    name,
    category: "",
    businessDri: "",
    outputMonth: "",
    milestones: emptyMilestones(settings.milestoneDefinitions),
    createdAt: now,
    updatedAt: now,
  };
}

function ImageThumb({ image, alt }: { image: ImageRecord; alt: string }) {
  const url = useMemo(() => URL.createObjectURL(image.blob), [image.blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  // Blob URLs are already compressed locally and cannot use the framework image optimizer.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} />;
}

async function compressImage(file: File): Promise<Blob> {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("图片无法读取"));
      element.src = sourceUrl;
    });
    const maxEdge = 1600;
    const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法处理图片");
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
    if (!blob) throw new Error("图片压缩失败");
    return blob;
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export function ProjectBoard() {
  const [settings, setSettings] = useState<AppSettings>(createEmptySettings());
  const [projects, setProjects] = useState<Project[]>([]);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | ProjectStatus>("all");
  const [boardView, setBoardView] = useState<BoardView>("active");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [milestoneEditor, setMilestoneEditor] = useState<MilestoneEditorState>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<MilestoneDefinition[]>([]);
  const [warningDaysDraft, setWarningDaysDraft] = useState<number>(3);
  const [reminderHidden, setReminderHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [storageText, setStorageText] = useState("正在读取…");
  const [previewImageId, setPreviewImageId] = useState<string | null>(null);
  const [compactMode, setCompactMode] = useState(() => typeof window !== "undefined" && localStorage.getItem("project-board-compact-mode") === "1");
  const [compactMetrics, setCompactMetrics] = useState({ rowHeight: 30, headerHeight: 50, boardHeight: 700 });
  const [backupMenuOpen, setBackupMenuOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const legacyImportInputRef = useRef<HTMLInputElement>(null);
  const backupMenuRef = useRef<HTMLDivElement>(null);
  const boardPanelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!backupMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (backupMenuRef.current && !backupMenuRef.current.contains(event.target as Node)) {
        setBackupMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [backupMenuOpen]);

  useEffect(() => {
    loadAppData()
      .then((data) => {
        setSettings(data.settings);
        setProjects(data.projects);
        setImages(data.images);
        setSaveState("saved");
      })
      .catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : "本机数据读取失败");
        setSaveState("error");
      });
    refreshStorageEstimate();
  }, []);

  const milestoneDefinitions = useMemo(
    () => [...settings.milestoneDefinitions].sort((a, b) => a.order - b.order),
    [settings.milestoneDefinitions],
  );

  const categories = useMemo(
    () => Array.from(new Set(projects.map((project) => project.category).filter(Boolean))).sort(),
    [projects],
  );

  const activeProjects = useMemo(() => projects.filter((project) => project.status !== "closed"), [projects]);
  const completedProjects = useMemo(() => projects.filter((project) => project.status === "closed"), [projects]);
  const currentBoardProjects = boardView === "completed" ? completedProjects : activeProjects;

  const warningDays = settings.warningDays ?? 3;
  const reminders = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getReminder>>();
    for (const project of projects) map.set(project.id, getReminder(project.cp, warningDays));
    return map;
  }, [projects, warningDays]);
  const dueReminders = useMemo(
    () => projects
      .filter((project) => project.status !== "closed")
      .map((project) => ({ project, reminder: reminders.get(project.id) }))
      .filter(
        (item): item is { project: Project; reminder: NonNullable<ReturnType<typeof getReminder>> } =>
          item.reminder !== null,
      ),
    [projects, reminders],
  );

  const filteredProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesBoard = boardView === "completed" ? project.status === "closed" : project.status !== "closed";
      const matchesSearch = !query || [project.projectNo, project.name, project.pm, project.dri, ...project.subItems.map((item) => item.name)]
        .join(" ")
        .toLowerCase()
        .includes(query);
      const matchesCategory = categoryFilter === "all" || project.category === categoryFilter;
      const matchesStatus = statusFilter === "all" || project.status === statusFilter;
      return matchesBoard && matchesSearch && matchesCategory && matchesStatus;
    });
  }, [projects, search, categoryFilter, statusFilter, boardView]);

  const visibleRowCount = filteredProjects.reduce((sum, project) => sum + project.subItems.length, 0);

  useEffect(() => {
    if (!compactMode || !boardPanelRef.current) return;
    let frame = 0;
    const fitBoardToViewport = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const boardTop = boardPanelRef.current?.getBoundingClientRect().top ?? 130;
        const boardHeight = Math.max(280, Math.floor(window.innerHeight - boardTop - 25));
        const headerHeight = 48;
        const groupSeparators = Math.max(0, filteredProjects.length - 1) * 2;
        const rowHeight = Math.max(16, Math.min(36, Math.floor((boardHeight - headerHeight - groupSeparators - 4) / Math.max(visibleRowCount, 1))));
        setCompactMetrics({ rowHeight, headerHeight, boardHeight });
        boardPanelRef.current?.querySelector(".board-scroll")?.scrollTo({ top: 0 });
      });
    };
    fitBoardToViewport();
    window.addEventListener("resize", fitBoardToViewport);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", fitBoardToViewport);
    };
  }, [compactMode, filteredProjects.length, visibleRowCount]);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const selectedImages = images.filter((image) => image.projectId === selectedProjectId).sort((a, b) => a.order - b.order);
  const previewImage = images.find((image) => image.id === previewImageId) ?? null;
  const totalSubItems = projects.reduce((sum, project) => sum + project.subItems.length, 0);
  const overallProgress = totalSubItems
    ? Math.round(projects.flatMap((project) => project.subItems).reduce((sum, item) => sum + progressPercent(item), 0) / totalSubItems)
    : 0;

  async function refreshStorageEstimate() {
    try {
      const estimate = await navigator.storage?.estimate?.();
      if (!estimate?.quota) return setStorageText("由浏览器管理");
      const used = estimate.usage ?? 0;
      setStorageText(`${(used / 1024 / 1024).toFixed(1)} MB / ${(estimate.quota / 1024 / 1024).toFixed(0)} MB`);
    } catch {
      setStorageText("暂时无法读取");
    }
  }

  function toggleCompactMode() {
    setCompactMode((current) => {
      const next = !current;
      localStorage.setItem("project-board-compact-mode", next ? "1" : "0");
      return next;
    });
  }

  function switchBoardView(view: BoardView) {
    setBoardView(view);
    setStatusFilter("all");
    setSelectedProjectId(null);
  }

  async function persistProject(project: Project) {
    setSaveState("saving");
    try {
      await saveProject(project);
      setSaveState("saved");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "项目保存失败");
      setSaveState("error");
    }
  }

  function updateProjectLocal(projectId: string, updater: (project: Project) => Project): Project | null {
    let nextProject: Project | null = null;
    setProjects((current) => current.map((project) => {
      if (project.id !== projectId) return project;
      nextProject = updater(project);
      return nextProject;
    }));
    setSaveState("saving");
    return nextProject;
  }

  function updateProjectField<K extends keyof Project>(projectId: string, field: K, value: Project[K]) {
    updateProjectLocal(projectId, (project) => ({ ...project, [field]: value, updatedAt: new Date().toISOString() }));
  }

  function saveEditedProject(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    if (project) persistProject(project);
  }

  async function commitProject(project: Project) {
    setProjects((current) => current.map((item) => (item.id === project.id ? project : item)));
    await persistProject(project);
  }

  async function addProject() {
    const now = new Date().toISOString();
    const nextNo = Math.max(0, ...projects.map((project) => project.no)) + 1;
    const project: Project = {
      id: makeId("project"),
      no: nextNo,
      pm: "",
      projectNo: `NEW-${String(nextNo).padStart(3, "0")}`,
      name: "新项目",
      category: "",
      demandQty: "",
      outputTime: "",
      outputQty: "",
      detailProgress: "",
      dri: "",
      cp: "",
      status: "ongoing",
      createdAt: now,
      updatedAt: now,
      subItems: [newSubItem(settings)],
    };
    setProjects((current) => [...current, project]);
    await persistProject(project);
    setBoardView("active");
    setStatusFilter("all");
    setSelectedProjectId(project.id);
  }

  async function moveProjectToCompleted(project: Project) {
    if (!canMoveToCompleted(project)) {
      return alert("主项目下的所有子项都达到 100% 后，才能移入已完成看板。");
    }
    if (!confirm(`将“${project.projectNo || project.name}”移入已完成看板吗？项目详情、图片和里程碑记录都会保留。`)) return;
    await commitProject({ ...project, status: "closed", updatedAt: new Date().toISOString() });
    setSelectedProjectId(null);
    setNoticeMessage(`“${project.projectNo || project.name}”已移入已完成看板`);
  }

  async function restoreProject(project: Project) {
    if (!confirm(`将“${project.projectNo || project.name}”恢复到项目进度看板吗？`)) return;
    await commitProject({ ...project, status: "ongoing", updatedAt: new Date().toISOString() });
    setSelectedProjectId(null);
    setBoardView("active");
    setStatusFilter("all");
    setNoticeMessage(`“${project.projectNo || project.name}”已恢复到项目进度看板`);
  }

  async function removeProject(project: Project) {
    if (!confirm(`确定删除“${project.name || project.projectNo}”吗？项目、子项、里程碑和图片都将从本机删除。`)) return;
    setSaveState("saving");
    try {
      await deleteProjectRecord(project.id);
      setProjects((current) => current.filter((item) => item.id !== project.id));
      setImages((current) => current.filter((image) => image.projectId !== project.id));
      setSelectedProjectId(null);
      setSaveState("saved");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "项目删除失败");
      setSaveState("error");
    }
  }

  async function addSubItem(project: Project) {
    const updated = {
      ...project,
      subItems: [...project.subItems, newSubItem(settings)],
      updatedAt: new Date().toISOString(),
    };
    await commitProject(updated);
  }

  async function removeSubItem(project: Project, subItem: SubItem) {
    if (project.subItems.length === 1) return alert("每个主项目至少保留一个子项");
    if (!confirm(`确定删除子项“${subItem.name}”及其 15 个里程碑记录吗？`)) return;
    await commitProject({
      ...project,
      subItems: project.subItems.filter((item) => item.id !== subItem.id),
      updatedAt: new Date().toISOString(),
    });
  }

  function updateSubItemField(projectId: string, subItemId: string, field: keyof SubItem, value: string) {
    updateProjectLocal(projectId, (project) => ({
      ...project,
      subItems: project.subItems.map((item) => item.id === subItemId
        ? { ...item, [field]: value, updatedAt: new Date().toISOString() }
        : item),
      updatedAt: new Date().toISOString(),
    }));
  }

  async function saveMilestone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!milestoneEditor) return;
    const form = new FormData(event.currentTarget);
    const state = String(form.get("state")) as MilestoneState;
    const note = String(form.get("note") ?? "").trim();
    const color = String(form.get("color") ?? "");
    const project = projects.find((item) => item.id === milestoneEditor.projectId);
    if (!project) return;
    const now = new Date().toISOString();
    const updated: Project = {
      ...project,
      subItems: project.subItems.map((subItem) => subItem.id === milestoneEditor.subItemId
        ? {
          ...subItem,
          milestones: subItem.milestones.map((milestone) => milestone.milestoneId === milestoneEditor.milestoneId
            ? { ...milestone, state, note, color, updatedAt: now }
            : milestone),
          updatedAt: now,
        }
        : subItem),
      updatedAt: now,
    };
    await commitProject(updated);
    setMilestoneEditor(null);
  }

  async function uploadImages(event: ChangeEvent<HTMLInputElement>, project: Project) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    const existing = images.filter((image) => image.projectId === project.id);
    if (existing.length + files.length > 8) return alert(`每个项目最多 8 张图片；当前已有 ${existing.length} 张。`);
    setBusy(true);
    setSaveState("saving");
    try {
      const compressed: ImageRecord[] = [];
      for (const [index, file] of files.entries()) {
        if (!file.type.startsWith("image/")) throw new Error(`${file.name} 不是图片文件`);
        const blob = await compressImage(file);
        const estimate = await navigator.storage?.estimate?.();
        if (estimate?.quota && (estimate.usage ?? 0) + blob.size > estimate.quota * 0.8) {
          throw new Error("本机存储使用量将超过 80%，请先删除图片或导出备份");
        }
        compressed.push({
          id: makeId("image"),
          projectId: project.id,
          name: file.name.replace(/\.[^.]+$/, ".webp"),
          type: "image/webp",
          blob,
          order: existing.length + index,
          createdAt: new Date().toISOString(),
        });
      }
      for (const image of compressed) await saveImageRecord(image);
      setImages((current) => [...current, ...compressed]);
      setSaveState("saved");
      refreshStorageEstimate();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "图片上传失败");
      setSaveState("error");
    } finally {
      setBusy(false);
    }
  }

  async function removeImage(image: ImageRecord) {
    if (!confirm(`删除图片“${image.name}”吗？`)) return;
    await deleteImageRecord(image.id);
    setImages((current) => current.filter((item) => item.id !== image.id));
    refreshStorageEstimate();
  }

  async function moveImage(image: ImageRecord, direction: -1 | 1) {
    const projectImages = images.filter((item) => item.projectId === image.projectId).sort((a, b) => a.order - b.order);
    const index = projectImages.findIndex((item) => item.id === image.id);
    const swap = projectImages[index + direction];
    if (!swap) return;
    const moved = { ...image, order: swap.order };
    const swapped = { ...swap, order: image.order };
    await Promise.all([saveImageRecord(moved), saveImageRecord(swapped)]);
    setImages((current) => current.map((item) => item.id === moved.id ? moved : item.id === swapped.id ? swapped : item));
  }

  function openSettings() {
    setSettingsDraft(milestoneDefinitions.map((item) => ({ ...item })));
    setWarningDaysDraft(settings.warningDays ?? 3);
    setSettingsOpen(true);
  }

  async function commitSettings() {
    if (settingsDraft.some((item) => !item.name.trim())) return alert("阶段名称不能为空");
    const safeWarningDays = Math.max(0, Math.min(60, Math.floor(warningDaysDraft) || 0));
    const updated: AppSettings = {
      ...settings,
      milestoneDefinitions: settingsDraft.map((item, index) => ({ ...item, name: item.name.trim(), order: index })),
      warningDays: safeWarningDays,
      updatedAt: new Date().toISOString(),
    };
    setSaveState("saving");
    try {
      await saveSettings(updated);
      setSettings(updated);
      setSettingsOpen(false);
      setSaveState("saved");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "设置保存失败");
      setSaveState("error");
    }
  }

  function moveDefinition(index: number, direction: -1 | 1) {
    const next = [...settingsDraft];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setSettingsDraft(next);
  }

  async function exportExcel() {
    if (busy) return;
    setBusy(true);
    setSaveState("saving");
    try {
      const timestamp = new Date().toISOString();
      const updatedSettings = { ...settings, lastBackupAt: timestamp, updatedAt: timestamp };
      await exportExcelBackup(updatedSettings, projects, images);
      await saveSettings(updatedSettings);
      setSettings(updatedSettings);
      setSaveState("saved");
      setNoticeMessage("Excel 备份已导出，项目、里程碑、设置和图片都已包含在文件中。");
      refreshStorageEstimate();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Excel 导出失败");
      setSaveState("error");
    } finally {
      setBusy(false);
    }
  }

  async function exportTracking() {
    if (busy) return;
    setBusy(true);
    setSaveState("saving");
    try {
      await exportTrackingSheet(settings, projects, images);
      setSaveState("saved");
      setNoticeMessage("已导出「项目进度追踪表」（Summary 阶段汇总 + Detail 明细，与你的模板一致）。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "追踪表导出失败");
      setSaveState("error");
    } finally {
      setBusy(false);
    }
  }

  async function importExcel(file: File) {
    if (busy) return;
    setBusy(true);
    setSaveState("saving");
    try {
      const payload = await importExcelBackup(file);
      const confirmed = confirm(
        `Excel 备份包含 ${payload.projects.length} 个主项目和 ${payload.images.length} 张图片。导入后将替换当前本机数据，是否继续？`,
      );
      if (!confirmed) {
        setSaveState("saved");
        return;
      }
      const data = await replaceAllData(payload);
      setSettings(data.settings);
      setProjects(data.projects);
      setImages(data.images);
      setSelectedProjectId(null);
      setBoardView("active");
      setStatusFilter("all");
      setSaveState("saved");
      setNoticeMessage(`已从 ${file.name} 导入 ${data.projects.length} 个主项目。`);
      refreshStorageEstimate();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Excel 导入失败");
      setSaveState("error");
    } finally {
      setBusy(false);
    }
  }

  async function importLegacyExcel(file: File) {
    if (busy) return;
    setBusy(true);
    setSaveState("saving");
    try {
      const result = await importLegacyXls(file);
      const warningText = result.warnings.length ? `\n\n注意：\n${result.warnings.map((warning) => `• ${warning}`).join("\n")}` : "";
      const confirmed = confirm(
        `旧版表格解析完成：${result.projectCount} 个主项目、${result.subItemCount} 个子项、15 个阶段。导入后将替换当前本机数据。${warningText}\n\n是否继续？`,
      );
      if (!confirmed) {
        setSaveState("saved");
        return;
      }
      const data = await replaceAllData(result.payload);
      setSettings(data.settings);
      setProjects(data.projects);
      setImages(data.images);
      setSelectedProjectId(null);
      setBoardView("active");
      setStatusFilter("all");
      setSaveState("saved");
      setNoticeMessage(`已从旧版表格 ${file.name} 导入 ${data.projects.length} 个主项目。${result.warnings.length ? "请留意导入提示。" : ""}`);
      refreshStorageEstimate();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "旧版 .xls 导入失败");
      setSaveState("error");
    } finally {
      setBusy(false);
    }
  }

  async function clearLocalData() {
    const message = settings.lastBackupAt
      ? `最近备份：${formatTime(settings.lastBackupAt)}。确定清空本机全部项目和图片吗？`
      : "你尚未导出过 Excel 备份。清空后无法恢复，仍要继续吗？";
    if (!confirm(message) || !confirm("请再次确认：删除本机全部项目数据。")) return;
    const emptySettings = createEmptySettings();
    const data = await replaceAllData({
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      settings: emptySettings,
      projects: [],
      images: [],
    });
    setSettings(data.settings);
    setProjects([]);
    setImages([]);
    setSettingsOpen(false);
    setSelectedProjectId(null);
    refreshStorageEstimate();
  }

  const editorProject = milestoneEditor ? projects.find((project) => project.id === milestoneEditor.projectId) : null;
  const editorSubItem = editorProject?.subItems.find((item) => item.id === milestoneEditor?.subItemId);
  const editorMilestone = editorSubItem?.milestones.find((item) => item.milestoneId === milestoneEditor?.milestoneId);
  const editorDefinition = milestoneDefinitions.find((item) => item.id === milestoneEditor?.milestoneId);

  if (saveState === "loading") {
    return <main className="loading-screen"><div className="loading-mark">15</div><p>正在打开本机项目看板…</p></main>;
  }

  return (
    <main className={`app-shell ${compactMode ? "compact-mode" : ""}`}>
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">15</div>
          <div><h1>项目进度看板</h1><p>一页看清 · 本机保存 · Excel 备份</p></div>
        </div>
        <div className="topbar-actions">
          <span className={`save-indicator ${saveState}`} aria-live="polite">
            <span className="save-dot" />{saveState === "saving" ? "保存中" : saveState === "error" ? "保存失败" : "已保存到本机"}
          </span>
          <button
            className={`button compact-toggle ${compactMode ? "active" : ""}`}
            aria-pressed={compactMode}
            title="自动压缩顶部区域和项目行，让当前项目尽量在一屏内显示"
            onClick={toggleCompactMode}
          >{compactMode ? "退出紧凑" : "紧凑模式"}</button>
          <button className="button ghost" onClick={openSettings}>阶段设置</button>
          <button className="button primary" onClick={() => setDetailsOpen(true)}>全局项目详情</button>
        </div>
      </header>

      {errorMessage && (
        <div className="error-banner" role="alert"><span>{errorMessage}</span><button onClick={() => setErrorMessage("")}>关闭</button></div>
      )}

      {noticeMessage && (
        <div className="notice-banner" role="status"><span>{noticeMessage}</span><button onClick={() => setNoticeMessage("")}>关闭</button></div>
      )}

      {dueReminders.length > 0 && !reminderHidden && (
        <div className="reminder-banner" role="status">
          <div className="reminder-banner-head">
            <span className="reminder-icon" aria-hidden>⚠</span>
            <strong>节点提醒</strong>
            <span className="reminder-summary">{dueReminders.length} 个项目的检查日期即将到达或已逾期</span>
            <button className="reminder-dismiss" onClick={() => setReminderHidden(true)}>暂时隐藏</button>
          </div>
          <ul className="reminder-list">
            {dueReminders.map(({ project, reminder }) => (
              <li key={project.id} className={reminder.level}>
                <button className="reminder-link" onClick={() => { setSelectedProjectId(project.id); setDetailsOpen(false); }}>{project.projectNo || project.name}</button>
                <span className="reminder-date">{formatCheckDate(reminder.date)}</span>
                <span className={`reminder-tag ${reminder.level}`}>{reminderLabel(reminder)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!settings.lastBackupAt && projects.length > 0 && (
        <div className="backup-banner">
          <div><strong>建议先导出一份 Excel 备份</strong><span>项目、里程碑、设置和图片都会保存在同一个 .xlsx 文件中。</span></div>
          <button className="button warning" disabled={busy} onClick={exportExcel}>{busy ? "正在生成…" : "导出 Excel"}</button>
        </div>
      )}

      <section className="summary-strip" aria-label="项目统计">
        <div className="stat-card total"><span>主项目</span><strong>{projects.length}</strong><small>{totalSubItems} 个子项</small></div>
        <button className={`stat-card ongoing ${boardView === "active" && statusFilter === "ongoing" ? "active" : ""}`} onClick={() => {
          setBoardView("active");
          setStatusFilter(boardView === "active" && statusFilter === "ongoing" ? "all" : "ongoing");
        }}>
          <span>进行中</span><strong>{projects.filter((project) => project.status === "ongoing").length}</strong><small>点击筛选</small>
        </button>
        <button className={`stat-card risk ${boardView === "active" && statusFilter === "risk" ? "active" : ""}`} onClick={() => {
          setBoardView("active");
          setStatusFilter(boardView === "active" && statusFilter === "risk" ? "all" : "risk");
        }}>
          <span>风险</span><strong>{projects.filter((project) => project.status === "risk").length}</strong><small>点击筛选</small>
        </button>
        <button className={`stat-card closed ${boardView === "completed" ? "active" : ""}`} onClick={() => switchBoardView("completed")}>
          <span>已完成</span><strong>{completedProjects.length}</strong><small>打开完成看板</small>
        </button>
        <div className="stat-card progress"><span>平均完成度</span><strong>{overallProgress}%</strong><div className="mini-progress"><i style={{ width: `${overallProgress}%` }} /></div></div>
      </section>

      <nav className="board-view-tabs" aria-label="切换项目看板">
        <button className={boardView === "active" ? "active" : ""} aria-pressed={boardView === "active"} onClick={() => switchBoardView("active")}>
          <span>项目进度</span><strong>{activeProjects.length}</strong>
        </button>
        <button className={boardView === "completed" ? "active" : ""} aria-pressed={boardView === "completed"} onClick={() => switchBoardView("completed")}>
          <span>已完成</span><strong>{completedProjects.length}</strong>
        </button>
      </nav>

      <section className="toolbar">
        <label className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索项目、型号、负责人…" /></label>
        <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="按类别筛选">
          <option value="all">全部类别</option>{categories.map((category) => <option key={category}>{category}</option>)}
        </select>
        <select value={statusFilter} disabled={boardView === "completed"} onChange={(event) => setStatusFilter(event.target.value as "all" | ProjectStatus)} aria-label="按状态筛选">
          {boardView === "completed" ? <option value="all">已完成项目</option> : <><option value="all">全部状态</option><option value="ongoing">进行中</option><option value="risk">风险</option></>}
        </select>
        <span className="result-count">显示 {filteredProjects.length} / {currentBoardProjects.length} 个主项目</span>
        {compactMode && <span className="compact-fit-note">已自动适配 {visibleRowCount} 行</span>}
        <div className="toolbar-spacer" />
        <div className="backup-dropdown" ref={backupMenuRef}>
          <button className="button ghost" disabled={busy} aria-haspopup="true" aria-expanded={backupMenuOpen} onClick={() => setBackupMenuOpen((value) => !value)}>
            备份与恢复 <span className="caret">▾</span>
          </button>
          {backupMenuOpen && (
            <div className="dropdown-menu" role="menu">
              <button className="dropdown-item" disabled={busy} onClick={() => { setBackupMenuOpen(false); legacyImportInputRef.current?.click(); }}>导入旧版 .xls</button>
              <button className="dropdown-item" disabled={busy} onClick={() => { setBackupMenuOpen(false); importInputRef.current?.click(); }}>导入 Excel 备份</button>
              <button className="dropdown-item" disabled={busy} onClick={() => { setBackupMenuOpen(false); exportExcel(); }}>{busy ? "正在处理…" : "导出 Excel 备份"}</button>
            </div>
          )}
        </div>
        <button className="button ghost" disabled={busy} onClick={exportTracking}>{busy ? "正在处理…" : "导出追踪表"}</button>
        <button className="button dark" onClick={addProject}>＋ 新建项目</button>
        <input ref={importInputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          event.currentTarget.value = "";
          if (file) importExcel(file);
        }} />
        <input ref={legacyImportInputRef} type="file" accept=".xls,application/vnd.ms-excel" hidden onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          event.currentTarget.value = "";
          if (file) importLegacyExcel(file);
        }} />
      </section>

      <section
        className="board-panel"
        ref={boardPanelRef}
        style={compactMode ? ({
          "--compact-row-height": `${compactMetrics.rowHeight}px`,
          "--compact-header-height": `${compactMetrics.headerHeight}px`,
          "--compact-board-height": `${compactMetrics.boardHeight}px`,
        } as CSSProperties) : undefined}
      >
        {projects.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">15</div><h2>从一份项目开始</h2>
            <p>新建空白项目，导入旧版研发部 .xls 表格，或恢复项目看板 Excel 备份。</p>
            <div>
              <button className="button dark" onClick={addProject}>新建项目</button>
              <div className="backup-dropdown" ref={backupMenuRef}>
                <button className="button ghost" disabled={busy} aria-haspopup="true" aria-expanded={backupMenuOpen} onClick={() => setBackupMenuOpen((value) => !value)}>备份与恢复 <span className="caret">▾</span></button>
                {backupMenuOpen && (
                  <div className="dropdown-menu" role="menu">
                    <button className="dropdown-item" disabled={busy} onClick={() => { setBackupMenuOpen(false); legacyImportInputRef.current?.click(); }}>导入旧版 .xls</button>
                    <button className="dropdown-item" disabled={busy} onClick={() => { setBackupMenuOpen(false); importInputRef.current?.click(); }}>导入 Excel 备份</button>
                    <button className="dropdown-item" disabled={busy} onClick={() => { setBackupMenuOpen(false); exportExcel(); }}>{busy ? "正在处理…" : "导出 Excel 备份"}</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="empty-state board-empty">
            <div className="empty-icon">{boardView === "completed" ? "✓" : "0"}</div>
            <h2>{boardView === "completed" ? "还没有已完成项目" : "当前看板没有匹配项目"}</h2>
            <p>{boardView === "completed" ? "项目达到 100% 后，可从详情抽屉移入这里。" : "可以清除筛选条件，或前往已完成看板查看。"}</p>
            <div>{boardView === "completed"
              ? <button className="button dark" onClick={() => switchBoardView("active")}>返回项目进度</button>
              : <button className="button ghost" onClick={() => { setSearch(""); setCategoryFilter("all"); setStatusFilter("all"); }}>清除筛选</button>}
            </div>
          </div>
        ) : (
          <div className="board-scroll">
            <table className="board-table">
              <thead><tr>
                <th className="sticky-col col-no">序号</th>
                <th className="sticky-col col-project">主项目</th>
                <th className="sticky-col col-subitem">子项 / 型号</th>
                <th className="col-dri">业务 DRI</th>
                <th className="col-output-month">出样月份</th>
                {milestoneDefinitions.map((definition, index) => (
                  <th className="milestone-heading" key={definition.id} title={definition.name}><span>{String(index + 1).padStart(2, "0")}</span><b>{definition.name}</b></th>
                ))}
                <th className="col-progress">完成度</th>
              </tr></thead>
              <tbody>
                {filteredProjects.map((project) => {
                  const reminder = reminders.get(project.id) ?? null;
                  return project.subItems.map((subItem, subIndex) => (
                  <tr key={subItem.id} className={`${subIndex === 0 ? "group-start" : "group-continuation"}${reminder ? ` row-reminder ${reminder.level}` : ""}`}>
                    <td className="sticky-col col-no">{subIndex === 0 ? project.no : ""}</td>
                    <td className="sticky-col col-project">
                      {subIndex === 0 && <>
                        <button className="project-link" onClick={() => setSelectedProjectId(project.id)}>{project.projectNo || project.name}<small>{project.name}</small></button>
                        {boardView === "active" && reminder && <span className={`reminder-badge ${reminder.level}`} title={`检查日期 ${formatCheckDate(reminder.date)} · ${reminderLabel(reminder)}`}>⚠ {reminderLabel(reminder)}</span>}
                        {boardView === "active" && canMoveToCompleted(project) && <button className="archive-row-action" onClick={() => moveProjectToCompleted(project)}>移入已完成</button>}
                      </>}
                    </td>
                    <td className="sticky-col col-subitem"><strong>{subItem.name}</strong><small>{subItem.category || project.category || "未分类"}</small></td>
                    <td className="col-dri">{subItem.businessDri || "—"}</td>
                    <td className="col-output-month">{subItem.outputMonth || project.outputTime || "未定"}</td>
                    {milestoneDefinitions.map((definition) => {
                      const milestone = subItem.milestones.find((entry) => entry.milestoneId === definition.id) ?? {
                        milestoneId: definition.id, state: "not_started", note: "", color: "", updatedAt: null,
                      } as MilestoneEntry;
                      const style = milestone.color ? ({ "--cell-accent": milestone.color } as CSSProperties) : undefined;
                      return <td className="milestone-td" key={definition.id}>
                        <button
                          className={`milestone-cell state-${milestone.state} ${milestone.note ? "has-note" : ""} ${milestone.color ? "has-accent" : ""}`}
                          style={style}
                          title={`${definition.name}：${STATE_LABELS[milestone.state]}${milestone.note ? `\n${milestone.note}` : ""}`}
                          aria-label={`编辑 ${subItem.name} 的 ${definition.name}`}
                          onClick={() => setMilestoneEditor({ projectId: project.id, subItemId: subItem.id, milestoneId: definition.id })}
                        >{STATE_SYMBOLS[milestone.state]}{milestone.note && <i />}</button>
                      </td>;
                    })}
                    <td className="col-progress"><strong>{progressPercent(subItem)}%</strong><div className="row-progress"><i style={{ width: `${progressPercent(subItem)}%` }} /></div></td>
                  </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="app-footer"><span>数据仅保存在此浏览器</span><span>本机存储：{storageText}</span><span>最近备份：{formatTime(settings.lastBackupAt)}</span></footer>

      <button className={`drawer-backdrop ${selectedProject ? "open" : ""}`} onClick={() => setSelectedProjectId(null)} aria-label="关闭项目详情" />
      <aside className={`detail-drawer ${selectedProject ? "open" : ""}`} aria-hidden={!selectedProject}>
        {selectedProject && <>
          <div className="drawer-header">
            <div><span className={`status-chip ${selectedProject.status}`}>{STATUS_LABELS[selectedProject.status]}</span><h2>{selectedProject.projectNo || `项目 ${selectedProject.no}`}</h2><p>{selectedProject.name}</p></div>
            <button className="icon-button" onClick={() => setSelectedProjectId(null)} aria-label="关闭详情">×</button>
          </div>
          <div className="drawer-body">
            <section className="form-section"><div className="section-title"><h3>项目基本信息</h3><span>失去焦点后自动保存</span></div>
              <div className="form-grid">
                <label><span>项目编号</span><input value={selectedProject.projectNo} onChange={(event) => updateProjectField(selectedProject.id, "projectNo", event.target.value)} onBlur={() => saveEditedProject(selectedProject.id)} /></label>
                <label><span>项目名称</span><input value={selectedProject.name} onChange={(event) => updateProjectField(selectedProject.id, "name", event.target.value)} onBlur={() => saveEditedProject(selectedProject.id)} /></label>
                <label><span>PM</span><input value={selectedProject.pm} onChange={(event) => updateProjectField(selectedProject.id, "pm", event.target.value)} onBlur={() => saveEditedProject(selectedProject.id)} /></label>
                <label><span>类别</span><input value={selectedProject.category} onChange={(event) => updateProjectField(selectedProject.id, "category", event.target.value)} onBlur={() => saveEditedProject(selectedProject.id)} /></label>
                <label><span>需求数量</span><input value={selectedProject.demandQty} onChange={(event) => updateProjectField(selectedProject.id, "demandQty", event.target.value)} onBlur={() => saveEditedProject(selectedProject.id)} /></label>
                <label><span>计划出样</span><input value={selectedProject.outputTime} onChange={(event) => updateProjectField(selectedProject.id, "outputTime", event.target.value)} onBlur={() => saveEditedProject(selectedProject.id)} /></label>
                <label><span>出样数量</span><input value={selectedProject.outputQty} onChange={(event) => updateProjectField(selectedProject.id, "outputQty", event.target.value)} onBlur={() => saveEditedProject(selectedProject.id)} /></label>
                <label><span>检查日期</span><input value={selectedProject.cp} onChange={(event) => updateProjectField(selectedProject.id, "cp", event.target.value)} onBlur={() => saveEditedProject(selectedProject.id)} /></label>
                {(() => {
                  const parsed = parseCheckDate(selectedProject.cp);
                  if (!selectedProject.cp) return null;
                  if (!parsed) return <p className="field-reminder invalid">“{selectedProject.cp}”无法识别为日期，支持 2026.08.12 或 8/11 写法</p>;
                  const reminder = getReminder(selectedProject.cp, warningDays)!;
                  return <p className={`field-reminder ${reminder.level}`}>检查日期：{formatCheckDate(parsed)} · <b>{reminderLabel(reminder)}</b></p>;
                })()}
                <label className="full"><span>整体状态</span><select value={selectedProject.status} disabled={selectedProject.status === "closed"} onChange={async (event) => {
                  const updated = { ...selectedProject, status: event.target.value as ProjectStatus, updatedAt: new Date().toISOString() };
                  await commitProject(updated);
                }}>{selectedProject.status === "closed" && <option value="closed">已完成</option>}<option value="ongoing">进行中</option><option value="risk">风险</option></select></label>
                <label className="full"><span>负责人</span><textarea rows={3} value={selectedProject.dri} onChange={(event) => updateProjectField(selectedProject.id, "dri", event.target.value)} onBlur={() => saveEditedProject(selectedProject.id)} /></label>
                <label className="full"><span>详细进展</span><textarea rows={8} value={selectedProject.detailProgress} onChange={(event) => updateProjectField(selectedProject.id, "detailProgress", event.target.value)} onBlur={() => saveEditedProject(selectedProject.id)} /></label>
              </div>
            </section>

            <section className="form-section"><div className="section-title"><h3>子项 / 型号</h3><button className="text-button" onClick={() => addSubItem(selectedProject)}>＋ 添加子项</button></div>
              <div className="subitem-list">{selectedProject.subItems.map((subItem) => <div className="subitem-card" key={subItem.id}>
                <div className="subitem-card-head"><strong>{subItem.name || "未命名子项"}</strong><span>{progressPercent(subItem)}%</span></div>
                <div className="form-grid compact">
                  <label><span>子项名称</span><input value={subItem.name} onChange={(event) => updateSubItemField(selectedProject.id, subItem.id, "name", event.target.value)} onBlur={() => saveEditedProject(selectedProject.id)} /></label>
                  <label><span>类别</span><input value={subItem.category} onChange={(event) => updateSubItemField(selectedProject.id, subItem.id, "category", event.target.value)} onBlur={() => saveEditedProject(selectedProject.id)} /></label>
                  <label><span>业务 DRI</span><input value={subItem.businessDri} onChange={(event) => updateSubItemField(selectedProject.id, subItem.id, "businessDri", event.target.value)} onBlur={() => saveEditedProject(selectedProject.id)} /></label>
                  <label><span>出样月份</span><input value={subItem.outputMonth} onChange={(event) => updateSubItemField(selectedProject.id, subItem.id, "outputMonth", event.target.value)} onBlur={() => saveEditedProject(selectedProject.id)} /></label>
                </div>
                <button className="danger-link" onClick={() => removeSubItem(selectedProject, subItem)}>删除此子项</button>
              </div>)}</div>
            </section>

            <section className="form-section"><div className="section-title"><h3>项目图片 <small>{selectedImages.length}/8</small></h3><label className={`text-button upload-label ${busy ? "disabled" : ""}`}>＋ 上传图片<input type="file" accept="image/*" multiple hidden disabled={busy} onChange={(event) => uploadImages(event, selectedProject)} /></label></div>
              {selectedImages.length ? <div className="image-grid">{selectedImages.map((image, index) => <div className="image-card" key={image.id}>
                <button className="image-preview-button" onClick={() => setPreviewImageId(image.id)}><ImageThumb image={image} alt={image.name} /></button>
                <div><span title={image.name}>{image.name}</span><div><button disabled={index === 0} onClick={() => moveImage(image, -1)}>←</button><button disabled={index === selectedImages.length - 1} onClick={() => moveImage(image, 1)}>→</button><button onClick={() => removeImage(image)}>删除</button></div></div>
              </div>)}</div> : <p className="muted-block">暂无图片。上传后会自动压缩并只保存在本机。</p>}
            </section>
          </div>
          <div className="drawer-footer">
            <button className="button danger" onClick={() => removeProject(selectedProject)}>删除项目</button>
            <div className="drawer-footer-actions">
              {selectedProject.status === "closed"
                ? <button className="button restore" onClick={() => restoreProject(selectedProject)}>恢复到进度看板</button>
                : <button className="button complete" disabled={!canMoveToCompleted(selectedProject)} title={canMoveToCompleted(selectedProject) ? "" : "所有子项达到 100% 后可用"} onClick={() => moveProjectToCompleted(selectedProject)}>移入已完成看板 · {projectProgressPercent(selectedProject)}%</button>}
              <button className="button dark" onClick={() => setSelectedProjectId(null)}>完成</button>
            </div>
          </div>
        </>}
      </aside>

      {detailsOpen && <div className="modal-layer"><section className="fullscreen-modal">
        <div className="modal-header"><div><span className="eyebrow">DETAIL VIEW</span><h2>全局项目详情</h2><p>{projects.length} 个主项目 · 点击项目编号进入编辑</p></div><button className="icon-button" onClick={() => setDetailsOpen(false)}>×</button></div>
        <div className="detail-table-wrap"><table className="detail-table"><thead><tr><th>No.</th><th>PM</th><th>项目编号 / 名称</th><th>类别</th><th>需求数量</th><th>计划出样</th><th>出样数量</th><th>详细进展</th><th>负责人</th><th>检查日期</th><th>状态</th><th>图片</th></tr></thead>
          <tbody>{filteredProjects.map((project) => <tr key={project.id}><td>{project.no}</td><td>{project.pm}</td><td><button className="project-link" onClick={() => { setSelectedProjectId(project.id); setDetailsOpen(false); }}>{project.projectNo}<small>{project.name}</small></button></td><td>{project.category}</td><td>{project.demandQty}</td><td>{project.outputTime}</td><td>{project.outputQty}</td><td className="progress-copy">{project.detailProgress || "—"}</td><td className="dri-copy">{project.dri || "—"}</td><td>{project.cp}{(() => { const r = reminders.get(project.id); return r ? <span className={`reminder-dot ${r.level}`} title={reminderLabel(r)}>●</span> : null; })()}</td><td><span className={`status-chip ${project.status}`}>{STATUS_LABELS[project.status]}</span></td><td>{images.filter((image) => image.projectId === project.id).length}</td></tr>)}</tbody>
        </table></div>
        <div className="modal-footer"><button className="button ghost" disabled={busy} onClick={exportExcel}>{busy ? "正在生成…" : "导出 Excel"}</button><button className="button dark" onClick={() => setDetailsOpen(false)}>返回看板</button></div>
      </section></div>}

      {milestoneEditor && editorMilestone && <div className="modal-layer compact-layer"><form className="compact-modal" onSubmit={saveMilestone}>
        <div className="modal-header"><div><span className="eyebrow">MILESTONE</span><h2>{editorDefinition?.name}</h2><p>{editorProject?.projectNo} · {editorSubItem?.name}</p></div><button type="button" className="icon-button" onClick={() => setMilestoneEditor(null)}>×</button></div>
        <div className="modal-content">
          <fieldset className="state-options"><legend>进度状态</legend>{(Object.keys(STATE_LABELS) as MilestoneState[]).map((state) => <label key={state} className={`state-option ${state}`}><input type="radio" name="state" value={state} defaultChecked={editorMilestone.state === state} /><span>{STATE_SYMBOLS[state] || "○"}</span><b>{STATE_LABELS[state]}</b></label>)}</fieldset>
          <label className="stacked-field"><span>备注</span><textarea name="note" rows={5} defaultValue={editorMilestone.note} placeholder="记录风险、下一步或需要跟进的事项…" /></label>
          <fieldset className="color-options"><legend>强调色</legend>{ACCENT_COLORS.map((color) => <label key={color || "none"}><input type="radio" name="color" value={color} defaultChecked={editorMilestone.color === color} /><span style={{ background: color || "#ffffff" }}>{!color && "无"}</span></label>)}</fieldset>
          {editorMilestone.updatedAt && <p className="last-updated">上次更新：{formatTime(editorMilestone.updatedAt)}</p>}
        </div><div className="modal-footer"><button type="button" className="button ghost" onClick={() => setMilestoneEditor(null)}>取消</button><button className="button dark">保存里程碑</button></div>
      </form></div>}

      {settingsOpen && <div className="modal-layer"><section className="settings-modal">
        <div className="modal-header"><div><span className="eyebrow">SETTINGS</span><h2>15 个阶段设置</h2><p>阶段数量固定；改名或排序不会丢失已有记录。</p></div><button className="icon-button" onClick={() => setSettingsOpen(false)}>×</button></div>
        <div className="settings-body"><div className="settings-reminder">
          <h3>节点提醒</h3>
          <label className="reminder-field">
            <span>检查日期提前预警天数</span>
            <input type="number" min={0} max={60} value={warningDaysDraft} onChange={(event) => setWarningDaysDraft(Number(event.target.value))} />
            <small>在“检查日期”到达前这么多天内，看板行与顶部都会给出预警。默认 3 天。支持的写法：2026.08.12、8/11、8月11日。</small>
          </label>
        </div><div className="definition-list">{settingsDraft.map((definition, index) => <div className="definition-row" key={definition.id}><span>{String(index + 1).padStart(2, "0")}</span><input value={definition.name} onChange={(event) => setSettingsDraft((current) => current.map((item) => item.id === definition.id ? { ...item, name: event.target.value } : item))} /><div><button disabled={index === 0} onClick={() => moveDefinition(index, -1)}>↑</button><button disabled={index === settingsDraft.length - 1} onClick={() => moveDefinition(index, 1)}>↓</button></div></div>)}</div>
          <aside className="data-management"><h3>本机数据</h3><dl><div><dt>存储使用</dt><dd>{storageText}</dd></div><div><dt>最近备份</dt><dd>{formatTime(settings.lastBackupAt)}</dd></div><div><dt>项目 / 图片</dt><dd>{projects.length} / {images.length}</dd></div></dl><button className="button ghost full-button" disabled={busy} onClick={exportExcel}>{busy ? "正在生成…" : "导出 Excel 备份"}</button><button className="button danger full-button" onClick={clearLocalData}>清空本机数据</button><p>清空浏览器数据或更换电脑前，请先导出 .xlsx 文件。</p></aside>
        </div><div className="modal-footer"><button className="button ghost" onClick={() => setSettingsOpen(false)}>取消</button><button className="button dark" onClick={commitSettings}>保存设置</button></div>
      </section></div>}

      {previewImage && <div className="image-lightbox" role="dialog" aria-modal="true" aria-label="图片预览"><button className="icon-button" onClick={() => setPreviewImageId(null)} aria-label="关闭图片预览">×</button><div><ImageThumb image={previewImage} alt={previewImage.name} /><p>{previewImage.name}</p></div></div>}
    </main>
  );
}
