"use client"

import { Toast } from "@base-ui/react/toast"
import { CircleAlert, CircleCheck, Info, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

type ToastType = "success" | "error" | "info"

interface ToastOptions {
  description?: string
  /** A button in the toast, e.g. "Undo". */
  action?: { label: string; onClick: () => void }
}

/** One manager for the whole app, so toasts can be raised from anywhere. */
const toastManager = Toast.createToastManager()

function show(type: ToastType, title: string, options: ToastOptions = {}): string {
  const { description, action } = options
  return toastManager.add({
    type,
    title,
    description,
    // Errors stay longer: they usually need reading.
    timeout: type === "error" ? 8000 : 4000,
    priority: type === "error" ? "high" : "low",
    actionProps: action ? { children: action.label, onClick: action.onClick } : undefined,
  })
}

const toast = {
  success: (title: string, options?: ToastOptions) => show("success", title, options),
  error: (title: string, options?: ToastOptions) => show("error", title, options),
  info: (title: string, options?: ToastOptions) => show("info", title, options),
  dismiss: (id?: string) => toastManager.close(id),
}

const ICONS = {
  success: CircleCheck,
  error: CircleAlert,
  info: Info,
} satisfies Record<ToastType, unknown>

function ToastList() {
  const { toasts } = Toast.useToastManager()
  return toasts.map((item) => {
    const Icon = ICONS[(item.type as ToastType | undefined) ?? "info"] ?? Info
    return (
      <Toast.Root
        key={item.id}
        toast={item}
        data-slot="toast"
        className={cn(
          "pointer-events-auto relative flex w-full items-start gap-2.5 rounded-xl bg-popover py-3 pr-10 pl-3.5 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10 transition-[opacity,translate] duration-200 ease-out [transform:translate(var(--toast-swipe-movement-x),var(--toast-swipe-movement-y))] select-none",
          "data-starting-style:translate-y-3 data-starting-style:opacity-0 data-ending-style:opacity-0 data-limited:opacity-0",
          "data-[swipe-direction=right]:data-ending-style:translate-x-full data-[swipe-direction=down]:data-ending-style:translate-y-full",
          "data-swiping:transition-none"
        )}
      >
        <Icon
          aria-hidden="true"
          className={cn(
            "mt-0.5 size-4 shrink-0",
            item.type === "success" && "text-emerald-600 dark:text-emerald-400",
            item.type === "error" && "text-destructive",
            item.type === "info" && "text-brand"
          )}
        />
        <Toast.Content className="min-w-0 flex-1">
          <Toast.Title className="font-medium break-words" />
          <Toast.Description className="mt-0.5 text-xs leading-relaxed break-words text-muted-foreground empty:hidden" />
          {item.actionProps && (
            <Toast.Action className="mt-2 inline-flex h-6 items-center rounded-md border bg-background px-2 text-xs font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50" />
          )}
        </Toast.Content>
        <Toast.Close
          aria-label="Dismiss"
          className="absolute top-2.5 right-2.5 inline-flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <XIcon className="size-3.5" />
        </Toast.Close>
      </Toast.Root>
    )
  })
}

/** Where toasts appear. Rendered once, in the root layout. */
function Toaster() {
  return (
    <Toast.Provider toastManager={toastManager} limit={3}>
      <Toast.Portal>
        <Toast.Viewport className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[calc(100vw-2rem)] max-w-sm flex-col items-end gap-2 outline-none">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  )
}

export { toast, Toaster }
