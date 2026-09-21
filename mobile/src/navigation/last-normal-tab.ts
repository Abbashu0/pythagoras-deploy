export type NormalTabKey = 'index' | 'materials' | 'tools' | 'lectures';

const normalTabIcons = {
  index: 'house.fill',
  materials: 'books.vertical.fill',
  tools: 'wrench.fill',
  lectures: 'play.rectangle.fill',
} as const;

const normalTabLabels = {
  index: 'الرئيسية',
  materials: 'المواد',
  tools: 'الأدوات',
  lectures: 'المحاضرات',
} as const;

const normalTabPaths = {
  index: '/',
  materials: '/materials',
  tools: '/tools',
  lectures: '/lectures',
} as const;

let lastNormalTab: NormalTabKey = 'index';

export function resolveNormalTabFromSegments(
  segments: readonly string[]
): NormalTabKey | null {
  if (segments.includes('ai') || segments.includes('chat')) return null;
  if (segments.includes('materials')) return 'materials';
  if (segments.includes('tools')) return 'tools';
  if (segments.includes('lectures')) return 'lectures';
  return 'index';
}

export function rememberNormalTab(tab: NormalTabKey) {
  lastNormalTab = tab;
}

export function getLastNormalTab() {
  return lastNormalTab;
}

export function parseNormalTab(value: string | string[] | undefined): NormalTabKey {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate === 'materials' || candidate === 'tools' || candidate === 'lectures') {
    return candidate;
  }
  return 'index';
}

export function getNormalTabIcon(tab: NormalTabKey) {
  return normalTabIcons[tab];
}

export function getNormalTabLabel(tab: NormalTabKey) {
  return normalTabLabels[tab];
}

export function getNormalTabPath(tab: NormalTabKey) {
  return normalTabPaths[tab];
}
