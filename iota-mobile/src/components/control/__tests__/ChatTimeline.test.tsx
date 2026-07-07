import { ParsedBlock } from '../ControlScreenConstants';
import {
  OpenCodeToolActivity,
  OpenCodeFileChange,
  OpenCodeApprovalRequest,
} from '../../../types/opencode';

type Activity = Record<string, any>;

function interleaveInlineBlocks(
  activities: Activity[],
  assistantMsg: { metadata?: { parsedBlocks?: ParsedBlock[] }; createdAt: string }
): Activity[] {
  const parsedBlocks = assistantMsg.metadata?.parsedBlocks;
  if (!parsedBlocks || parsedBlocks.length === 0) return activities;
  const hasTools = activities.some((a) => a.type === 'tool');
  if (!hasTools) return activities;
  const inlineItems: Activity[] = [];
  parsedBlocks.forEach((block, index) => {
    const isLastText = block.type === 'text' && index === parsedBlocks.length - 1;
    if (isLastText) return;
    if (block.type === 'thought') {
      inlineItems.push({
        type: 'thought_block',
        block,
        index,
        timestamp: block.startedAt || assistantMsg.createdAt,
      });
    } else {
      inlineItems.push({
        type: 'intermediate_text',
        block,
        index,
        timestamp: block.startedAt || assistantMsg.createdAt,
      });
    }
  });
  if (inlineItems.length === 0) return activities;
  const merged = [...activities, ...inlineItems];
  merged.sort((a, b) => {
    const tA = a.timestamp
      || a.activity?.startedAt
      || a.change?.createdAt || a.change?.id
      || a.approval?.createdAt
      || '';
    const tB = b.timestamp
      || b.activity?.startedAt
      || b.change?.createdAt || b.change?.id
      || b.approval?.createdAt
      || '';
    return (tA || '').localeCompare(tB || '');
  });
  return merged;
}

const makeTool = (id: string, startedAt: string): OpenCodeToolActivity => ({
  id,
  conversationId: 'conv-1',
  label: `Tool ${id}`,
  kind: 'command',
  status: 'completed',
  startedAt,
  completedAt: startedAt,
});

const makeParsedBlocks = (
  spec: { type: 'thought' | 'text'; content: string; startedAt?: string; isFinished?: boolean }[]
): ParsedBlock[] =>
  spec.map((s, i) => ({
    type: s.type,
    content: s.content,
    isFinished: s.isFinished ?? true,
    startedAt: s.startedAt || `2026-07-02T00:00:0${i + 1}Z`,
    completedAt: s.isFinished !== false ? `2026-07-02T00:00:0${i + 2}Z` : undefined,
  }));

