/**
 * 固件编号功能对照表。
 * 来源：合宙文档《固件版本 - luatos@air780ehv》中的“Air700ECH/Air780EHM/EHV/EGH/EGG/EHU/EHN 固件支持列表”，2026-11-13 抓取。
 * 1–99 号为 32 位固件，101–199 号为对应的 64 位版本，功能相同。
 * 只适用于上述 EC718H 系列；其它型号（Air780EPM、Air8000 …）的编号功能不同，界面上显示“下载后查看”。
 */
export const FEATURE_ORDER = ["TTS", "语音通话", "音频", "摄像头", "AirUI", "LCD", "U8G2", "墨水屏", "蓝牙", "对讲", "FTP", "FAT32", "外挂Flash", "CAN", "LoRa", "Protobuf", "FFT", "压缩", "中文字库"] as const
export const FEATURE_EN: Record<string, string> = {"TTS": "TTS", "语音通话": "Voice call", "音频": "Audio", "摄像头": "Camera", "AirUI": "AirUI", "LCD": "LCD", "U8G2": "U8G2", "墨水屏": "E-ink", "蓝牙": "Bluetooth", "对讲": "Walkie-talkie", "FTP": "FTP", "FAT32": "FAT32", "外挂Flash": "Ext. flash", "CAN": "CAN", "LoRa": "LoRa", "Protobuf": "Protobuf", "FFT": "FFT", "压缩": "Compress", "中文字库": "CJK font"}

export interface BuildSpec {
  /** 32 位编号（1–99），64 位为 +100 */
  n: number
  scriptKB: number
  fsKB: number
  features: string[]
}

