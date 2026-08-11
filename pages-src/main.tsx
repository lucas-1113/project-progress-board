import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ProjectBoard } from "../app/ProjectBoard";
import { PwaRegistration } from "../app/PwaRegistration";
import "../app/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PwaRegistration />
    <ProjectBoard />
  </StrictMode>,
);
