/** Runtime phase reported by the desktop Harness supervisor. */
export type RuntimePhase = 'idle' | 'starting' | 'ready' | 'stopping' | 'failed'

/** Snapshot pushed from main to drive splash / window load. */
export interface RuntimeSnapshot {
  phase: RuntimePhase
  message: string
  url?: string
  launchToken?: string
}
