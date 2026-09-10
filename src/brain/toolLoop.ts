/** Provider-neutral read/observe loop. Mutations stay in the validated plan executor. */
export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}
interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}
export type Complete = (messages: AgentMessage[], tools: AgentTool[], final: boolean) => Promise<AgentMessage>;
export async function runToolLoop(messages: AgentMessage[], tools: AgentTool[], complete: Complete, check: () => void) {
  const history = [...messages];
  const names = new Map(tools.map(tool => [tool.name, tool]));
  if (names.size !== tools.length) throw new Error('Duplicate tool names');
  const seen = new Set<string>();
  let calls = 0;
  const usedTools: string[] = [];
  for (let step = 0; step <= 6; step++) {
    check();
    const response = await complete(history, tools, step === 6);
    check();
    if (!response.tool_calls?.length) {
      if (!response.content) throw new Error('Empty assistant response');
      return { content: response.content, calls, usedTools };
    }
    if (step === 6 || response.tool_calls.length !== 1 || calls >= 6) throw new Error('Tool limit exceeded. Please narrow the request.');
    const call = response.tool_calls[0];
    const tool = names.get(call.function?.name);
    if (!tool || typeof call.id !== 'string' || seen.has(call.id) || typeof call.function.arguments !== 'string' || call.function.arguments.length > 8000) throw new Error('Invalid tool call');
    const args = JSON.parse(call.function.arguments);
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid tool arguments');
    seen.add(call.id); calls++; usedTools.push(tool.name);
    history.push({ role: 'assistant', content: response.content ?? null, tool_calls: [call] });
    check();
    const result = await tool.execute(args);
    check();
    const data = JSON.stringify(result);
    if (data.length > 48000) throw new Error('Tool result too large. Please narrow the search.');
    history.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ untrusted_data: result }) });
  }
  throw new Error('Tool limit exceeded');
}
