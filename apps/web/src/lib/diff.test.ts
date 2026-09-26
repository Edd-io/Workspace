import { describe, expect, it } from 'vitest';
import { parseDiff } from './diff';

const SAMPLE = `diff --git a/src/math.js b/src/math.js
index 1111111..2222222 100644
--- a/src/math.js
+++ b/src/math.js
@@ -1,3 +1,4 @@
 export function add(a, b) {
-  return a+b;
+  return a + b;
 }
+export const sub = (a, b) => a - b;
\\ No newline at end of file
diff --git a/logo.png b/logo.png
new file mode 100644
index 0000000..3333333
Binary files /dev/null and b/logo.png differ
`;

describe('parseDiff', () => {
  it('splits a unified diff into files and typed lines', () => {
    const files = parseDiff(SAMPLE);
    expect(files.map((file) => [file.path, file.binary])).toEqual([
      ['src/math.js', false],
      ['logo.png', true],
    ]);
    expect(files[0]!.lines.map((line) => line.kind)).toEqual([
      'hunk',
      'context',
      'del',
      'add',
      'context',
      'add',
      'meta',
    ]);
    expect(files[0]!.lines[3]).toEqual({ kind: 'add', text: '  return a + b;' });
  });

  it('returns nothing for an empty diff', () => {
    expect(parseDiff('')).toEqual([]);
  });
});
