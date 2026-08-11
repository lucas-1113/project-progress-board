"use client";

import { AppSettings, ImageRecord, Project, STATE_LABELS, STATUS_LABELS } from "../types";

const escapeCsv = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const downloadCsv = (rows: unknown[][], fileName: string) => {
  const text = `\uFEFF${rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export function exportProjectCsv(projects: Project[], images: ImageRecord[]): void {
  const rows: unknown[][] = [[
    "序号", "PM", "项目编号", "项目名称", "类别", "需求数量", "计划出样时间", "出样数量",
    "详细进展", "负责人", "检查日期", "状态", "子项数量", "图片数量",
  ]];
  projects.forEach((project) => rows.push([
    project.no, project.pm, project.projectNo, project.name, project.category, project.demandQty,
    project.outputTime, project.outputQty, project.detailProgress, project.dri, project.cp,
    STATUS_LABELS[project.status], project.subItems.length,
    images.filter((image) => image.projectId === project.id).length,
  ]));
  downloadCsv(rows, `项目详情-${new Date().toISOString().slice(0, 10)}.csv`);
}

export function exportMilestoneCsv(projects: Project[], settings: AppSettings): void {
  const definitions = [...settings.milestoneDefinitions].sort((a, b) => a.order - b.order);
  const rows: unknown[][] = [[
    "项目序号", "项目编号", "主项目名称", "子项名称", "阶段序号", "阶段名称", "状态", "备注", "强调色", "更新时间",
  ]];
  projects.forEach((project) => {
    project.subItems.forEach((subItem) => {
      definitions.forEach((definition, index) => {
        const milestone = subItem.milestones.find((entry) => entry.milestoneId === definition.id);
        rows.push([
          project.no, project.projectNo, project.name, subItem.name, index + 1, definition.name,
          milestone ? STATE_LABELS[milestone.state] : "未开始", milestone?.note ?? "", milestone?.color ?? "",
          milestone?.updatedAt ?? "",
        ]);
      });
    });
  });
  downloadCsv(rows, `项目里程碑-${new Date().toISOString().slice(0, 10)}.csv`);
}
