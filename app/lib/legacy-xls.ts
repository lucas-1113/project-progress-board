"use client";

import type { WorkBook, WorkSheet } from "xlsx";
import type { MilestoneDefinition, MilestoneEntry, PortablePayload, Project, ProjectStatus, SubItem } from "../types";

type CellValue = string | number | boolean | Date | null | undefined;
type LegacyCell = {
  v?: CellValue;
  s?: { fgColor?: { rgb?: string } };
  c?: Array<{ t?: string }>;
};

type SummarySubItem = {
  category: string;
  businessDri: string;
  outputMonth: string;
  name: string;
  milestones: MilestoneEntry[];
};

type SummaryGroup = { no: number; subItems: SummarySubItem[] };

type DetailProject = {
  no: number;
  pm: string;
  projectNo: string;
  name: string;
  category: string;
  demandQty: string | number;
  outputTime: string;
  outputQty: string | number;
  detailProgress: string;
  dri: string;
  cp: string;
  status: ProjectStatus;
};

export type LegacyImportResult = {
  payload: PortablePayload;
  projectCount: number;
  subItemCount: number;
  warnings: string[];
};

function normalizeText(value: CellValue): string {
  if (value == null) return "";
  const raw = String(value);
  const nullIndex = raw.indexOf(String.fromCharCode(0));
  const beforeNull = nullIndex >= 0 ? raw.slice(0, nullIndex) : raw;
  return [...beforeNull].filter((character) => {
    const code = character.charCodeAt(0);
    return code === 9 || code === 10 || code === 13 || code >= 32;
  }).join("").trim();
}

function normalizeValue(value: CellValue): string | number {
  if (typeof value === "number") return value;
  return normalizeText(value);
}

function normalizeHeader(value: CellValue): string {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
}

function findSheet(workbook: WorkBook, requiredHeaders: string[]): WorkSheet | null {
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const rows = sheetToRows(sheet);
    const found = rows.some((row) => {
      const headers = row.map(normalizeHeader);
      return requiredHeaders.every((header) => headers.includes(header));
    });
    if (found) return sheet;
  }
  return null;
}

function sheetToRows(sheet: WorkSheet): CellValue[][] {
  const XLSX = globalThis.__legacyXlsx;
  if (!XLSX) throw new Error("旧版 Excel 解析器尚未初始化");
  return XLSX.utils.sheet_to_json<CellValue[]>(sheet, { header: 1, defval: "", raw: true });
}

declare global {
  // Used only during a single import so helper functions can keep strong worksheet types.
  var __legacyXlsx: Awaited<typeof import("xlsx")> | undefined;
}

function headerIndex(headers: CellValue[], name: string): number {
  const normalized = headers.map(normalizeHeader);
  const index = normalized.indexOf(name);
  if (index < 0) throw new Error(`旧版表格缺少“${normalizeText(name)}”列`);
  return index;
}

function statusFromCell(value: CellValue): ProjectStatus {
  const normalized = normalizeHeader(value);
  if (["closed", "已结案", "已完成"].includes(normalized)) return "closed";
  if (["risk", "风险", "项目存在异常延期风险"].includes(normalized)) return "risk";
  return "ongoing";
}

function cellNote(cell: LegacyCell | undefined): string {
  return (cell?.c ?? []).map((comment) => normalizeText(comment.t)).filter(Boolean).join("\n");
}

function isBlockedCell(cell: LegacyCell | undefined): boolean {
  const color = cell?.s?.fgColor?.rgb?.toUpperCase() ?? "";
  return color.endsWith("FFCC00") || color.endsWith("FFC000") || color.endsWith("FFFF00");
}

function aliasesForProjectNo(projectNo: string): string[] {
  const cleaned = projectNo.toUpperCase().replace(/\s+/g, "");
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length <= 1) return cleaned ? [cleaned] : [];
  const first = parts[0];
  const prefix = first.includes("-") ? first.slice(0, first.lastIndexOf("-") + 1) : "";
  return [first, ...parts.slice(1).map((part) => part.includes("-") ? part : `${prefix}${part}`)];
}

function matchDetail(group: SummaryGroup, details: DetailProject[], used: Set<DetailProject>): DetailProject | null {
  const names = group.subItems.map((item) => item.name.toUpperCase().replace(/\s+/g, ""));
  const candidates = details.filter((detail) => !used.has(detail)).map((detail) => {
    const aliasScore = aliasesForProjectNo(detail.projectNo)
      .filter((alias) => names.some((name) => name.includes(alias) || alias.includes(name)))
      .length * 100;
    const numberScore = detail.no === group.no ? 10 : 0;
    return { detail, score: aliasScore + numberScore };
  }).sort((a, b) => b.score - a.score);
  return candidates[0]?.score ? candidates[0].detail : null;
}

