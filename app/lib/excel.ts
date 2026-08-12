"use client";

import { AppSettings, ImageRecord, MilestoneEntry, MilestoneState, PortablePayload, Project, ProjectStatus, STATE_LABELS, STATUS_LABELS, SubItem } from "../types";

const FORMAT_ID = "personal-project-board-excel";
const FORMAT_VERSION = 1;
const IMAGE_CHUNK_SIZE = 30_000;
const SHEETS = {
  info: "备份信息",
  projects: "项目详情",
  milestones: "项目里程碑",
  settings: "阶段设置",
  images: "图片数据",
} as const;

type CellValue = string | number | boolean | null | undefined;
type Row = Record<string, CellValue>;

function text(value: CellValue): string {
  return value == null ? "" : String(value).trim();
}

const DATE_FORMAT = "yyyy-mm-dd hh:mm:ss";

function toExcelDate(value: CellValue): number | string {
  const raw = text(value);
  if (!raw) return "";
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return raw;
  return ms / 86_400_000 + 25_569;
}

function numberOrText(value: CellValue): string | number {
  return typeof value === "number" ? value : text(value);
}

function dateText(value: CellValue): string {
  const date = typeof value === "number"
    ? new Date(Math.round((value - 25_569) * 86_400_000))
    : new Date(text(value));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function parseProjectStatus(value: CellValue): ProjectStatus {
  const normalized = text(value);
  if (["closed", "已完成", "已结案"].includes(normalized)) return "closed";
  if (["risk", "风险"].includes(normalized)) return "risk";
  return "ongoing";
}

function parseMilestoneState(value: CellValue): MilestoneState {
  const normalized = text(value);
  if (["done", "已完成", "完成"].includes(normalized)) return "done";
  if (["in_progress", "进行中"].includes(normalized)) return "in_progress";
  if (["blocked", "阻塞"].includes(normalized)) return "blocked";
  return "not_started";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function setSheetLayout(sheet: { [key: string]: unknown }, widths: number[], rowCount: number, columnCount: number): void {
  sheet["!cols"] = widths.map((wch) => ({ wch }));
}

function columnName(columnCount: number): string {
  let value = columnCount;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function requiredSheet(workbook: { Sheets: Record<string, unknown> }, name: string): unknown {
  const sheet = workbook.Sheets[name];
  if (!sheet) throw new Error(`Excel 备份缺少“${name}”工作表`);
  return sheet;
}

function validatePayload(payload: PortablePayload): void {
  if (payload.schemaVersion !== 1) throw new Error("Excel 备份版本不受支持");
  if (payload.settings.milestoneDefinitions.length !== 15) throw new Error("Excel 备份必须包含 15 个阶段");
  const milestoneIds = new Set(payload.settings.milestoneDefinitions.map((definition) => definition.id));
  if (milestoneIds.size !== 15) throw new Error("Excel 备份中的阶段 ID 重复");
  const projectIds = new Set<string>();
  for (const project of payload.projects) {
    if (!project.id || projectIds.has(project.id)) throw new Error("Excel 备份中存在无效或重复的项目 ID");
    projectIds.add(project.id);
    if (!project.subItems.length) throw new Error(`项目 ${project.projectNo || project.no} 缺少子项`);
    for (const subItem of project.subItems) {
      const entryIds = new Set(subItem.milestones.map((milestone) => milestone.milestoneId));
      if (subItem.milestones.length !== 15 || entryIds.size !== 15 || [...entryIds].some((id) => !milestoneIds.has(id))) {
        throw new Error(`项目 ${project.projectNo || project.no} 的里程碑结构不完整`);
      }
    }
  }
  const imageCounts = new Map<string, number>();
  for (const image of payload.images) {
    if (!projectIds.has(image.projectId)) throw new Error("Excel 备份中存在无法关联项目的图片");
    const count = (imageCounts.get(image.projectId) ?? 0) + 1;
    if (count > 8) throw new Error("Excel 备份中单个项目的图片超过 8 张");
    imageCounts.set(image.projectId, count);
  }
}

export async function exportExcelBackup(settings: AppSettings, projects: Project[], images: ImageRecord[]): Promise<void> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  const exportedAt = new Date().toISOString();

  const applyDateColumns = (sheet: XLSX.WorkSheet, columnIndexes: number[]): void => {
    const range = XLSX.utils.decode_range(sheet["!ref"] as string);
    for (let row = range.s.r; row <= range.e.r; row += 1) {
      for (const column of columnIndexes) {
        const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
        if (cell && typeof cell.v === "number") cell.z = DATE_FORMAT;
      }
    }
  };

  const projectRows: Row[] = projects.map((project) => ({
    项目ID: project.id,
    序号: project.no,
    PM: project.pm,
    项目编号: project.projectNo,
    项目名称: project.name,
    类别: project.category,
    需求数量: project.demandQty,
    计划出样: project.outputTime,
    出样数量: project.outputQty,
    详细进展: project.detailProgress,
    负责人: project.dri,
    检查日期: project.cp,
    状态: STATUS_LABELS[project.status],
    创建时间: toExcelDate(project.createdAt),
    更新时间: toExcelDate(project.updatedAt),
    子项数量: project.subItems.length,
    图片数量: images.filter((image) => image.projectId === project.id).length,
  }));
  const projectSheet = XLSX.utils.json_to_sheet(projectRows, { header: [
    "项目ID", "序号", "PM", "项目编号", "项目名称", "类别", "需求数量", "计划出样", "出样数量", "详细进展",
    "负责人", "检查日期", "状态", "创建时间", "更新时间", "子项数量", "图片数量",
  ] });
  setSheetLayout(projectSheet, [38, 8, 12, 22, 28, 18, 12, 14, 12, 48, 24, 14, 12, 24, 24, 10, 10], projectRows.length, 17);
  applyDateColumns(projectSheet, [13, 14]);

  const milestoneRows: Row[] = [];
  projects.forEach((project) => project.subItems.forEach((subItem) => {
    const definitions = [...settings.milestoneDefinitions].sort((a, b) => a.order - b.order);
    definitions.forEach((definition, index) => {
      const milestone = subItem.milestones.find((entry) => entry.milestoneId === definition.id);
      milestoneRows.push({
        项目ID: project.id,
        项目序号: project.no,
        项目编号: project.projectNo,
        子项ID: subItem.id,
        子项名称: subItem.name,
        子项类别: subItem.category,
    业务DRI: subItem.businessDri,
    出样月份: subItem.outputMonth,
    子项创建时间: toExcelDate(subItem.createdAt),
    子项更新时间: toExcelDate(subItem.updatedAt),
        阶段ID: definition.id,
        阶段序号: index + 1,
        阶段名称: definition.name,
        状态: STATE_LABELS[milestone?.state ?? "not_started"],
        备注: milestone?.note ?? "",
        强调色: milestone?.color ?? "",
        更新时间: toExcelDate(milestone?.updatedAt ?? ""),
      });
    });
  }));
  const milestoneSheet = XLSX.utils.json_to_sheet(milestoneRows, { header: [
    "项目ID", "项目序号", "项目编号", "子项ID", "子项名称", "子项类别", "业务DRI", "出样月份", "子项创建时间",
    "子项更新时间", "阶段ID", "阶段序号", "阶段名称", "状态", "备注", "强调色", "更新时间",
  ] });
  setSheetLayout(milestoneSheet, [38, 10, 22, 38, 28, 18, 16, 14, 24, 24, 12, 10, 28, 12, 42, 12, 24], milestoneRows.length, 17);
  applyDateColumns(milestoneSheet, [8, 9, 16]);

  const definitionRows = [...settings.milestoneDefinitions]
    .sort((a, b) => a.order - b.order)
    .map((definition) => ({ 阶段ID: definition.id, 阶段名称: definition.name, 显示顺序: definition.order + 1 }));
  const settingsSheet = XLSX.utils.json_to_sheet(definitionRows, { header: ["阶段ID", "阶段名称", "显示顺序"] });
  setSheetLayout(settingsSheet, [14, 32, 12], definitionRows.length, 3);

  const imageRows: Row[] = [];
  for (const image of images) {
    const dataBase64 = bytesToBase64(new Uint8Array(await image.blob.arrayBuffer()));
    const chunks = dataBase64.match(new RegExp(`.{1,${IMAGE_CHUNK_SIZE}}`, "g")) ?? [""];
    chunks.forEach((chunk, index) => imageRows.push({
      图片ID: image.id,
      项目ID: image.projectId,
      文件名: image.name,
      类型: image.type,
      顺序: image.order,
      创建时间: toExcelDate(image.createdAt),
      分片序号: index + 1,
      分片总数: chunks.length,
      Base64数据: chunk,
    }));
  }
  const imageSheet = XLSX.utils.json_to_sheet(imageRows, { header: [
    "图片ID", "项目ID", "文件名", "类型", "顺序", "创建时间", "分片序号", "分片总数", "Base64数据",
  ] });
  setSheetLayout(imageSheet, [38, 38, 28, 18, 8, 24, 10, 10, 18], imageRows.length, 9);
  applyDateColumns(imageSheet, [5]);

  const infoRows: Array<[string, string | number]> = [
    ["格式标识", FORMAT_ID],
    ["版本", FORMAT_VERSION],
    ["导出时间", toExcelDate(exportedAt)],
    ["项目数量", projects.length],
    ["子项数量", projects.reduce((sum, project) => sum + project.subItems.length, 0)],
    ["阶段数量", settings.milestoneDefinitions.length],
    ["图片数量", images.length],
    ["设置更新时间", toExcelDate(settings.updatedAt)],
    ["最近备份时间", toExcelDate(settings.lastBackupAt ?? exportedAt)],
    ["说明", "此工作簿是项目进度看板的完整普通备份。请勿删除工作表或修改 ID 列。"],
  ];
  const infoSheet = XLSX.utils.aoa_to_sheet([["项目进度看板 Excel 备份", ""], ...infoRows]);
  infoSheet["!cols"] = [{ wch: 22 }, { wch: 80 }];
  for (const dateRow of [3, 8, 9]) {
    const cell = infoSheet[XLSX.utils.encode_cell({ r: dateRow, c: 1 })];
    if (cell && typeof cell.v === "number") cell.z = DATE_FORMAT;
  }

  XLSX.utils.book_append_sheet(workbook, infoSheet, SHEETS.info);
  XLSX.utils.book_append_sheet(workbook, projectSheet, SHEETS.projects);
  XLSX.utils.book_append_sheet(workbook, milestoneSheet, SHEETS.milestones);
  XLSX.utils.book_append_sheet(workbook, settingsSheet, SHEETS.settings);
  XLSX.utils.book_append_sheet(workbook, imageSheet, SHEETS.images);
  workbook.Workbook = { Sheets: workbook.SheetNames.map(() => ({ Hidden: 0 })) };
  XLSX.writeFileXLSX(workbook, `项目进度看板备份-${exportedAt.slice(0, 10)}.xlsx`);
}

function extractBusinessDri(dri: string): string {
  const lines = dri.split(/[\n;；]/).map((line) => line.trim()).filter(Boolean);
  const found = lines.find((line) => /业务/.test(line));
  const target = found ?? lines[0] ?? "";
  return target.replace(/^[\s\S]*?[:：]/, "").trim();
}

export async function exportTrackingSheet(settings: AppSettings, projects: Project[], images: ImageRecord[]): Promise<void> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  const stageDefs = settings.milestoneDefinitions;
  const total = projects.length;
  const countByStatus = (status: ProjectStatus) => projects.filter((project) => project.status === status).length;
  const closed = countByStatus("closed");
  const ongoing = countByStatus("ongoing");
  const risk = countByStatus("risk");
  const rate = (value: number) => (total ? Number((value / total).toFixed(4)) : 0);
  const monthLabel = `${new Date().getMonth() + 1}月`;

  const isStageDone = (project: Project, milestoneId: string): boolean =>
    project.subItems.some((subItem) => subItem.milestones.some((entry) => entry.milestoneId === milestoneId && entry.state === "done"));

  const stageHeader = (name: string): string => name.replace(/\s\(/, "\n(");
  const progressBar = (done: number, totalStages: number): string => {
    const filled = Math.max(0, Math.min(totalStages, done));
    const empty = totalStages - filled;
    const pct = totalStages ? Math.round((filled / totalStages) * 100) : 0;
    return "\u25A0".repeat(filled) + "\u25A1".repeat(empty) + ` ${pct}%`;
  };

  // ---- Summary sheet: 阶段勾选汇总 + 项目进度 ----
  const summaryRows: CellValue[][] = [];
  summaryRows.push([null, `项目进度追踪表-${monthLabel}`]);
  summaryRows.push([null, "序号", "项目类别", "项目名称", "业务DRI", "出样月份", ...stageDefs.map((definition) => stageHeader(definition.name)), "项目进度"]);
  for (const project of projects) {
    const doneCount = stageDefs.filter((definition) => isStageDone(project, definition.id)).length;
    const row: CellValue[] = [
      null, project.no, project.category, project.name, extractBusinessDri(project.dri), project.outputTime,
      ...stageDefs.map((definition) => (isStageDone(project, definition.id) ? "✓" : "")),
      progressBar(doneCount, stageDefs.length),
    ];
    summaryRows.push(row);
  }
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet["!cols"] = [
    { wch: 3 }, { wch: 6 }, { wch: 12 }, { wch: 30 }, { wch: 14 }, { wch: 10 },
    ...stageDefs.map(() => ({ wch: 12 })),
    { wch: 22 },
  ];
  const boldRow = (sheet: XLSX.WorkSheet, rowIndex: number, lastColumn: number): void => {
    for (let column = 1; column <= lastColumn; column += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: column })];
      if (cell) cell.s = { font: { bold: true } };
    }
  };
  boldRow(summarySheet, 1, 6 + stageDefs.length);

  // ---- Detail sheet: 项目明细 + 统计区 ----
  const detailRows: CellValue[][] = [];
  detailRows.push([null]);
  detailRows.push([null, "Define", null, null, "Category", "Q'ty", "Rate", "Remark"]);
  detailRows.push([null, "已结案", null, null, "Closed", closed, rate(closed), ""]);
  detailRows.push([null, "计划内", null, null, "Ongoing", ongoing, rate(ongoing), ""]);
  detailRows.push([null, "项目存在异常/延期风险", null, null, "Risk", risk, rate(risk), ""]);
  detailRows.push([null, "Total", null, null, "", total, "", ""]);
  detailRows.push([]);
  detailRows.push([]);
  detailRows.push([null, "No.", "PM", "Project No", "Project Name", "Category", "Demand Q'ty", "Output Time", "Output Q'ty", "Progress", "DRI", "CP", "Status", "Picture"]);
  for (const project of projects) {
    const pictureCount = images.filter((image) => image.projectId === project.id).length;
    detailRows.push([
      null, project.no, project.pm, project.projectNo, project.name, project.category,
      project.demandQty, project.outputTime, project.outputQty, project.detailProgress,
      project.dri, project.cp, STATUS_LABELS[project.status], pictureCount,
    ]);
  }
  const detailSheet = XLSX.utils.aoa_to_sheet(detailRows);
  detailSheet["!cols"] = [
    { wch: 3 }, { wch: 5 }, { wch: 10 }, { wch: 22 }, { wch: 34 }, { wch: 12 }, { wch: 12 },
    { wch: 12 }, { wch: 10 }, { wch: 50 }, { wch: 24 }, { wch: 12 }, { wch: 12 }, { wch: 8 },
  ];
  boldRow(detailSheet, 8, 13);

  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
  XLSX.utils.book_append_sheet(workbook, detailSheet, "Detail");
  XLSX.writeFileXLSX(workbook, `项目进度追踪表-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export async function importExcelBackup(file: File): Promise<PortablePayload> {
  const XLSX = await import("xlsx");
  let workbook;
  try {
    workbook = XLSX.read(await file.arrayBuffer(), { type: "array", raw: true });
  } catch {
    throw new Error("无法读取 Excel 文件，请确认文件没有损坏");
  }

  const infoSheet = requiredSheet(workbook, SHEETS.info);
  const infoRows = XLSX.utils.sheet_to_json<CellValue[]>(infoSheet, { header: 1, defval: "", raw: true });
  const info = new Map(infoRows.slice(1).map((row) => [text(row[0]), row[1]]));
  if (text(info.get("格式标识")) !== FORMAT_ID || Number(info.get("版本")) !== FORMAT_VERSION) {
    throw new Error("这不是受支持的项目进度看板 Excel 备份");
  }

  const definitionRows = XLSX.utils.sheet_to_json<Row>(requiredSheet(workbook, SHEETS.settings), { defval: "", raw: true });
  const milestoneDefinitions = definitionRows.map((row) => ({
    id: text(row["阶段ID"]),
    name: text(row["阶段名称"]),
    order: Math.max(0, Number(row["显示顺序"]) - 1),
  })).sort((a, b) => a.order - b.order);
  if (milestoneDefinitions.length !== 15 || milestoneDefinitions.some((definition) => !definition.id || !definition.name)) {
    throw new Error("Excel 备份中的阶段设置不完整");
  }

  const projectRows = XLSX.utils.sheet_to_json<Row>(requiredSheet(workbook, SHEETS.projects), { defval: "", raw: true });
  const projectsById = new Map<string, Project>();
  for (const row of projectRows) {
    const id = text(row["项目ID"]);
    if (!id || projectsById.has(id)) throw new Error("Excel 备份中存在空白或重复的项目 ID");
    projectsById.set(id, {
      id,
      no: Number(row["序号"]),
      pm: text(row["PM"]),
      projectNo: text(row["项目编号"]),
      name: text(row["项目名称"]),
      category: text(row["类别"]),
      demandQty: numberOrText(row["需求数量"]),
      outputTime: text(row["计划出样"]),
      outputQty: numberOrText(row["出样数量"]),
      detailProgress: text(row["详细进展"]),
      dri: text(row["负责人"]),
      cp: text(row["检查日期"]),
      status: parseProjectStatus(row["状态"]),
      createdAt: dateText(row["创建时间"]) || new Date().toISOString(),
      updatedAt: dateText(row["更新时间"]) || new Date().toISOString(),
      subItems: [],
    });
  }

  const milestoneRows = XLSX.utils.sheet_to_json<Row>(requiredSheet(workbook, SHEETS.milestones), { defval: "", raw: true });
  const subItemsByProject = new Map<string, Map<string, SubItem>>();
  for (const row of milestoneRows) {
    const projectId = text(row["项目ID"]);
    const project = projectsById.get(projectId);
    if (!project) throw new Error("里程碑工作表中存在无法关联的项目 ID");
    const subItemId = text(row["子项ID"]);
    const milestoneId = text(row["阶段ID"]);
    if (!subItemId || !milestoneId) throw new Error("里程碑工作表中存在空白的子项或阶段 ID");
    const projectSubItems = subItemsByProject.get(projectId) ?? new Map<string, SubItem>();
    let subItem = projectSubItems.get(subItemId);
    if (!subItem) {
      subItem = {
        id: subItemId,
        name: text(row["子项名称"]),
        category: text(row["子项类别"]),
        businessDri: text(row["业务DRI"]),
        outputMonth: text(row["出样月份"]),
        createdAt: dateText(row["子项创建时间"]) || new Date().toISOString(),
        updatedAt: dateText(row["子项更新时间"]) || new Date().toISOString(),
        milestones: [],
      };
      projectSubItems.set(subItemId, subItem);
      subItemsByProject.set(projectId, projectSubItems);
    }
    if (subItem.milestones.some((milestone) => milestone.milestoneId === milestoneId)) {
      throw new Error(`子项 ${subItem.name || subItem.id} 存在重复的阶段 ID`);
    }
    const milestone: MilestoneEntry = {
      milestoneId,
      state: parseMilestoneState(row["状态"]),
      note: text(row["备注"]),
      color: text(row["强调色"]),
      updatedAt: dateText(row["更新时间"]) || null,
    };
    subItem.milestones.push(milestone);
  }

  const definitionOrder = new Map(milestoneDefinitions.map((definition, index) => [definition.id, index]));
  for (const project of projectsById.values()) {
    project.subItems = [...(subItemsByProject.get(project.id)?.values() ?? [])].map((subItem) => ({
      ...subItem,
      milestones: [...subItem.milestones].sort((a, b) => (definitionOrder.get(a.milestoneId) ?? 99) - (definitionOrder.get(b.milestoneId) ?? 99)),
    }));
  }

  const imageRows = XLSX.utils.sheet_to_json<Row>(requiredSheet(workbook, SHEETS.images), { defval: "", raw: true });
  const imageGroups = new Map<string, Row[]>();
  for (const row of imageRows) {
    const imageId = text(row["图片ID"]);
    if (!imageId) throw new Error("图片数据中存在空白图片 ID");
    const rows = imageGroups.get(imageId) ?? [];
    rows.push(row);
    imageGroups.set(imageId, rows);
  }
  const portableImages = [...imageGroups.entries()].map(([id, rows]) => {
    rows.sort((a, b) => Number(a["分片序号"]) - Number(b["分片序号"]));
    const expectedChunks = Number(rows[0]["分片总数"]);
    if (!expectedChunks || rows.length !== expectedChunks || rows.some((row, index) => Number(row["分片序号"]) !== index + 1)) {
      throw new Error(`图片 ${text(rows[0]["文件名"]) || id} 的数据分片不完整`);
    }
    const dataBase64 = rows.map((row) => text(row["Base64数据"])).join("");
    try {
      base64ToBytes(dataBase64);
    } catch {
      throw new Error(`图片 ${text(rows[0]["文件名"]) || id} 的数据无效`);
    }
    return {
      id,
      projectId: text(rows[0]["项目ID"]),
      name: text(rows[0]["文件名"]),
      type: text(rows[0]["类型"]) || "image/webp",
      order: Number(rows[0]["顺序"]),
      createdAt: dateText(rows[0]["创建时间"]) || new Date().toISOString(),
      dataBase64,
    };
  });

  const expectedProjectCount = Number(info.get("项目数量"));
  const expectedImageCount = Number(info.get("图片数量"));
  if (expectedProjectCount !== projectsById.size || expectedImageCount !== portableImages.length) {
    throw new Error("Excel 备份的项目或图片数量与备份信息不一致");
  }

  const now = new Date().toISOString();
  const payload: PortablePayload = {
    schemaVersion: 1,
    exportedAt: dateText(info.get("导出时间")) || now,
    settings: {
      id: "app-settings",
      milestoneDefinitions,
      lastBackupAt: dateText(info.get("最近备份时间")) || null,
      updatedAt: dateText(info.get("设置更新时间")) || now,
    },
    projects: [...projectsById.values()].sort((a, b) => a.no - b.no),
    images: portableImages,
  };
  validatePayload(payload);
  return payload;
}
