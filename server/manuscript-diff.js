import { diffArrays, diffChars } from 'diff';

// Match the reader's paragraph splitting so annotation indices stay on the PR text.
const paragraphs = text => text.replace(/\r\n/g, '\n').split(/\n\n+/).map(p => p.replace(/^\n+|\n+$/g, ''));

export function manuscriptDiff(before, after) {
  const oldParas = before === null ? [] : paragraphs(before);
  const newParas = paragraphs(after);
  const result = { paragraphs: newParas.map(() => null), changes: [], coarse: false };
  let chunks = oldParas.length + newParas.length <= 5000
    ? diffArrays(oldParas, newParas, { maxEditLength: 128 }) : undefined;
  if (!chunks) {
    chunks = [{ removed: true, value: oldParas }, { added: true, value: newParas }];
    result.coarse = true;
  }
  let at = 0, charBudget = 32000, blocks = 0;
  for (let i = 0; i < chunks.length;) {
    if (!chunks[i].added && !chunks[i].removed) { at += chunks[i++].value.length; continue; }
    const removed = [], added = [];
    while (i < chunks.length && (chunks[i].added || chunks[i].removed)) {
      (chunks[i].removed ? removed : added).push(...chunks[i++].value);
    }
    const oldText = removed.join('\n\n'), newText = added.join('\n\n');
    const size = oldText.length + newText.length;
    let chars;
    if (oldText && newText && size <= charBudget && blocks++ < 32) {
      chars = diffChars(oldText, newText, { maxEditLength: 128 });
      charBudget -= size;
    }
    if (!chars) {
      chars = [{ removed: true, value: oldText }, { added: true, value: newText }];
      if (oldText && newText) result.coarse = true;
    }
    let oldOffset = 0, newOffset = 0;
    const oldRanges = [], newRanges = [];
    for (const part of chars) {
      if (part.removed && part.value.length) oldRanges.push([oldOffset, oldOffset + part.value.length]);
      if (part.added && part.value.length) newRanges.push([newOffset, newOffset + part.value.length]);
      if (!part.added) oldOffset += part.value.length;
      if (!part.removed) newOffset += part.value.length;
    }
    const kind = removed.length ? (added.length ? 'changed' : 'deleted') : 'added';
    result.changes.push({ at, count: added.length, kind, before: oldText, ranges: oldRanges });
    let offset = 0;
    added.forEach((text, index) => {
      result.paragraphs[at + index] = { kind, ranges: newRanges
        .filter(([start, end]) => start < offset + text.length && end > offset)
        .map(([start, end]) => [Math.max(0, start - offset), Math.min(text.length, end - offset)]) };
      offset += text.length + 2;
    });
    at += added.length;
  }
  return result;
}
