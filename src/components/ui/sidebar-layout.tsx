"use client";

import {
  CloseButton,
  Dialog,
  DialogBackdrop,
  DialogPanel,
} from "@headlessui/react";
import { Menu, X, ChevronLeft } from "lucide-react";
import {
  useState,
  useEffect,
  createContext,
  useContext,
  type ReactNode,
} from "react";

const SIDEBAR_STORAGE_KEY = "sidebar-collapsed";

interface SidebarCollapseCtx {
  collapsed: boolean;
  toggle: () => void;
}
const SidebarCollapseContext = createContext<SidebarCollapseCtx | null>(null);
export function useSidebarCollapse() {
  return useContext(SidebarCollapseContext);
}

interface SidebarLayoutProps {
  sidebar: ReactNode;
  navbar?: ReactNode;
  children: ReactNode;
}

export function SidebarLayout({
  sidebar,
  navbar,
  children,
}: SidebarLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true");
  }, []);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
  };

  return (
    <div className="relative isolate flex h-svh w-full bg-white max-lg:flex-col lg:bg-zinc-100 dark:bg-zinc-900 dark:lg:bg-zinc-950">
      {/* Mobile sidebar overlay */}
      <Dialog open={sidebarOpen} onClose={setSidebarOpen} className="lg:hidden">
        <DialogBackdrop
          transition
          className="fixed inset-0 bg-black/30 transition-opacity data-[closed]:opacity-0 data-[enter]:duration-300 data-[leave]:duration-200"
        />
        <DialogPanel
          transition
          className="fixed inset-y-0 left-0 w-full max-w-80 p-2 transition duration-300 ease-in-out data-[closed]:-translate-x-full"
        >
          <div className="flex h-full flex-col rounded-lg bg-white shadow-sm ring-1 ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10">
            <div className="-mb-3 px-4 pt-3">
              <CloseButton
                as="button"
                aria-label="Fechar menu"
                className="flex size-8 items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-950 dark:hover:text-white"
              >
                <X className="size-5" />
              </CloseButton>
            </div>
            {sidebar}
          </div>
        </DialogPanel>
      </Dialog>

      {/* Desktop sidebar */}
      <div
        className={`fixed inset-y-0 left-0 max-lg:hidden transition-[width] duration-200 ease-in-out ${
          collapsed ? "w-0" : "w-64"
        }`}
      >
        <div
          className={`flex h-full flex-col border-r border-zinc-950/5 bg-white dark:border-white/5 dark:bg-zinc-900 w-64 transition-transform duration-200 ease-in-out ${
            collapsed ? "-translate-x-full" : "translate-x-0"
          }`}
        >
          <SidebarCollapseContext.Provider value={{ collapsed, toggle: toggleCollapsed }}>
            {sidebar}
          </SidebarCollapseContext.Provider>
        </div>
      </div>

      {/*
        Edge toggle — único ponto de entrada pra abrir/fechar a sidebar
        no desktop. Fica colado na borda direita da sidebar quando aberta
        e na borda esquerda do conteúdo quando fechada, ancorado no rodapé
        pra não competir com o dropdown da org no header.
      */}
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-label={collapsed ? "Abrir menu" : "Recolher menu"}
        title={collapsed ? "Abrir menu" : "Recolher menu"}
        className={`group fixed bottom-4 z-30 hidden h-7 w-5 items-center justify-center rounded-r-md bg-white text-zinc-400 opacity-50 ring-1 ring-zinc-950/5 transition-all duration-200 ease-in-out hover:bg-zinc-50 hover:text-zinc-900 hover:opacity-100 dark:bg-zinc-900 dark:text-zinc-500 dark:ring-white/10 dark:hover:bg-zinc-800 dark:hover:text-white lg:flex ${
          collapsed ? "left-0" : "left-64"
        }`}
      >
        <ChevronLeft
          className={`size-3.5 transition-transform duration-200 ${
            collapsed ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Content area */}
      <main
        className={`flex flex-1 flex-col min-h-0 lg:min-w-0 transition-[padding] duration-200 ease-in-out ${
          collapsed ? "lg:pl-0" : "lg:pl-64"
        }`}
      >
        {/* Mobile header */}
        <div className="flex items-center gap-4 border-b border-zinc-950/5 px-4 py-2.5 dark:border-white/5 lg:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Abrir menu"
            className="text-zinc-500 hover:text-zinc-950 dark:hover:text-white"
          >
            <Menu className="size-5" />
          </button>
          <div className="min-w-0 flex-1">{navbar}</div>
        </div>

        {/* Page content */}
        <div className="flex flex-1 flex-col min-h-0 min-w-0 overflow-hidden lg:bg-white lg:shadow-sm lg:ring-1 lg:ring-zinc-950/5 dark:lg:bg-zinc-900 dark:lg:ring-white/10">
          <SidebarCollapseContext.Provider value={{ collapsed, toggle: toggleCollapsed }}>
            {children}
          </SidebarCollapseContext.Provider>
        </div>
      </main>
    </div>
  );
}
