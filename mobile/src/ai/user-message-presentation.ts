export const USER_MESSAGE_PRESENTATION = Object.freeze({ collapseCharacters: 12000, collapseLogicalLines: 80, previewCharacters: 640, previewLogicalLines: 12, previewVisualLines: 14 });
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
function logicalPrefix(source: string, maximumLines: number): string {
  let line = 1;
  for (const separator of source.matchAll(/\r\n|\r|\n/gu)) {
    if (line === maximumLines) return source.slice(0, separator.index);
    line += 1;
  }
  return source;
}
export function presentUserMessage(source: string, expanded = false) {
  const logicalLines = source.split(/\r\n|\r|\n/u).length;
  const collapsible = source.length > USER_MESSAGE_PRESENTATION.collapseCharacters || logicalLines > USER_MESSAGE_PRESENTATION.collapseLogicalLines;
  if (!collapsible || expanded) return { text: source, collapsible, collapsed: false, logicalLines };
  const lines = logicalPrefix(source, USER_MESSAGE_PRESENTATION.previewLogicalLines);
  let preview = safePrefix(lines, USER_MESSAGE_PRESENTATION.previewCharacters);
  if (preview.length < lines.length) {
    const boundary = Math.max(preview.lastIndexOf(' '), preview.lastIndexOf('\n'), preview.lastIndexOf('\t'));
    if (boundary >= preview.length - 48) preview = preview.slice(0, boundary);
  }
  // If independently revised budgets ever expose the whole eligible source,
  // keep active collapse truthful. Prefixes retain the source's CR/LF bytes.
  if (preview.length === source.length) {
    preview = logicalPrefix(source, USER_MESSAGE_PRESENTATION.collapseLogicalLines);
  }
  const excerpt = preview.trimEnd();
  return { text: excerpt + (excerpt.length < source.length ? '…' : ''), collapsible: true, collapsed: true, logicalLines };
}
