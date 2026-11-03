import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const workletsPlugin = require.resolve('react-native-worklets/plugin');
const { parseSync, transformSync, traverse } = createRequire(workletsPlugin)('@babel/core');
const containerPath = require.resolve('react-native-gifted-chat/lib/MessageContainer/index.js');
const containerSource = readFileSync(containerPath, 'utf8');

test('GiftedChat day-position worklet captures the message ID and serializable layout values', () => {
  const { ast } = transformSync(containerSource, {
    filename: containerPath,
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ['jsx'] },
    plugins: [workletsPlugin],
    ast: true,
    code: false,
  });
  const capturedLayoutClosures = [];
  traverse(ast, {
    AssignmentExpression({ node }) {
      if (node.left.type !== 'MemberExpression' || node.left.property.name !== '__closure'
        || node.right.type !== 'ObjectExpression') return;
      const names = node.right.properties.map(property => property.key.name);
      if (names.includes('newValue')) capturedLayoutClosures.push(names.sort());
    },
  });
  assert.deepEqual(capturedLayoutClosures, [['inverted', 'messageId', 'newValue']]);
});

test('day-position updates replace the same-day marker while retaining other days', () => {
  const ast = parseSync(containerSource, {
    filename: containerPath,
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ['jsx'] },
  });
  let updateSource;
  traverse(ast, {
    CallExpression({ node }) {
      if (node.callee.type === 'MemberExpression'
        && node.callee.object.name === 'daysPositions' && node.callee.property.name === 'modify') {
        const callback = node.arguments[0];
        const source = containerSource.slice(callback.start, callback.end);
        if (source.includes('newValue')) updateSource = source;
      }
    },
  });
  assert.ok(updateSource);
  for (const inverted of [false, true]) {
    const newValue = { y: 30, height: 18, createdAt: new Date(2026, 10, 3, 12).getTime() };
    const update = new Function('messageId', 'newValue', 'inverted', `return (${updateSource});`)('new-message', newValue, inverted);
    const otherDay = { y: 5, height: 16, createdAt: new Date(2026, 10, 2, 12).getTime() };
    const positions = {
      earlierMarker: { ...newValue, y: inverted ? 20 : 40 },
      otherDay,
    };
    assert.equal(update(positions), positions);
    assert.deepEqual(positions, { otherDay, 'new-message': newValue });
  }
});
