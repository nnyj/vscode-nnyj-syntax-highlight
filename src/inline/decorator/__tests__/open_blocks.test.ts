import { OpenBlocks } from '../editor_insets';
import { Selection } from '../../test/__mocks__/vscode';

const at = (line: number) => ({ line, character: 0 });
const blocks = [{ startLine: 4, endLine: 8 }, { startLine: 12, endLine: 15 }];

describe('OpenBlocks', () => {
  it('opens the block holding an empty cursor and closes it once the cursor leaves', () => {
    const open_blocks = new OpenBlocks();
    const editor = { selections: [new Selection(at(6), at(6))] } as any;
    expect([...open_blocks.get(editor, blocks)]).toEqual([4]);
    editor.selections = [new Selection(at(0), at(0))];
    expect([...open_blocks.get(editor, blocks)]).toEqual([]);
  });

  it('keeps the last state while a selection is non-empty', () => {
    const open_blocks = new OpenBlocks();
    const editor = { selections: [new Selection(at(0), at(0))] } as any;
    open_blocks.get(editor, blocks);
    editor.selections = [new Selection(at(0), at(13))];
    expect([...open_blocks.get(editor, blocks)]).toEqual([]);
    editor.selections = [new Selection(at(13), at(13))];
    expect([...open_blocks.get(editor, blocks)]).toEqual([12]);
    editor.selections = [new Selection(at(13), at(2))];
    expect([...open_blocks.get(editor, blocks)]).toEqual([12]);
  });
});