export const EC718H_BUILDS: BuildSpec[] = [
  {"n": 1, "scriptKB": 512, "fsKB": 768, "features": ["TTS", "语音通话", "音频", "摄像头", "LCD", "U8G2", "墨水屏", "FTP", "FAT32", "外挂Flash", "CAN", "LoRa", "Protobuf", "FFT", "压缩", "中文字库"]},
  {"n": 2, "scriptKB": 512, "fsKB": 640, "features": ["语音通话", "音频", "摄像头", "LCD", "U8G2", "墨水屏", "FTP", "FAT32", "外挂Flash", "CAN", "LoRa", "Protobuf", "FFT", "压缩", "中文字库"]},
  {"n": 3, "scriptKB": 512, "fsKB": 512, "features": ["TTS", "音频", "摄像头", "LCD", "U8G2", "墨水屏", "FTP", "FAT32", "外挂Flash", "CAN", "LoRa", "Protobuf", "FFT", "压缩", "中文字库"]},
  {"n": 4, "scriptKB": 512, "fsKB": 1280, "features": ["音频", "摄像头", "LCD", "U8G2", "墨水屏", "对讲", "FTP", "FAT32", "外挂Flash", "CAN", "LoRa", "Protobuf", "FFT", "压缩", "中文字库"]},
  {"n": 5, "scriptKB": 512, "fsKB": 1408, "features": ["TTS", "音频", "摄像头", "LCD", "U8G2", "墨水屏", "对讲", "FTP", "FAT32", "外挂Flash", "CAN", "LoRa", "Protobuf", "FFT", "压缩", "中文字库"]},
  {"n": 6, "scriptKB": 512, "fsKB": 1408, "features": ["音频", "摄像头", "LCD", "U8G2", "墨水屏", "FTP", "FAT32", "外挂Flash", "CAN", "LoRa", "Protobuf", "FFT", "压缩", "中文字库"]},
  {"n": 7, "scriptKB": 512, "fsKB": 1536, "features": ["TTS", "音频", "摄像头", "LCD", "U8G2", "墨水屏", "FTP", "FAT32", "外挂Flash", "CAN", "LoRa", "Protobuf", "FFT", "压缩", "中文字库"]},
  {"n": 8, "scriptKB": 512, "fsKB": 1536, "features": ["语音通话", "音频", "摄像头", "LCD", "U8G2", "墨水屏", "FTP", "FAT32", "外挂Flash", "CAN", "LoRa", "Protobuf", "FFT", "压缩", "中文字库"]},
  {"n": 9, "scriptKB": 512, "fsKB": 2304, "features": ["音频", "摄像头", "LCD", "U8G2", "墨水屏", "对讲", "FTP", "FAT32", "外挂Flash", "CAN", "LoRa", "Protobuf", "FFT", "压缩", "中文字库"]},
  {"n": 10, "scriptKB": 512, "fsKB": 2432, "features": ["音频", "摄像头", "LCD", "U8G2", "墨水屏", "FTP", "FAT32", "外挂Flash", "CAN", "LoRa", "Protobuf", "FFT", "压缩", "中文字库"]},
  {"n": 11, "scriptKB": 256, "fsKB": 3584, "features": ["LCD", "U8G2", "墨水屏", "FTP", "外挂Flash", "CAN", "LoRa", "Protobuf", "FFT"]},
  {"n": 12, "scriptKB": 1024, "fsKB": 2304, "features": ["LCD", "U8G2", "墨水屏", "FTP", "CAN", "LoRa", "Protobuf", "FFT"]},
  {"n": 13, "scriptKB": 512, "fsKB": 512, "features": ["TTS", "语音通话", "音频", "摄像头", "LCD", "U8G2", "墨水屏", "FTP", "FAT32", "CAN", "LoRa", "Protobuf", "FFT", "压缩"]},
  {"n": 14, "scriptKB": 512, "fsKB": 1024, "features": ["AirUI", "LCD", "FTP", "FAT32", "外挂Flash", "CAN", "LoRa", "Protobuf", "FFT", "压缩", "中文字库"]},
  {"n": 15, "scriptKB": 512, "fsKB": 1664, "features": ["音频", "摄像头", "AirUI", "LCD", "对讲", "FTP", "FAT32", "CAN", "LoRa", "Protobuf", "FFT", "压缩", "中文字库"]},
  {"n": 16, "scriptKB": 384, "fsKB": 384, "features": ["TTS", "语音通话", "音频", "摄像头", "AirUI", "LCD", "FTP", "FAT32", "CAN", "LoRa", "Protobuf", "FFT", "压缩", "中文字库"]},
  {"n": 17, "scriptKB": 512, "fsKB": 1024, "features": ["AirUI", "LCD", "蓝牙", "FTP", "FAT32", "CAN", "Protobuf", "压缩", "中文字库"]},
  {"n": 19, "scriptKB": 1024, "fsKB": 168, "features": ["AirUI", "LCD", "FTP", "FAT32", "外挂Flash", "CAN", "LoRa", "Protobuf", "FFT", "压缩", "中文字库"]},
  {"n": 20, "scriptKB": 512, "fsKB": 1536, "features": ["TTS", "语音通话", "音频", "LCD", "FTP", "FAT32", "外挂Flash", "CAN", "Protobuf", "压缩"]},
  {"n": 21, "scriptKB": 704, "fsKB": 256, "features": ["TTS", "音频", "AirUI", "LCD", "FAT32", "外挂Flash", "中文字库"]},
  {"n": 22, "scriptKB": 512, "fsKB": 512, "features": ["语音通话", "音频", "AirUI", "LCD", "FTP", "FAT32", "外挂Flash", "CAN", "Protobuf", "压缩", "中文字库"]},
  {"n": 23, "scriptKB": 1024, "fsKB": 1920, "features": ["LCD", "U8G2", "墨水屏", "FTP", "FAT32", "CAN", "LoRa", "Protobuf", "FFT", "中文字库"]},
  {"n": 24, "scriptKB": 512, "fsKB": 768, "features": ["TTS", "语音通话", "音频", "摄像头", "FTP", "FAT32", "CAN", "LoRa", "Protobuf", "FFT", "压缩"]},
]

/** 适用上表的型号 */
export const EC718H_MODELS = ['Air780EHM', 'Air780EHN', 'Air780EHV', 'Air780EHU', 'Air780EGH', 'Air780EGG', 'Air700ECH']

