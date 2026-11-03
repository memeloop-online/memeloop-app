export function decodeXml(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(entity[1] === 'x' ? 2 : 1), entity[1] === 'x' ? 16 : 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[entity];
  });
}

export function parseUiXml(xml) {
  const nodes = [];
  const parents = [];
  for (const [tag] of xml.matchAll(/<\/?node\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/g)) {
    if (tag.startsWith('</')) {
      parents.pop();
      continue;
    }
    const attributes = Object.fromEntries([...tag.matchAll(/([\w-]+)=(?:"([^"]*)"|'([^']*)')/g)]
      .map(([, key, doubleQuoted, singleQuoted]) => [key, decodeXml(doubleQuoted ?? singleQuoted)]));
    const match = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(attributes.bounds ?? '');
    const node = {
      ...attributes,
      rectangle: match ? match.slice(1).map(Number) : undefined,
      parent: parents.at(-1),
      index: nodes.length,
    };
    nodes.push(node);
    if (!tag.endsWith('/>')) parents.push(node.index);
  }
  return nodes;
}

export function nodeMatches(node, label) {
  return [node.text, node['content-desc'], node['resource-id']].some(value => (
    typeof label === 'string' ? value === label : label.test(value ?? '')
  ));
}

export function visibleNode(nodes, label, packageName) {
  for (const node of nodes) {
    const bounds = node.rectangle;
    if (node.package !== packageName || node.enabled === 'false' || !bounds || !nodeMatches(node, label)) continue;
    let touchRectangle = [...bounds];
    for (let parent = nodes[node.parent]; parent; parent = nodes[parent.parent]) {
      if (parent.rectangle) {
        touchRectangle = [
          Math.max(touchRectangle[0], parent.rectangle[0]), Math.max(touchRectangle[1], parent.rectangle[1]),
          Math.min(touchRectangle[2], parent.rectangle[2]), Math.min(touchRectangle[3], parent.rectangle[3]),
        ];
      }
    }
    if (touchRectangle[2] > touchRectangle[0] && touchRectangle[3] > touchRectangle[1]) return { ...node, touchRectangle };
  }
  return undefined;
}

export function containedIn(inner, outer) {
  return inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];
}

export function navigationBarFrame(windowDump) {
  const windows = windowDump.split(/(?=^\s*Window #\d+ Window\{)/m);
  for (const window of windows) {
    if (!/^\s*Window #\d+ Window\{[^\n]*\bNavigationBar\d*\b/m.test(window)
      || !/^\s*isVisible=true\s*$/m.test(window)) continue;
    const frame = /^\s*mFrame=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/m.exec(window);
    if (frame) return frame.slice(1).map(Number);
  }
  return undefined;
}