function allMilestonesDone(subItems: SubItem[]): boolean {
  return subItems.length > 0 && subItems.every((subItem) => subItem.milestones.length === 15 && subItem.milestones.every((milestone) => milestone.state === "done"));
}

export async function importLegacyXls(file: File): Promise<LegacyImportResult> {
  const XLSX = await import("xlsx");
  globalThis.__legacyXlsx = XLSX;
  try {
    let workbook: WorkBook;
    try {
      workbook = XLSX.read(await file.arrayBuffer(), { type: "array", raw: true, cellStyles: true, cellComments: true });
    } catch {
      throw new Error("无法读取旧版 .xls 文件，请确认文件没有损坏");
    }

    const summarySheet = findSheet(workbook, ["序号", "项目名称", "业务dri", "出样月份"]);
    const detailSheet = findSheet(workbook, ["no", "pm", "projectno", "projectname", "status"]);
    if (!summarySheet || !detailSheet) throw new Error("无法识别旧版研发部项目表，请确认包含 Summary 和 Detail 两张表");

    const summaryRows = sheetToRows(summarySheet);
    const summaryHeaderRow = summaryRows.findIndex((row) => {
      const headers = row.map(normalizeHeader);
      return ["序号", "项目类别", "项目名称", "业务dri", "出样月份", "项目进度"].every((header) => headers.includes(header));
    });
    if (summaryHeaderRow < 0) throw new Error("旧版 Summary 表头不完整");
    const summaryHeaders = summaryRows[summaryHeaderRow];
    const summaryNoIndex = headerIndex(summaryHeaders, "序号");
    const summaryCategoryIndex = headerIndex(summaryHeaders, "项目类别");
    const summaryNameIndex = headerIndex(summaryHeaders, "项目名称");
    const summaryDriIndex = headerIndex(summaryHeaders, "业务dri");
    const summaryMonthIndex = headerIndex(summaryHeaders, "出样月份");
    const summaryProgressIndex = headerIndex(summaryHeaders, "项目进度");
    const milestoneColumnIndexes = Array.from(
      { length: summaryProgressIndex - summaryMonthIndex - 1 },
      (_, index) => summaryMonthIndex + index + 1,
    );
    if (milestoneColumnIndexes.length !== 15) throw new Error(`旧版 Summary 表必须包含 15 个阶段，当前识别到 ${milestoneColumnIndexes.length} 个`);

    const milestoneDefinitions: MilestoneDefinition[] = milestoneColumnIndexes.map((columnIndex, index) => ({
      id: `m${String(index + 1).padStart(2, "0")}`,
      name: normalizeText(summaryHeaders[columnIndex]).replace(/\s*\n\s*/g, " "),
      order: index,
    }));
    if (milestoneDefinitions.some((definition) => !definition.name)) throw new Error("旧版 Summary 中存在空白阶段名称");

    const summaryRange = XLSX.utils.decode_range(summarySheet["!ref"] ?? "A1");
    const groups = new Map<number, SummaryGroup>();
    let currentNo = 0;
    for (let rowIndex = summaryHeaderRow + 1; rowIndex < summaryRows.length; rowIndex += 1) {
      const row = summaryRows[rowIndex];
      const serial = Number(row[summaryNoIndex]);
      const hasSerial = Number.isFinite(serial) && serial > 0;
      if (hasSerial) currentNo = serial;
      const subItemName = normalizeText(row[summaryNameIndex]);
      if (!currentNo || !subItemName) continue;
      const milestones = milestoneColumnIndexes.map((columnIndex, index): MilestoneEntry => {
        const address = XLSX.utils.encode_cell({ r: summaryRange.s.r + rowIndex, c: summaryRange.s.c + columnIndex });
        const cell = summarySheet[address] as LegacyCell | undefined;
        const note = cellNote(cell);
        const blocked = isBlockedCell(cell);
        const hasValue = Boolean(normalizeText(row[columnIndex]));
        return {
          milestoneId: milestoneDefinitions[index].id,
          state: blocked ? "blocked" : hasValue ? "done" : "not_started",
          note: note || (blocked ? "由旧版表格的黄色标记导入，请补充风险说明。" : ""),
          color: blocked ? "#FFCC00" : "",
          updatedAt: blocked || hasValue || note ? new Date().toISOString() : null,
        };
      });
      const hasRowData = hasSerial
        || Boolean(normalizeText(row[summaryCategoryIndex]))
        || Boolean(normalizeText(row[summaryDriIndex]))
        || Boolean(normalizeText(row[summaryMonthIndex]))
        || Boolean(normalizeText(row[summaryProgressIndex]))
        || milestones.some((milestone) => milestone.state !== "not_started" || milestone.note);
      if (!hasRowData) continue;
      const group = groups.get(currentNo) ?? { no: currentNo, subItems: [] };
      group.subItems.push({
        name: subItemName,
        category: normalizeText(row[summaryCategoryIndex]),
        businessDri: normalizeText(row[summaryDriIndex]),
        outputMonth: normalizeText(row[summaryMonthIndex]),
        milestones,
      });
      groups.set(currentNo, group);
    }
    if (!groups.size) throw new Error("旧版 Summary 中没有识别到项目数据");

    const detailRows = sheetToRows(detailSheet);
    const detailHeaderRow = detailRows.findIndex((row) => {
      const headers = row.map(normalizeHeader);
      return ["no", "pm", "projectno", "projectname", "status"].every((header) => headers.includes(header));
    });
    if (detailHeaderRow < 0) throw new Error("旧版 Detail 表头不完整");
    const detailHeaders = detailRows[detailHeaderRow];
    const detailIndexes = {
      no: headerIndex(detailHeaders, "no"),
      pm: headerIndex(detailHeaders, "pm"),
      projectNo: headerIndex(detailHeaders, "projectno"),
      name: headerIndex(detailHeaders, "projectname"),
      category: headerIndex(detailHeaders, "category"),
      demandQty: headerIndex(detailHeaders, "demandqty"),
      outputTime: headerIndex(detailHeaders, "outputtime"),
      outputQty: headerIndex(detailHeaders, "outputqty"),
      detailProgress: headerIndex(detailHeaders, "progress"),
      dri: headerIndex(detailHeaders, "dri"),
      cp: headerIndex(detailHeaders, "cp"),
      status: headerIndex(detailHeaders, "status"),
    };
    const details: DetailProject[] = detailRows.slice(detailHeaderRow + 1).flatMap((row) => {
      const no = Number(row[detailIndexes.no]);
      const projectNo = normalizeText(row[detailIndexes.projectNo]);
      if (!Number.isFinite(no) || no <= 0 || !projectNo) return [];
      return [{
        no,
        pm: normalizeText(row[detailIndexes.pm]),
        projectNo,
        name: normalizeText(row[detailIndexes.name]) || projectNo,
        category: normalizeText(row[detailIndexes.category]),
        demandQty: normalizeValue(row[detailIndexes.demandQty]),
        outputTime: normalizeText(row[detailIndexes.outputTime]),
        outputQty: normalizeValue(row[detailIndexes.outputQty]),
        detailProgress: normalizeText(row[detailIndexes.detailProgress]),
        dri: normalizeText(row[detailIndexes.dri]),
        cp: normalizeText(row[detailIndexes.cp]),
        status: statusFromCell(row[detailIndexes.status]),
      }];
    });
    if (details.length !== groups.size) throw new Error(`Summary 有 ${groups.size} 个主项目，但 Detail 有 ${details.length} 个，无法安全导入`);

    const now = new Date().toISOString();
    const usedDetails = new Set<DetailProject>();
    const warnings: string[] = [];
    const projects: Project[] = [...groups.values()].sort((a, b) => a.no - b.no).map((group) => {
      const detail = matchDetail(group, details, usedDetails);
      if (!detail) throw new Error(`无法把 Summary 中的项目 ${group.no} 与 Detail 项目对应`);
      usedDetails.add(detail);
      const projectId = `project-${crypto.randomUUID()}`;
      const subItems: SubItem[] = group.subItems.map((subItem) => ({
        id: `sub-${crypto.randomUUID()}`,
        ...subItem,
        category: subItem.category || detail.category,
        createdAt: now,
        updatedAt: now,
      }));
      let status = detail.status;
      if (status === "closed" && !allMilestonesDone(subItems)) {
        status = "ongoing";
        warnings.push(`${detail.projectNo} 在 Detail 中标为已完成，但阶段不足 100%，已按进行中导入。`);
      }
      return {
        id: projectId,
        no: group.no,
        pm: detail.pm,
        projectNo: detail.projectNo,
        name: detail.name,
        category: detail.category,
        demandQty: detail.demandQty,
        outputTime: detail.outputTime,
        outputQty: detail.outputQty,
        detailProgress: detail.detailProgress,
        dri: detail.dri,
        cp: detail.cp,
        status,
        createdAt: now,
        updatedAt: now,
        subItems,
      };
    });
    warnings.push("旧版 .xls 中嵌入的图片无法自动读取，请在项目详情中重新上传需要保留的图片。");

    return {
      payload: {
        schemaVersion: 1,
        exportedAt: now,
        source: file.name,
        settings: {
          id: "app-settings",
          milestoneDefinitions,
          lastBackupAt: null,
          updatedAt: now,
        },
        projects,
        images: [],
      },
      projectCount: projects.length,
      subItemCount: projects.reduce((sum, project) => sum + project.subItems.length, 0),
      warnings,
    };
  } finally {
    delete globalThis.__legacyXlsx;
  }
}
