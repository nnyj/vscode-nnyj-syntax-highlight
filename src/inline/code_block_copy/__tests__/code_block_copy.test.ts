import { describe, expect, it } from 'vitest';
import { codeBlockContent } from '../../code_block_copy';

describe('codeBlockContent', () => {
  it('strips fence indent and fence lines', () => {
    expect(codeBlockContent(['  ```bash', '  ffmpeg ^', '    -i a.jpg', '', '  ```'])).toBe('ffmpeg ^\n  -i a.jpg\n');
  });

  it('keeps lines indented less than the fence', () => {
    expect(codeBlockContent(['    ```', '  a', '    ```'])).toBe('a');
  });
});
