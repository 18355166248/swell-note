import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppErrorBoundary } from "@/components/app-error-boundary";
import { DesktopAppFrame } from "@/components/desktop/desktop-app-frame";
import App from "./App";
import { registerServiceWorker } from "@/services/pwa/register";
import { preloadNoteRenderers } from "@/lib/preload-note-renderers";

const EditorLabPage = lazy(() => import("@/components/editor-lab/editor-lab-page"));

function RoutedApplication() {
  return (
    <Routes>
      <Route
        path="/editor-lab"
        element={(
          <Suspense fallback={<div role="status" style={{ padding: 24 }}>正在加载编辑器实验室…</div>}>
            <EditorLabPage />
          </Suspense>
        )}
      />
      <Route path="*" element={<App />} />
    </Routes>
  );
}

if (import.meta.env.PROD) registerServiceWorker();
// 趁 vault 初始化（读本地缓存、连远端）还在跑的时候把编辑器等大 chunk 的请求提前发出去。
// 实验室拥有独立的大型编辑器依赖，进入该路由时不要同时预加载正常工作区。
if (!window.location.hash.startsWith("#/editor-lab")) preloadNoteRenderers();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <HashRouter>
      <AppErrorBoundary>
        <TooltipProvider delayDuration={400}>
          <DesktopAppFrame>
            <RoutedApplication />
          </DesktopAppFrame>
        </TooltipProvider>
      </AppErrorBoundary>
    </HashRouter>
  </React.StrictMode>,
);
