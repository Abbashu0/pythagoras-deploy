export const USER_MESSAGE_PRESENTATION = Object.freeze({ collapseCharacters: 700, collapseLogicalLines: 10, previewCharacters: 320, previewLogicalLines: 7, previewVisualLines: 8 });
function safePrefix(source: string, maximum: number): string {
  const Segmenter = Intl.Segmenter;
  if (typeof Segmenter === 'function') {
    let result = '';
    for (const item of new Segmenter(undefined, { granularity: 'grapheme' }).segment(source)) {
      if (result.length + item.segment.length > maximum) break;
      result += item.segment;
    }
    return result;
  }
  // Hermes fallback: preserve surrogate pairs, combining marks, variation selectors and ZWJ chains.
  const groups: string[] = [];
  for (const point of source) {
    if (groups.length && (/\p{M}|[\u200d\ufe0e\ufe0f]/u.test(point) || groups[groups.length - 1].endsWith('\u200d'))) groups[groups.length - 1] += point;
    else groups.push(point);
  }
  let result = '';
  for (const group of groups) { if (result.length + group.length > maximum) break; result += group; }
  return result;
}
export function presentUserMessage(source: string, expanded = false) {
  const logicalLines = source.split(/\r\n|\r|\n/u).length;
  const collapsible = source.length > USER_MESSAGE_PRESENTATION.collapseCharacters || logicalLines > USER_MESSAGE_PRESENTATION.collapseLogicalLines;
  if (!collapsible || expanded) return { text: source, collapsible, collapsed: false, logicalLines };
  const lines = source.split(/\r\n|\r|\n/u).slice(0, USER_MESSAGE_PRESENTATION.previewLogicalLines).join('\n');
  let preview = safePrefix(lines, USER_MESSAGE_PRESENTATION.previewCharacters);
  if (preview.length < lines.length) {
    const boundary = Math.max(preview.lastIndexOf(' '), preview.lastIndexOf('\n'), preview.lastIndexOf('\t'));
    if (boundary >= preview.length - 48) preview = preview.slice(0, boundary);
  }
  return { text: preview.trimEnd() + '…', collapsible: true, collapsed: true, logicalLines };
}