describe('timeline chronological interleaving', () => {
  it('merges thought blocks with tool activities sorted by timestamp', () => {
    const tool1 = makeTool('t1', '2026-07-02T00:00:03Z');
    const tool2 = makeTool('t2', '2026-07-02T00:00:06Z');
    const blocks = makeParsedBlocks([
      { type: 'thought', content: 'Thinking 1', startedAt: '2026-07-02T00:00:01Z' },
      { type: 'text', content: 'Intermediate', startedAt: '2026-07-02T00:00:04Z' },
      { type: 'thought', content: 'Thinking 2', startedAt: '2026-07-02T00:00:05Z' },
      { type: 'text', content: 'Final answer', startedAt: '2026-07-02T00:00:07Z' },
    ]);
    const activities: Activity[] = [
      { type: 'tool', activity: tool1, timestamp: tool1.startedAt },
      { type: 'tool', activity: tool2, timestamp: tool2.startedAt },
    ];
    const assistantMsg = {
      createdAt: '2026-07-02T00:00:00Z',
      metadata: { parsedBlocks: blocks },
    };
    const result = interleaveInlineBlocks(activities, assistantMsg);
    expect(result).toHaveLength(5);
    expect(result[0].type).toBe('thought_block');
    expect(result[1].type).toBe('tool');
    expect(result[2].type).toBe('intermediate_text');
    expect(result[3].type).toBe('thought_block');
    expect(result[4].type).toBe('tool');
  });

  it('excludes the last text block from inline blocks', () => {
    const tool = makeTool('t1', '2026-07-02T00:00:02Z');
    const blocks = makeParsedBlocks([
      { type: 'thought', content: 'Thinking', startedAt: '2026-07-02T00:00:01Z' },
      { type: 'text', content: 'Final answer', startedAt: '2026-07-02T00:00:03Z' },
    ]);
    const activities: Activity[] = [
      { type: 'tool', activity: tool, timestamp: tool.startedAt },
    ];
    const assistantMsg = {
      createdAt: '2026-07-02T00:00:00Z',
      metadata: { parsedBlocks: blocks },
    };
    const result = interleaveInlineBlocks(activities, assistantMsg);
    expect(result).toHaveLength(2);
    const thoughtBlock = result.find((r) => r.type === 'thought_block');
    expect(thoughtBlock).toBeDefined();
    const finalText = result.find((r) => r.type === 'intermediate_text');
    expect(finalText).toBeUndefined();
  });

  it('does not interleave when no tools present', () => {
    const blocks = makeParsedBlocks([
      { type: 'thought', content: 'Thinking', startedAt: '2026-07-02T00:00:01Z' },
      { type: 'text', content: 'Final answer', startedAt: '2026-07-02T00:00:02Z' },
    ]);
    const activities: Activity[] = [];
    const assistantMsg = {
      createdAt: '2026-07-02T00:00:00Z',
      metadata: { parsedBlocks: blocks },
    };
    const result = interleaveInlineBlocks(activities, assistantMsg);
    expect(result).toHaveLength(0);
  });

  it('does not interleave when parsedBlocks is empty', () => {
    const tool = makeTool('t1', '2026-07-02T00:00:02Z');
    const activities: Activity[] = [
      { type: 'tool', activity: tool, timestamp: tool.startedAt },
    ];
    const result1 = interleaveInlineBlocks(activities, {
      createdAt: '2026-07-02T00:00:00Z',
      metadata: { parsedBlocks: [] },
    });
    expect(result1).toHaveLength(1);
    const result2 = interleaveInlineBlocks(activities, {
      createdAt: '2026-07-02T00:00:00Z',
    });
    expect(result2).toHaveLength(1);
  });

  it('handles intermediate text blocks and places them chronologically', () => {
    const tool1 = makeTool('t1', '2026-07-02T00:00:03Z');
    const tool2 = makeTool('t2', '2026-07-02T00:00:06Z');
    const blocks = makeParsedBlocks([
      { type: 'text', content: 'Let me check...', startedAt: '2026-07-02T00:00:01Z' },
      { type: 'thought', content: 'Analyzing', startedAt: '2026-07-02T00:00:02Z' },
      { type: 'text', content: 'Found it', startedAt: '2026-07-02T00:00:04Z' },
      { type: 'thought', content: 'Verifying', startedAt: '2026-07-02T00:00:05Z' },
      { type: 'text', content: 'Here is the result', startedAt: '2026-07-02T00:00:07Z' },
    ]);
    const activities: Activity[] = [
      { type: 'tool', activity: tool1, timestamp: tool1.startedAt },
      { type: 'tool', activity: tool2, timestamp: tool2.startedAt },
    ];
    const assistantMsg = {
      createdAt: '2026-07-02T00:00:00Z',
      metadata: { parsedBlocks: blocks },
    };
    const result = interleaveInlineBlocks(activities, assistantMsg);
    expect(result).toHaveLength(6);
    expect(result[0].type).toBe('intermediate_text');
    expect(result[1].type).toBe('thought_block');
    expect(result[2].type).toBe('tool');
    expect(result[3].type).toBe('intermediate_text');
    expect(result[4].type).toBe('thought_block');
    expect(result[5].type).toBe('tool');
  });

  it('preserves tool/file/approval items alongside inline blocks', () => {
    const tool = makeTool('t1', '2026-07-02T00:00:03Z');
    const fileChange: OpenCodeFileChange = {
      id: 'f1',
      conversationId: 'conv-1',
      filePath: 'src/test.ts',
      changeType: 'modified',
      additions: 5,
      deletions: 2,
      hunks: [],
      createdAt: '2026-07-02T00:00:04Z',
    };
    const approval: OpenCodeApprovalRequest = {
      id: 'a1',
      conversationId: 'conv-1',
      title: 'Approve?',
      description: 'Test approval',
      riskLevel: 'low',
      status: 'pending',
      createdAt: '2026-07-02T00:00:05Z',
    };
    const blocks = makeParsedBlocks([
      { type: 'thought', content: 'Thinking', startedAt: '2026-07-02T00:00:01Z' },
      { type: 'text', content: 'Final', startedAt: '2026-07-02T00:00:06Z' },
    ]);
    const activities: Activity[] = [
      { type: 'tool', activity: tool, timestamp: tool.startedAt },
      { type: 'file', change: fileChange, timestamp: fileChange.createdAt },
      { type: 'approval', approval, timestamp: approval.createdAt },
    ];
    const assistantMsg = {
      createdAt: '2026-07-02T00:00:00Z',
      metadata: { parsedBlocks: blocks },
    };
    const result = interleaveInlineBlocks(activities, assistantMsg);
    expect(result).toHaveLength(4);
    expect(result[0].type).toBe('thought_block');
    expect(result[1].type).toBe('tool');
    expect(result[2].type).toBe('file');
    expect(result[3].type).toBe('approval');
  });
});
