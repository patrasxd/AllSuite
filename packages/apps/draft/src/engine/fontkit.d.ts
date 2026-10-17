declare module 'fontkit' {
  import type { Font, Subset } from 'pdf-lib/es/types/fontkit'
  export function create(bytes: Uint8Array): Omit<Font, 'createSubset'> & {
    createSubset(): Subset & { encode(): Uint8Array }
  }
}
