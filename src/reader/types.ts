export type BookFormat = 'pdf' | 'epub';

/** 归一化到 0..1 的矩形，相对所在页（PDF）或可视容器。跨设备、跨字号都不会漂移。 */
export interface NormalizedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 统一位置锚点。这是整个阅读器的核心抽象：
 * PDF 用 page + rects，EPUB 用 cfi，上层能力（进度、标注、生词、朗读、搜索）只认这一个类型。
 */
export interface Location {
  bookId: string;
  format: BookFormat;
  /** PDF：从 1 开始的页码 */
  page?: number;
  /** EPUB：CFI 或章节 href */
  cfi?: string;
  /** 标注命中的矩形（PDF 高亮重绘用） */
  rects?: NormalizedRect[];
  chapter?: string;
  /** 全文进度 0..1 */
  percent: number;
  /** 原文片段，用于版本变化时的兜底定位 */
  excerpt?: string;
}

export interface BookMeta {
  id: string;
  title: string;
  author?: string;
  format: BookFormat;
  size: number;
}

export interface TocItem {
  label: string;
  depth: number;
  location: Location;
}

export interface TextSelection {
  text: string;
  /** 所在句子，查词/翻译的语境来源 */
  context?: string;
  /** 视口坐标，用于定位气泡 */
  rect: DOMRect;
  location: Location;
}

export interface ReaderTheme {
  /** 百分比，100 为默认字号 */
  fontSize: number;
  theme: 'light' | 'sepia' | 'dark';
  lineHeight: number;
}

export interface HighlightAnchor {
  id: string;
  location: Location;
}

export interface OpenResult {
  meta: BookMeta;
  toc: TocItem[];
}

/** 渲染适配器：PDF 与 EPUB 各实现一份，上层只依赖这个接口。 */
export interface ReaderAdapter {
  readonly format: BookFormat;
  open(source: Blob): Promise<OpenResult>;
  mount(host: HTMLElement): Promise<void>;
  goTo(location: Location | null): Promise<void>;
  currentLocation(): Promise<Location>;
  next(): Promise<void>;
  prev(): Promise<void>;
  onSelect(cb: (sel: TextSelection) => void): () => void;
  onLocationChange(cb: (loc: Location) => void): () => void;
  setHighlights?(items: HighlightAnchor[]): void;
  applyTheme?(theme: ReaderTheme): void;
  destroy(): void;
}
