"use client";

import { AppSettings, ImageRecord, PortablePayload, Project } from "../types";

const FORMAT = "personal-project-board";
const ITERATIONS = 250_000;

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

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, usage: KeyUsage[]): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    usage,
  );
}

async function blobToBase64(blob: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

export async function createPortablePayload(
  settings: AppSettings,
  projects: Project[],
  images: ImageRecord[],
): Promise<PortablePayload> {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    settings,
    projects,
    images: await Promise.all(
      images.map(async ({ blob, ...image }) => ({ ...image, dataBase64: await blobToBase64(blob) })),
    ),
  };
}

export async function encryptPayload(payload: PortablePayload, password: string): Promise<string> {
  if (password.length < 8) throw new Error("备份密码至少需要 8 个字符");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ["encrypt"]);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return JSON.stringify({
    format: FORMAT,
    version: 1,
    encryption: {
      algorithm: "AES-GCM",
      kdf: "PBKDF2-SHA-256",
      iterations: ITERATIONS,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
    },
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
  });
}

export async function decryptPackage(packageText: string, password: string): Promise<PortablePayload> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(packageText) as Record<string, unknown>;
  } catch {
    throw new Error("文件不是有效的项目看板备份");
  }
  if (parsed.format !== FORMAT || parsed.version !== 1) throw new Error("不支持的备份格式或版本");
  const encryption = parsed.encryption as Record<string, unknown> | undefined;
  if (!encryption || encryption.algorithm !== "AES-GCM" || encryption.kdf !== "PBKDF2-SHA-256") {
    throw new Error("备份使用了不支持的加密方式");
  }
  try {
    const salt = base64ToBytes(String(encryption.salt));
    const iv = base64ToBytes(String(encryption.iv));
    const key = await deriveKey(password, salt, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      base64ToBytes(String(parsed.ciphertext)),
    );
    const payload = JSON.parse(new TextDecoder().decode(plaintext)) as PortablePayload;
    validatePayload(payload);
    return payload;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("备份")) throw error;
    throw new Error("密码错误，或备份文件已经损坏");
  }
}

export function validatePayload(payload: PortablePayload): void {
  if (!payload || payload.schemaVersion !== 1) throw new Error("备份数据版本不受支持");
  if (!payload.settings || payload.settings.milestoneDefinitions?.length !== 15) {
    throw new Error("备份必须包含 15 个里程碑定义");
  }
  if (!Array.isArray(payload.projects) || !Array.isArray(payload.images)) throw new Error("备份数据结构不完整");
  const projectIds = new Set(payload.projects.map((project) => project.id));
  for (const project of payload.projects) {
    if (!project.id || !Array.isArray(project.subItems)) throw new Error("备份中存在无效项目");
    for (const subItem of project.subItems) {
      if (subItem.milestones.length !== 15) throw new Error(`项目 ${project.no} 的里程碑数量不正确`);
    }
  }
  const imageCounts = new Map<string, number>();
  for (const image of payload.images) {
    if (!projectIds.has(image.projectId)) throw new Error("备份中存在无法关联项目的图片");
    imageCounts.set(image.projectId, (imageCounts.get(image.projectId) ?? 0) + 1);
    if ((imageCounts.get(image.projectId) ?? 0) > 8) throw new Error("备份中单个项目的图片超过 8 张");
  }
}

export function downloadTextFile(content: string, fileName: string, type = "application/octet-stream"): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