/** luatos-cli 支持的芯片家族 */
export type ChipFamily = 'ec718' | 'ec618' | 'ccm4211' | 'xt804' | 'bk72xx' | 'uis8910'

export interface FamilyInfo {
  /** 显示名 */
  name: string
  /** 插上 USB 就能自动识别、自动进下载模式（合宙 EC7xx/EC618 的 USB 复合设备） */
  usb: boolean
  /** 工作台现在能不能刷（其他家族要选串口，第二步再做） */
  flash: boolean
  /** 工作台说明 */
  zh: string
  en: string
}

export const FAMILIES: Record<ChipFamily, FamilyInfo> = {
  ec718: { name: 'EC718', usb: true, flash: true, zh: 'USB 直连，自动识别', en: 'USB, auto-detected' },
  ec618: { name: 'EC618', usb: true, flash: true, zh: 'USB 直连；刷机未实测', en: 'USB; flashing not yet tested' },
  ccm4211: { name: 'CCM4211', usb: false, flash: false, zh: '经串口，刷机待支持', en: 'Serial; flashing coming later' },
  xt804: { name: 'XT804', usb: false, flash: false, zh: '经串口，刷机待支持', en: 'Serial; flashing coming later' },
  bk72xx: { name: 'BK7258', usb: false, flash: false, zh: '经串口，刷机待支持', en: 'Serial; flashing coming later' },
  uis8910: { name: 'UIS8910', usb: false, flash: false, zh: '刷机待支持', en: 'Flashing coming later' },
}

export interface ModelInfo {
  model: string
  family: ChipFamily
  /** 芯片：EC718 系列取自固件包 binpkg 的产品名，其它取自 info.json 的 chip.type */
  chip: string
}

/**
 * 合宙 CDN 上有 LuatOS 固件、且 luatos-cli 支持的型号（2026-11-13 逐个下载最新固件核对芯片）。
 * Air724UG 的固件是 LuatOS-Air（.pac），不是 LuatOS-SoC，没有列入。
 */
export const MODELS: ModelInfo[] = [
  { model: 'Air780EHM', family: 'ec718', chip: 'EC718HM' },
  { model: 'Air780EHN', family: 'ec718', chip: 'EC718HM' },
  { model: 'Air780EHV', family: 'ec718', chip: 'EC718HM' },
  { model: 'Air780EHU', family: 'ec718', chip: 'EC718HM' },
  { model: 'Air780EGH', family: 'ec718', chip: 'EC718HM' },
  { model: 'Air780EGG', family: 'ec718', chip: 'EC718HM' },
  { model: 'Air780EGP', family: 'ec718', chip: 'EC718PM' },
  { model: 'Air780EPM', family: 'ec718', chip: 'EC718PM' },
  { model: 'Air780EP', family: 'ec718', chip: 'EC718P' },
  { model: 'Air780EX2', family: 'ec718', chip: 'EC718PM' },
  { model: 'Air700ECH', family: 'ec718', chip: 'EC718HM' },
  { model: 'Air700ECP', family: 'ec718', chip: 'EC718PM' },
  { model: 'Air8000', family: 'ec718', chip: 'EC718HM' },
  { model: 'Air1780H', family: 'ec718', chip: 'EC718HM' },
  { model: 'Air1780P', family: 'ec718', chip: 'EC718PM' },
  { model: 'Air780E', family: 'ec618', chip: 'EC618' },
  { model: 'Air780EG', family: 'ec618', chip: 'EC618' },
  { model: 'Air1601', family: 'ccm4211', chip: 'CCM4211' },
  { model: 'Air1602', family: 'ccm4211', chip: 'CCM4211' },
  { model: 'Air1603', family: 'ccm4211', chip: 'CCM4211' },
  { model: 'Air6208', family: 'xt804', chip: 'XT804' },
  { model: 'Air8101', family: 'bk72xx', chip: 'BK7258' },
  { model: 'Air722', family: 'uis8910', chip: 'UIS8910DM' },
  { model: 'Air795UG', family: 'uis8910', chip: 'UIS8910DM' },
]

