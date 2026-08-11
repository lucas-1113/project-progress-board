import type { Metadata } from "next";
import { ProjectBoard } from "./ProjectBoard";

export const metadata: Metadata = {
  title: "项目进度看板",
  description: "15 个里程碑，一页看清所有项目。",
};

export default function Home() {
  return <ProjectBoard />;
}
