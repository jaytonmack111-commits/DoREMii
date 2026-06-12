import type { DoReMiApi } from '../shared/types'

declare global {
  interface Window {
    doReMi: DoReMiApi
  }
}
