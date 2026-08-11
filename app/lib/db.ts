"use client";

import { AppData, AppSettings, ImageRecord, PortablePayload, Project, createEmptySettings } from "../types";

const DB_NAME = "personal-project-progress-board";
const DB_VERSION = 1;

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("数据库操作失败"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("数据保存失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("数据保存已取消"));
  });
}

export async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("settings")) {
        database.createObjectStore("settings", { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains("projects")) {
        database.createObjectStore("projects", { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains("images")) {
        const images = database.createObjectStore("images", { keyPath: "id" });
        images.createIndex("projectId", "projectId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开本机数据库"));
    request.onblocked = () => reject(new Error("数据库升级被其他页面阻止，请关闭其他标签页后重试"));
  });
}

export async function loadAppData(): Promise<AppData> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(["settings", "projects", "images"], "readonly");
    const settingsRequest = transaction.objectStore("settings").get("app-settings");
    const projectsRequest = transaction.objectStore("projects").getAll();
    const imagesRequest = transaction.objectStore("images").getAll();
    const [savedSettings, projects, images] = await Promise.all([
      requestToPromise(settingsRequest),
      requestToPromise(projectsRequest),
      requestToPromise(imagesRequest),
    ]);
    await transactionDone(transaction);
    const settings = (savedSettings as AppSettings | undefined) ?? createEmptySettings();
    if (!savedSettings) await saveSettings(settings);
    return {
      settings,
      projects: (projects as Project[]).sort((a, b) => a.no - b.no),
      images: (images as ImageRecord[]).sort((a, b) => a.order - b.order),
    };
  } finally {
    database.close();
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("settings", "readwrite");
    transaction.objectStore("settings").put(settings);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function saveProject(project: Project): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("projects", "readwrite");
    transaction.objectStore("projects").put(project);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function deleteProjectRecord(projectId: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(["projects", "images"], "readwrite");
    transaction.objectStore("projects").delete(projectId);
    const imageStore = transaction.objectStore("images");
    const imageIndex = imageStore.index("projectId");
    const request = imageIndex.openKeyCursor(IDBKeyRange.only(projectId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        imageStore.delete(cursor.primaryKey);
        cursor.continue();
      }
    };
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function saveImageRecord(image: ImageRecord): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("images", "readwrite");
    transaction.objectStore("images").put(image);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function deleteImageRecord(imageId: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("images", "readwrite");
    transaction.objectStore("images").delete(imageId);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

export async function replaceAllData(payload: PortablePayload): Promise<AppData> {
  const imageRecords: ImageRecord[] = payload.images.map(({ dataBase64, ...image }) => ({
    ...image,
    blob: base64ToBlob(dataBase64, image.type),
  }));
  const database = await openDatabase();
  try {
    const transaction = database.transaction(["settings", "projects", "images"], "readwrite");
    const settingsStore = transaction.objectStore("settings");
    const projectsStore = transaction.objectStore("projects");
    const imagesStore = transaction.objectStore("images");
    settingsStore.clear();
    projectsStore.clear();
    imagesStore.clear();
    settingsStore.put(payload.settings);
    payload.projects.forEach((project) => projectsStore.put(project));
    imageRecords.forEach((image) => imagesStore.put(image));
    await transactionDone(transaction);
  } finally {
    database.close();
  }
  return {
    settings: payload.settings,
    projects: payload.projects.sort((a, b) => a.no - b.no),
    images: imageRecords.sort((a, b) => a.order - b.order),
  };
}