/** 固件资源页和项目里可选的型号 */
export const FW_MODELS = MODELS.map((m) => m.model)

export const CHIP_OF: Record<string, string> = Object.fromEntries(MODELS.map((m) => [m.model, m.chip]))

export function familyOf(model: string): ChipFamily | null {
  return MODELS.find((m) => m.model === model)?.family ?? null
}

/** 工作台现在能不能刷这个型号（不在列表里的型号按 EC718 处理，兼容以前的项目） */
export function canFlash(model: string) {
  const f = familyOf(model)
  return f ? FAMILIES[f].flash : true
}

/** 对本项目这类只用联网功能的场景，推荐最精简、脚本区最大的 112 号 */
export const RECOMMENDED_BUILD = 112

export function buildSpec(model: string, build: number | null | undefined): (BuildSpec & { bits: 32 | 64 }) | null {
  if (!build || !EC718H_MODELS.includes(model)) return null
  const base = build > 100 ? build - 100 : build
  const s = EC718H_BUILDS.find((b) => b.n === base)
  return s ? { ...s, bits: build > 100 ? 64 : 32 } : null
}

export function buildSummary(features: string[], t: (zh: string, en: string) => string) {
  const key = features.filter((f) => ['TTS', '语音通话', '音频', '摄像头', 'AirUI', 'LCD', '蓝牙', '对讲'].includes(f)).slice(0, 3)
  if (!key.length) return t('精简联网', 'Lean networking')
  return key.map((f) => t(f, FEATURE_EN[f] ?? f)).join(' · ')
}

/** EC718 系列老写法的固件文件名（旧项目只存了版本 + 编号） */
export function fwFileName(model: string, version: string, build: number) {
  return `LuatOS-SoC_${version}_${model}_${build}.soc`
}

/** 项目底层用的固件文件名：新项目存了 file，旧项目由版本 + 编号推出 */
export function coreFile(model: string, core: { version: string; build: number; file?: string }) {
  if (core.file) return core.file
  return core.version && core.build ? fwFileName(model, core.version, core.build) : ''
}

/** 文件名末尾的编号：`..._112.soc` → 112；没有编号为 null（与后端 trailing_num 一致） */
export function fileBuild(file: string): number | null {
  const m = file.match(/_(\d+)\.soc$/i)
  return m ? Number(m[1]) : null
}

/**
 * 同一版本里各个固件怎么称呼：
 *   LuatOS-SoC_V2056_Air780EHM_112.soc → 112号；LuatOS-SoC_V1124_EC618_TTS.soc → TTS；
 *   LuatOS-SoC_V1124_EC618.soc、LuatOS-SoC_V1002_AIR6208.soc → 标准版
 */
export function variantLabel(file: string, t: (zh: string, en: string) => string) {
  const m = file.replace(/\.soc$/i, '').match(/^LuatOS-SoC_V\d+_[^_]+(?:_(.+))?$/i)
  const suffix = m?.[1]
  if (!m) return file
  if (!suffix) return t('标准版', 'Standard')
  if (/^\d+$/.test(suffix)) return t(`${suffix}号`, `#${suffix}`)
  return suffix
}

/** 换版本后，在新版本的固件里找“同一种”：同编号或同后缀（如 TTS、FULL）；找不到就用默认的 */
export function pickSameVariant<T extends { build: number | null; file: string }>(model: string, curFile: string, builds: T[]): T | undefined {
  const suffix = curFile.replace(/^LuatOS-SoC_V\d+_/i, '')
  return builds.find((b) => suffix && b.file.replace(/^LuatOS-SoC_V\d+_/i, '') === suffix) ?? defaultBuild(model, builds)
}

/** 新选一个版本时默认用哪个固件：EC718H 用推荐的 112 号，其它用排在最前的（标准版 / 最小编号） */
export function defaultBuild<T extends { build: number | null; file: string }>(model: string, builds: T[]): T | undefined {
  if (EC718H_MODELS.includes(model)) return builds.find((b) => b.build === RECOMMENDED_BUILD) ?? builds[0]
  return builds[0]
}
