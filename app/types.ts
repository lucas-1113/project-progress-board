export type MilestoneState = "not_started" | "in_progress" | "done" | "blocked";
export type ProjectStatus = "ongoing" | "risk" | "closed";

export interface MilestoneDefinition {
  id: string;
  name: string;
  order: number;
}

export interface MilestoneEntry {
  milestoneId: string;
  state: MilestoneState;
  note: string;
  color: string;
  updatedAt: string | null;
}

export interface SubItem {
  id: string;
  name: string;
  category: string;
  businessDri: string;
  outputMonth: string;
  milestones: MilestoneEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
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
  createdAt: string;
  updatedAt: string;
  subItems: SubItem[];
}

export interface AppSettings {
  id: "app-settings";
  milestoneDefinitions: MilestoneDefinition[];
  lastBackupAt: string | null;
  updatedAt: string;
}

export interface ImageRecord {
  id: string;
  projectId: string;
  name: string;
  type: string;
  blob: Blob;
  order: number;
  createdAt: string;
}

export interface PortableImageRecord extends Omit<ImageRecord, "blob"> {
  dataBase64: string;
}

export interface PortablePayload {
  schemaVersion: 1;
  exportedAt: string;
  source?: string;
  settings: AppSettings;
  projects: Project[];
  images: PortableImageRecord[];
}

export interface AppData {
  settings: AppSettings;
  projects: Project[];
  images: ImageRecord[];
}

export const DEFAULT_MILESTONES: MilestoneDefinition[] = [
  "立项 (PM)",
  "ID 确认 (业务/ID)",
  "任务分解 (PM)",
  "ID 设计完成 (ID)",
  "结构设计完成 (ME)",
  "硬件设计完成 (EE)",
  "软件设计完成 (SW)",
  "硬件主板打样 (EE)",
  "主板焊接",
  "硬件功能确认 (EE)",
  "软件调试确认 (SW)",
  "可靠性测试 (TE)",
  "产品体验测试 (TE)",
  "样品评审 (ALL)",
  "出样 (PM)",
].map((name, index) => ({ id: `m${String(index + 1).padStart(2, "0")}`, name, order: index }));

export const STATE_LABELS: Record<MilestoneState, string> = {
  not_started: "未开始",
  in_progress: "进行中",
  done: "已完成",
  blocked: "阻塞",
};

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  ongoing: "进行中",
  risk: "风险",
  closed: "已结案",
};

export function emptyMilestones(definitions: MilestoneDefinition[]): MilestoneEntry[] {
  return definitions.map((definition) => ({
    milestoneId: definition.id,
    state: "not_started",
    note: "",
    color: "",
    updatedAt: null,
  }));
}

export function createEmptySettings(): AppSettings {
  return {
    id: "app-settings",
    milestoneDefinitions: DEFAULT_MILESTONES,
    lastBackupAt: null,
    updatedAt: new Date().toISOString(),
  };
}
