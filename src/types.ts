export type Crop = { l: number; r: number; t: number; b: number }
export type Key = { t: number; v: number }
export type Clip = {
  id: string
  kind: 'video' | 'audio' | 'title'
  trackId: string
  mediaId?: string
  link?: string
  start: number // timeline seconds
  in: number // source seconds
  dur: number // timeline seconds (source span = dur * speed)
  speed: number
  volume: number
  keys: Key[]
  fadeIn: number
  fadeOut: number
  transition: number // dissolve/crossfade in duration (overlaps previous clip)
  transOut: number // tail overlap with next clip's transition
  brightness: number
  contrast: number
  saturation: number
  crop: Crop
  scale: number
  posX: number
  posY: number
  text?: string
  font?: string
  size?: number
  color?: string
  x?: number
  y?: number
}
export type Media = {
  id: string; path: string; name: string; w: number; h: number; fps: number; dur: number
  hasAudio: boolean; vcodec: string; bitrate: number; proxy?: string; proxyBusy?: boolean; error?: string
}
export type Track = { id: string; kind: 'video' | 'audio'; name: string; muted?: boolean; hidden?: boolean }
export type Wave = { pps: number; peaks: number[] }

declare global {
  interface Window {
    api: any
    __ove: any
  }
}
