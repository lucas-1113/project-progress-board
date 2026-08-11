import type { Metadata } from "next";
import "./globals.css";
import { PwaRegistration } from "./PwaRegistration";

export const metadata: Metadata = {
  title: "项目进度看板",
  description: "本机保存、支持 Excel 备份的个人项目进度规划工具。",
  manifest: "./manifest.webmanifest",
  openGraph: {
    title: "项目进度看板",
    description: "15 个里程碑，一页看清所有项目。",
    images: [{ url: "./og.png", width: 1200, height: 630, alt: "项目进度看板" }],
  },
  icons: {
    icon: "./icon-192.png",
    apple: "./icon-192.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <PwaRegistration />
        {children}
      </body>
    </html>
  );
}
